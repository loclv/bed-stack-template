# Distributed Seat Reservation System — Security & Reliability Specification
This document details the security controls, resilience patterns, and reliability mechanisms implemented across the distributed microservices architecture.

## 1. Perimeter Security & Traffic Management (Nginx Gateway)
The Nginx API Gateway acts as the single entry point for all client requests, shielding the backend services and providing first-line defense:
### Gateway Rate Limiting Zones (`limit_req_zone`)
To prevent brute-force attacks and abuse, traffic is throttled at the gateway level before reaching service runtimes:
* Authentication Zone (`auth_zone`): Rate limited to `10 requests/minute` per IP with a burst of `5` and `nodelay`. Applied strictly to registration and login paths.
* Payment Zone (`payment_zone`): Rate limited to `15 requests/minute` per IP with a burst of `5`. Applied to seat checkout paths to prevent carding and payment flood attacks.
* General API Zone (`general_zone`): Rate limited to `10 requests/second` per IP with a burst of `30` (for SSE streams, seat maps, holds, and metadata queries).
### HTTP Security Headers
The gateway injects standard headers to prevent browser-based attacks:
* `Content-Security-Policy`: Restricts resource loading to trusted sources.
* `Strict-Transport-Security (HSTS)`: Forces SSL connections for 1 year (`max-age=31536000; includeSubDomains`).
* `X-Frame-Options: DENY`: Prevents clickjacking.
* `X-Content-Type-Options: nosniff`: Mitigates MIME-sniffing exploits.

## 2. Authentication & Session Security (`auth-service`)
### Double-Cookie & Token Partitioning
Authentication uses split cookies to balance usability and security:
1. Access Token (`token`): HS256 signed JWT with a 1-hour lifetime. Issued as an `httpOnly`, `sameSite=lax`, secure-in-production cookie.
2. Refresh Token (`refresh_token`): Cryptographically random opaque UUID string with a 90-day lifetime. Issued as an `httpOnly`, `sameSite=strict`, secure-in-production cookie scoped strictly to the `/api/auth` path.
3. CSRF Token (`csrf-token`): Random UUID token set as a JS-readable cookie. Mutating endpoints require this token passed via the `x-csrf-token` header (Double-Submit CSRF Pattern).
### Opaque Refresh Token Family Tracking & Theft Detection
To prevent refresh token hijacking:
* Refresh tokens are stored in `auth_db` as SHA-256 hex digests of the raw UUID.
* Token Rotation: Every successful refresh deletes the old token and inserts a new one (creating a chain).
* Reuse Detection: If a client requests a refresh using an already rotated refresh token (e.g. captured by an attacker), it signals theft. The system immediately revokes the entire token family (all active refresh tokens for that user ID) and forces logouts across all devices.
* Grace Window: A 10-second grace window allows rotated refresh tokens to be re-sent once. This prevents mobile network reconnect dropouts from triggering false-positive reuse invalidations.
### Instant Access Token Invalidation (Redis Cache)
JWTs are normally stateless. To achieve instant session invalidation on logout or security events:
* Each user has a `token_version` column in the database (default `0`).
* The JWT payload includes this `token_version`.
* On logout or password changes, the `token_version` is incremented, and the version cache is cleared.
* Backend services verify the JWT version against a fast Redis version lookup. If the cached version is higher than the JWT version, the request is immediately rejected.

## 3. Concurrency Control & State Management (`seat-service`)
### Pessimistic Row-Level Locking (`SELECT FOR UPDATE`)
To guarantee that two users cannot hold or reserve the same seat simultaneously:
* The hold process runs inside a PostgreSQL transaction (`READ COMMITTED`).
* A `SELECT ... FOR UPDATE` locks the specific seat row.
* While locked, other transactions requesting the same seat block or fail fast.
### Unique Hold Constraints
To prevent database bloating and ensure venue fairness:
* A partial unique index (`UNIQUE INDEX ON holds (user_id) WHERE status = 'locked'`) limits each user to holding exactly one seat at a time.
* If a user attempts to lock a second seat, the database unique constraint raises an error, rollback is executed, and a `409 Conflict` is returned.

## 4. Payment Integrity & Webhook Verification (`payment-service`)
### Cryptographic Webhook HMAC Validation
Stripe webhooks are validated to prevent payload tampering:
* The raw request body text is read to compute its SHA-256 HMAC signature using the webhook secret.
* Signatures are verified using `crypto.timingSafeEqual` to prevent timing analysis attacks.
* Freshness Check: Timestamps are parsed and checked against the server clock. Signatures older than 5 minutes are rejected to prevent replay attacks.
### Webhook Inbox Pattern (Idempotency)
To guarantee at-least-once message processing without duplicate execution:
* Webhook payloads are saved to `webhook_inbox` with status `PENDING` before parsing.
* A unique constraint on `stripe_event_id` ensures duplicate deliveries are immediately rejected (the gateway returns `200 OK` but avoids processing).
* A background inbox worker pulls events, processes payments, and updates states transactionally.
### Server-Side Price Resolution
To prevent client parameter spoofing (e.g. changing the checkout price in a browser POST payload):
* The payment request `POST /api/seats/:id/reserve` takes only the seat ID.
* The payment service resolves the price from a locally cached `seats` database table in `payment_db` (synced via Kafka). Client-provided amounts are ignored.

## 5. Event-Driven Reliability & Sagas (Kafka Events)
### Transactional Outbox Pattern
To guarantee that event publications match database state updates (avoiding split-brain states where DB updates succeed but event publishing fails):
1. DB Transaction: Services write their state changes and append the outbound event to an `outbox` table in the same local database transaction.
2. Outbox Worker: An independent background processor polls the `outbox` table, publishes events to Apache Kafka, and marks the outbox records as `PROCESSED`.
3. At-Least-Once Delivery: If Kafka is temporarily down, events are retried indefinitely from the outbox table.
### Processed Event Tracking (Idempotence)
Event consumers (such as the `seat-service` listening for `payment.completed` to finalize reservations) track processed event IDs:
* Received event IDs are stored in a `processed_events` table within the local transaction.
* If a duplicate event arrives, the unique constraint catches it and skips processing, preventing double-reservations.
