---
description: Comprehensive guide to the tech stack and folder structure of the project
---
# Tech Stack and Folder Structure Skill
This guide provides a comprehensive overview of the project's distributed microservices technology stack, architecture, and workspace directory structure.
## Tech Stack Overview
### Frontend (`packages/web`)
* Framework: React 19 (TypeScript)
* Build Tool: Rsbuild (underlying Rspack compiler)
* Styling: TailwindCSS v4 with plain CSS config (`App.css`)
* API Client: `openapi-fetch` (type-safe OpenAPI query client)
* State Management: React Hooks & Context
* Testing: Bun's native runner + `@testing-library/react` + `jsdom`
### Backend Microservices (`apps/`)
All services run on Bun runtime and use Elysia.js framework with modular routing:
1. Auth Service (`apps/auth-service` / Port `3001`): CPU-bound profile. Manages user registration, Argon2id password hashing, opaque Refresh Token rotation, and Redis-backed session token version verification.
2. Seat Service (`apps/seat-service` / Port `3002`): DB-bound profile. Manages seat inventories, pessimistic row-level holds (`SELECT FOR UPDATE`), expiration sweeper loops, and SSE streams.
3. Payment Service (`apps/payment-service` / Port `3003`): I/O-bound profile. Creates billing intents, processes Stripe-style HMAC webhooks via a `webhook_inbox` queue, and maintains cached seat pricing.
### Shared Monorepo Packages (`packages/`)
* be-core (`packages/be-core`): Shared utilities containing Postgres pools, Redis rate limiters, structured winston logger, and the Transactional Outbox workers.
* contracts (`packages/contracts`): Event payload schemas, dot-notated topic names (contracts), and typescript structures.
### Infrastructure & Brokers
* Gateway: Nginx (Port `3000`) reverse-proxy routing `/api/auth/*` to Auth, `/api/seats/*` to Seats, and `/api/seats/:id/reserve` to Payment. Manages request rate limiting per IP.
* Relational Storage: PostgreSQL 15 divided into separate databases (`auth_db`, `seat_db`, `payment_db`).
* Cache & Locks: Redis 7 managing JWT session version invalidation mappings, rate limiting store, and SSE Pub/Sub.
* Event Broker: Apache Kafka (KRaft mode) managing event streams for Saga completion and rollback release compensations.

## Directory Structure
```text
seat-reservation/
├─apps/
│   ├─auth-service/ # Identity & Session Control (Port 3001)
│   │   ├─src/routes/auth.ts # User auth routes (login, register, refresh, logout)
│   │   └─src/services/token.ts # Opaque token database operations
│   ├─seat-service/ # Seat locks & streams (Port 3002)
│   │   ├─src/routes/seats.ts # Hold, lock, release, SSE routes
│   │   └─src/index.ts # Kafka consumer for saga fulfillments
│   └─payment-service/ # Checkout & Webhooks (Port 3003)
│       ├─src/routes/payment.ts # Reserve, Stripe mock webhook paths
│       └─src/services/worker.ts # Webhook inbox background runner
├─packages/
│   ├─be-core/ # Shared backend helpers (pg, redis, outbox, logging)
│   ├─contracts/ # Event payload contracts
│   └─web/ # React frontend SPA (Port 4097)
├─migrations/ # Versioned SQL migrations per DB context
│   ├─auth/ # DDL for users, refresh_tokens, audit logs
│   ├─seat/ # DDL for seats, reservations, event logs
│   └─payment/ # DDL for intents, webhook_inbox
├─infra/
│   ├─nginx/ # Nginx Gateway configuration & limiting
│   └─postgres/ # DB cluster creation scripts
├─scripts/
│   ├─run-migrations.sh # Migration execution automation
│   └─smoke-test.sh # Automated E2E Saga integration tests
├─plan/ # Transformation plans
├─docker-compose.yml # Orchestrates the local cluster
├─package.json # Monorepo workspaces definition
└─bun.lock # Lockfile
```

## Key Architectural Patterns
### API Gateway & Path Rewrites
All client-to-backend requests target Nginx on port `3000` with `/api/`. Nginx rewrites and proxies calls to target backend containers, shielding ports `3001-3003` from public exposure.
### Concurrency Lock Boundaries
To avoid race conditions:
* Seat locks use PostgreSQL transactions with row-level locks: `SELECT * FROM seats WHERE id = $1 FOR UPDATE`.
* Expiry loops run hold sweepers using `FOR UPDATE SKIP LOCKED` to scale safely across multiple instances.
### Transactional Outbox Pattern
Ensures dual-write reliability between DB and Kafka. Instead of publishing directly to Kafka during HTTP requests:
1. DB changes and events are committed to a local `outbox_events` table in the same transaction.
2. A separate background worker (`OutboxWorker`) polls `outbox_events` and publishes them to Kafka.
3. Guarantees at-least-once event delivery even if the message broker is temporarily offline.
### Webhook Inbox Queue (Ack-Fast Pattern)
Protects against processing delays or database locks on payment endpoints:
1. Webhooks from Stripe are received, cryptographically verified, and immediately inserted into a `webhook_inbox` table.
2. The endpoint returns `200 OK` instantly to Stripe.
3. A background inbox processor pulls pending events from `webhook_inbox` sequentially and handles them asynchronously.
### Saga Asynchronous Coordination
Coordination between seat hold state and billing uses Kafka events:
* `payment.completed` -> Finalizes hold into `reserved` status and logs the reservation.
* `payment.failed` -> Compensates hold, releasing the seat back to `available`.

## Security Controls
* Rate Limiting: Managed at the gateway. `auth_zone` throttles credentials to 10 req/min; `payment_zone` throttles reservations to 15 req/min.
* Split Cookies: JWT Access token (`token`) is httpOnly, sameSite lax, path `/`. Opaque Refresh token (`refresh_token`) is httpOnly, sameSite strict, path `/api/auth`.
* Theft Detection: Opaque refresh token rotation invalidates the entire session family if token reuse is detected.
* Token Version Blacklisting: Active JWTs are verified against a Redis memory version cache, enabling instant global session invalidation on logout.
* Webhook Signatures: Verified using SHA-256 HMAC timing-safe compare and signature timestamp age checks (< 5 minutes skew).
* Double-Submit CSRF: Enforced on all mutating POST requests via `x-csrf-token` headers.

## Development Workflow
### Startup Command Sequence
```bash
# 1. Spin up the cluster
docker-compose up --build -d

# 2. Run migrations (creates tables & seeds seats)
./scripts/run-migrations.sh

# 3. Verify E2E flows (happy path + refund compensation)
./scripts/smoke-test.sh
```
### Formatting & Linting
```bash
bun run fmt
bun run lint
```
