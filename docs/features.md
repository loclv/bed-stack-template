# Distributed Seat Reservation System — Feature Specification
## Overview
The Seat Reservation System is a production-grade, distributed microservices application designed for ticket selecting, pessimistic locking, and transactional reservation. Built using the BED Stack (Bun + Elysia.js + Drizzle ORM), it runs as three decoupled, containerized services orchestrated by Docker Compose, utilizing Nginx as an API gateway, PostgreSQL for persistence, Redis for rate limiting and real-time pub/sub, and Kafka for event-driven transactions.

## 1. Microservices Bounded Contexts
The monolith is split into three services based on operational profiles:
### 1. Auth Service (`auth-service` / Port `3001`)
- Profile: CPU-bound (due to resource-intensive password hashing).
- Core Operations: User registration, login, token refresh, session revocation.
- Security: Password hashing with `argon2id` (and timing latency equalization), opaque refresh tokens with rotation, family tracking, and a Redis-cached version check.
### 2. Seat Service (`seat-service` / Port `3002`)
- Profile: Database-bound (frequent read statements and row locks).
- Core Operations: Seat maps, locking/holds (5-minute expiration), real-time updates via SSE stream, and finalizing reservations.
- Transactional Sagas: Listens to billing events (`payment.completed` and `payment.failed`) to reserve seats or release holds as compensation.
### 3. Payment Service (`payment-service` / Port `3003`)
- Profile: I/O-bound (frequent network wait times communicating with external PSP gateways).
- Core Operations: Creating payment intents, Stripe-compatible webhooks, signature verification, and inbox idempotency checks.
- Outbox Worker: Publishes payment transactions to Kafka via a local transactional `outbox` table.

## 2. Core Features
### Authentication & Sessions
- Multi-device Session Support: Session cookies (`token` and `refresh_token`) keep users authenticated for up to 90 days.
- Opaque Refresh Tokens: Random cryptographically secure 48-byte strings. SHA-256 hashes are stored in the database.
- Token Rotation: Generates new tokens on every `/refresh` call, linking them in the database via `rotated_to` pointers.
- Theft Reuse Detection: Reuse of a previously rotated token automatically revokes all sessions belonging to the token family (`familyId`).
- Network Grace Window: Accepts recently rotated tokens for a 10-second window to prevent mobile client retry storms from terminating valid sessions.
- Versioned Access Tokens: Short-lived JWTs (15 minutes). Bumping `token_version` on a user instantly invalidates all issued JWT access tokens, verified via Redis cache lookup.
### Seat Inventory & Holds
- Pessimistic Hold Locking: `POST /seats/:id/hold` (and `/lock` alias) secures a seat for 5 minutes using `SELECT ... FOR UPDATE` inside a database transaction.
- Hold Constraints: Enforces exactly 1 active hold per user at the database layer via a partial unique index.
- Hold Expiry Sweeper: A background service (`HoldSweeper`) runs periodically, cleaning up expired holds using `SKIP LOCKED` to safely scale across multiple replicas.
- Contention Retry: Seat contention returns `409 Conflict` containing a `Retry-After` header calculated from the active hold's expiration.
- Real-Time Seat Stream: Exposes a Server-Sent Events (SSE) stream `/seats/stream` broadcasting seat state transitions using a Redis Pub/Sub backend.
### Billing & Saga Compensation
- Server-Controlled Pricing: Payment creation looks up prices from a local cached replica `seats` table inside `payment_db`, preventing client pricing manipulation.
- Webhook Inbox Pattern: Verification endpoint verifies Stripe signatures (`Stripe-Signature` header containing HMAC-SHA256 and timestamps) and saves events to `webhook_inbox` with unique index checks, returning `200 OK` instantly (ack-fast).
- Transactional Outbox: Outbox worker polls pending events using `SKIP LOCKED` and publishes to Kafka.
- Compensation Saga: If payment fails, seat service consumes `payment.failed` and performs compensation, releasing the locked seat. If payment succeeds, it consumes `payment.completed` and reserves the seat permanently.

## 3. API Endpoints (Gated by Nginx Gateway :3000)
| Route Path | Microservice | Auth | Rate Limit Zone | Description |
|---|---|---|---|---|
| `POST /api/auth/register` | `auth-service` | No | `auth_zone` (10r/m) | Registers new email/password account |
| `POST /api/auth/login` | `auth-service` | No | `auth_zone` (10r/m) | Login, sets token and refresh cookie |
| `POST /api/auth/mock-login` | `auth-service` | No | `auth_zone` (10r/m) | Dev-only mock switcher |
| `POST /api/auth/refresh` | `auth-service` | Cookie | `general_zone` (10r/s) | Rotates refresh and access tokens |
| `POST /api/auth/logout` | `auth-service` | Cookie | `general_zone` (10r/s) | Revokes current session |
| `POST /api/auth/logout-all` | `auth-service` | Cookie | `general_zone` (10r/s) | Revokes all refresh families & bumps version |
| `GET /api/auth/me` | `auth-service` | Cookie | `general_zone` (10r/s) | Returns current authenticated profile |
| `GET /api/seats` | `seat-service` | No | `general_zone` (10r/s) | Lists all seats and prices |
| `POST /api/seats/:id/hold` | `seat-service` | Cookie | `general_zone` (10r/s) | Pessimistic hold lock for 5 mins |
| `POST /api/seats/:id/lock` | `seat-service` | Cookie | `general_zone` (10r/s) | Alias mapping to hold endpoint |
| `POST /api/seats/:id/release` | `seat-service` | Cookie | `general_zone` (10r/s) | Manually releases held seat |
| `POST /api/seats/:id/unlock` | `seat-service` | Cookie | `general_zone` (10r/s) | Alias mapping to release endpoint |
| `GET /api/seats/stream` | `seat-service` | No | `general_zone` (10r/s) | SSE update stream |
| `POST /api/seats/:id/reserve` | `payment-service` | Cookie | `payment_zone` (15r/m) | Initiates mock checkout |
| `POST /api/payments/webhook` | `payment-service` | No | `general_zone` (10r/s) | stripe-compatible HMAC webhook receiver |

## 4. Databases Entity Relationships
The system partitions data storage into three isolated PostgreSQL databases hosted on a single engine.

```text
┌──────────────────────────┐     ┌──────────────────────────┐     ┌──────────────────────────┐
│         auth_db          │     │         seat_db          │     │        payment_db        │
├──────────────────────────┤     ├──────────────────────────┤     ├──────────────────────────┤
│ users                    │     │ seats                    │     │ payment_intents          │
│ refresh_tokens           │     │ reservations             │     │ webhook_inbox            │
│ audit_log                │     │ processed_events         │     │ seats (price cache)      │
│ outbox                   │     │ outbox                   │     │ outbox                   │
└──────────────────────────┘     └──────────────────────────┘     └──────────────────────────┘
```
