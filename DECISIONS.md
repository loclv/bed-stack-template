# Architectural & Concurrency Decisions
This document records the architectural decisions, trade-offs, and limitations considered during the migration of the monolithic seat reservation application to a distributed microservices architecture.

## 1. Monolith-to-Microservices Split
* Decision: Split the monolith into 3 discrete services: `auth-service`, `seat-service`, and `payment-service`.
* Rationale: Each service has a distinct operational profile:
  * `auth-service` is CPU-bound due to password hashing (`argon2id`).
  * `seat-service` is DB-bound with locking requirements on seats.
  * `payment-service` is I/O-bound due to external payment gateway communication.
  Taching allows scaling these contexts independently (e.g. provisioning more CPU to auth instances).
* Trade-off: Higher networking latency and deployment complexity. Mitigated by using a lightweight gateway (Nginx) and containerization.
## 2. Webhook Inbox Pattern (Ack-Fast)
* Decision: Webhooks are verified, saved to `webhook_inbox` (with unique constraint on Stripe event ID), and immediately acknowledged with `200 OK`. Processing happens asynchronously.
* Rationale: Webhook clients (like Stripe) expect response times < 2 seconds and retry on failure. Direct inline processing risks timing out when database locks or downstream brokers are slow, leading to duplicate charges.
* Trade-off: Requires a background inbox processor (`WebhookInboxWorker`), introducing eventual consistency lag before reservations are finalized.
## 3. Transactional Outbox Pattern
* Decision: All Kafka event publications are written to a local `outbox` table inside the same database transaction as the business state updates. A background worker polls the outbox and publishes to Kafka.
* Rationale: Publishing to a broker inline during a transaction risks dual-write inconsistency (e.g. DB commit succeeds but broker fails, or vice versa). Writing to DB first guarantees at-least-once delivery without costly 2-Phase Commit (2PC).
* Trade-off: Polling overhead on the database. Bounded in production by tuning poll intervals and using batch limits.
## 4. Pessimistic SELECT FOR UPDATE Locking
* Decision: Chose `SELECT ... FOR UPDATE` pessimistic locking in the `hold` endpoint over Optimistic Concurrency Control (OCC) version checks.
* Rationale: Under high contention (e.g. concert ticket sale), OCC results in a high number of transaction rollbacks, forcing clients to retry repeatedly (retry storm). Pessimistic locking blocks concurrent requests at the DB level, returning a fail-fast `409 Conflict` with a `Retry-After` header immediately to the user.
* Trade-off: Binds connection pool slots during lock execution. Bounded by short lock/hold TTL (5 minutes).
## 5. Replica-Safe Sweeper & Outbox Worker (SKIP LOCKED)
* Decision: Used `SELECT ... FOR UPDATE SKIP LOCKED` for the background sweeper (hold cleanups) and outbox workers.
* Rationale: In a horizontally scaled cluster with multiple service instances, simple `SELECT ... UPDATE` queries cause lock contention and deadlocks between replicas. `SKIP LOCKED` allows instances to pick distinct batches of records concurrently without blocking or waiting for each other.
* Trade-off: Processing order is not strictly FIFO under failure retries, but Kafka partition ordering guarantees event delivery order for consumers.
## 6. Timing Equalization on Login
* Decision: Implemented `dummyHash()` password verification for non-existent users during login attempts.
* Rationale: Argon2id hashing is intentionally resource-intensive. If we return immediately when an email is not found, the response time is sub-millisecond, whereas a valid user login takes 100ms+. Attackers can use this timing discrepancy to enumerate valid registered emails.
* Trade-off: Slightly increases CPU usage for failed login requests.
## 7. Opaque Refresh Tokens & Database Hashing
* Decision: Used cryptographically secure random opaque strings (48+ bytes) for refresh tokens, and stored their SHA-256 hashes in the database.
* Rationale: If refresh tokens were JWTs, revoking them before expiration would be difficult without a blocklist. Opaque tokens are fully revocable. Storing only their SHA-256 hashes prevents token theft in the event of database read leaks.
* Trade-off: Requires a database lookup on `/refresh`, unlike self-verifying stateless JWTs.
## 8. Refresh Token Rotation & Family Revocation
* Decision: On every `/refresh` call, the old refresh token is rotated (revoked) and a new one is issued. If a client attempts to reuse a revoked token, the entire token family (linked by `familyId`) is instantly revoked.
* Rationale: Protects against token theft. If an attacker steals a refresh token and uses it, the legitimate user's client will eventually attempt a refresh with the same token, triggering family-wide session termination.
* Trade-off: To prevent network failure retries from locking out legitimate users, a short grace window (10 seconds) is provided where the rotated token is still accepted.
## 9. Nginx Gateway Rate Limiting Zones
* Decision: Implemented Nginx rate-limiting zones (`limit_req_zone`) for different route prefixes: `/api/auth/` (10r/m), `/api/seats/:id/reserve` (15r/m), and general API (10r/s).
* Rationale: Rate-limiting at the gateway layer rejects brute-force attacks and DDoS requests before they consume application resources (e.g. CPU for password hashing or database connections for seat queries).
* Trade-off: Requires maintaining Nginx configuration in sync with application routing changes.
## 10. Server-Controlled Pricing Cache
* Decision: Created a cache replica of the `seats` table in `payment_db` to fetch ticket prices when initiating payment intents, rather than receiving the amount from the client.
* Rationale: Prevents price manipulation vulnerabilities where clients manually modify the JSON body to purchase tickets for lesser amounts.
* Trade-off: Requires keeping the seat catalog in sync across the databases, acceptable because seat inventory and prices change rarely.
## 11. Kafka Single-Node KRaft Mode
* Decision: Configured Kafka using KRaft (Kafka Raft Metadata Mode) in the docker-compose setup, omitting ZooKeeper.
* Rationale: KRaft reduces the resource footprint for local development and testing, starting Kafka as a single, combined broker and controller process.
* Trade-off: KRaft configuration varies from legacy ZooKeeper setups, but it represents the modern, standard path forward for Kafka deployments.
## 12. Backward-Compatible Database Migrations (Expand-Contract Pattern)
* Decision: All database schema modifications must strictly adhere to the Expand-Contract (Parallel Run) pattern to ensure zero-downtime rolling upgrades.
* Rationale: Directly dropping columns or modifying constraints in a single migration script while deploying new code results in a temporary mismatch between the running application logic and the database schema. Applying the Expand-Contract pattern guarantees backward compatibility:
  * Expand Phase: Add new columns or tables, keeping existing fields intact, allowing old and new versions of the services to run concurrently.
  * Transition Phase: Backfill existing rows and update application code to write to both old and new schemas.
  * Contract Phase: Safely remove deprecated columns or tables in a separate migration after confirming the old version is decommissioned.
* Trade-off: Requires writing multiple migration scripts and managing transitional dual-write application logic.
