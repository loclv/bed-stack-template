# Distributed Seat Reservation System — Quality & Verification Test Plan
This document details the test strategy, execution guidelines, and manual verification steps for the microservices architecture.

## 1. Test Architecture Overview
Quality verification is split into three tiers:
1. Core Package Unit Tests: Validates shared libraries in `packages/be-core` (CSRF, schemas, response mapping, memory stores) using Bun's native runner.
2. Horizontal Concurrency Integration Tests: Validates seat conflict resolution, token version checks, and rate limiters against running databases.
3. End-to-End Integration Sagas: Verifies event-driven coordination via Kafka and compensation workflows using an automated smoke test harness.

## 2. Running Automated Test Suites
```bash
# Run unit tests across packages
bun run --cwd packages/api test
bun run --cwd packages/web test

# Run the automated E2E integration test
./scripts/smoke-test.sh
```

## 3. Automated E2E Smoke Test Details
The script [smoke-test.sh](./seat-reservation/scripts/smoke-test.sh) performs the following integration checks on a running docker cluster:
1. Authentication Verification: Performs a mock login and extracts cookies to verify auth routes.
2. Pessimistic Hold Verification: Initiates a lock on seat `A1` and asserts that status becomes `held` in the database.
3. Saga Completion Verification: Initiates payment with status `success`. Asserts that the Payment Outbox and Kafka consumer process successfully, and seat `A1` is eventually marked as `reserved` in `seat-db`.
4. Saga Compensation Verification: Locks seat `A2`, initiates payment with status `fail`. Asserts that the compensation consumer triggers, releasing seat `A2` back to `available`.

## 4. Manual Verification Matrix
Verify the following cases with `docker-compose` cluster active.
### Auth Service (Port: 3001)
| Case | Scenario | Expected Outcome |
|---|---|---|
| Opaque Token Rotation | POST `/api/auth/refresh` | Old refresh token is deleted, new is generated and returned. Session remains active. |
| Theft Invalidation | Re-request refresh with old token | Detected as reuse; revokes the entire `familyId` group in `auth_db`, forcing logout on all devices. |
| Rotation Grace Window | Refresh token double-sent < 10s | Accepted without error. Handles concurrent network retry retries cleanly. |
| Instant Access Invalidation | POST `/api/auth/logout` | Version index in Redis is updated. Old JWT Access Tokens get rejected on subsequent calls. |
### Seat Service (Port: 3002)
| Case | Scenario | Expected Outcome |
|---|---|---|
| Pessimistic Seat Hold | POST `/api/seats/1/hold` | Locks row via `FOR UPDATE` in transaction. Enforces 1 hold per user via partial unique index. |
| Seat Contention | User B holds locked seat 1 | Fails immediately with `409 Conflict` and returns a `Retry-After: N` header. |
| Hold Expiration Sweeper | Wait for hold TTL (e.g. 10s in dev) | Sweeper cleans up expired holds using `SKIP LOCKED` batch updates. Seat becomes available. |
| Real-Time updates | SSE stream GET `/api/seats/stream` | Pushes SSE event packets whenever seat states update, backed by Redis Pub/Sub. |
### Payment Service (Port: 3003)
| Case | Scenario | Expected Outcome |
|---|---|---|
| Timing-Safe Webhook | POST `/api/payments/webhook` with bad signature | HMAC verification fails, returns `401 Unauthorized`. Works via timing-safe compare. |
| Replay Attack Defense | POST webhook with old timestamp (>5 mins) | Rejected as expired signature. |
| Idempotent Webhook | POST duplicate Stripe webhook event ID | Inbox unique constraint catches duplicate, returns `200 OK` (Ack Fast) but does not re-process. |
| Server-Side Pricing | POST `/api/seats/1/reserve` with body amount | Price is resolved from local DB `seats` cache. Custom payload price is ignored. |
