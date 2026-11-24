# Distributed Seat Reservation System — Database Specification
This document details the persistence layer, database partitioning, transaction boundaries, and concurrency locking strategies for the microservices architecture.

## 1. Core Technology
- Engine: PostgreSQL 15 (Alpine)
- Migrations: Versioned raw SQL scripts in `migrations/` executing idempotent `IF NOT EXISTS` DDL.
- ORM: Drizzle ORM (`drizzle-orm` + node-postgres `pg`).
- Connection Pool: Explicit connection pooling set on the `pg.Pool` client:
  - `auth-service` / `payment-service`: Pool size 10 (CPU/IO bound profiles).
  - `seat-service`: Pool size 20 (DB-bound, high concurrency locking profile).
  - Formula: `max = (cpu_cores * 2) + effective_spindle_count`. PgBouncer is recommended for multi-instance production clusters.

## 2. Partitioned Databases & Schemas
The system divides data ownership across three isolated databases hosted on the Postgres engine.
### Database 1: `auth_db` (Identity & Session Control)
- `users`: Stores authenticated identities.
  - `id` (SERIAL PRIMARY KEY)
  - `email` (VARCHAR(255) NOT NULL UNIQUE)
  - `password_hash` (VARCHAR(255))
  - `google_id` (VARCHAR(255) UNIQUE)
  - `token_version` (INTEGER DEFAULT 0) — used for instantaneous JWT invalidation.
- `refresh_tokens`: Opaque tokens for session rotation and reuse detection.
  - `id` (SERIAL PRIMARY KEY)
  - `user_id` (INTEGER REFERENCES users.id)
  - `token_hash` (VARCHAR(128) NOT NULL) — SHA-256 hash.
  - `family_id` (UUID NOT NULL) — group identifier for family theft invalidation.
  - `rotated_to` (INTEGER REFERENCES refresh_tokens.id) — successor pointer.
  - `is_revoked` (BOOLEAN DEFAULT FALSE)
  - `expires_at` (TIMESTAMPTZ NOT NULL)
- `audit_log`: Append-only log for sensitive actions.
  - `id` (SERIAL PRIMARY KEY), `user_id` (INTEGER), `action` (VARCHAR), `details` (JSONB), `ip_address` (VARCHAR).
- `outbox`: Transactional outbox log.
### Database 2: `seat_db` (Seat Allocations & Reservations)
- `seats`: Venue seat mappings and hold states.
  - `id` (SERIAL PRIMARY KEY)
  - `number` (VARCHAR(10) NOT NULL UNIQUE) — e.g. "A1", "B2"
  - `status` (VARCHAR(20) NOT NULL DEFAULT 'available') — available, held, reserved
  - `held_by` (INTEGER) — user ID holding the lock
  - `held_at` / `held_until` (TIMESTAMPTZ) — hold lifecycle dates
  - `reserved_by` / `reserved_at` (TIMESTAMPTZ)
  - `price_in_cents` (INTEGER NOT NULL DEFAULT 5000)
- `reservations`: Permanent ticketing receipts.
  - `id` (SERIAL PRIMARY KEY), `seat_id` (INTEGER REFERENCES seats.id), `user_id` (INTEGER), `payment_intent_id` (VARCHAR(255) UNIQUE), `amount_in_cents` (INTEGER).
- `processed_events`: Idempotency tracker for consumer.
  - `id` (SERIAL PRIMARY KEY), `event_id` (VARCHAR), `consumer_group` (VARCHAR), `processed_at` (TIMESTAMPTZ), `UNIQUE(event_id, consumer_group)`.
- `outbox`: Transactional outbox log.
### Database 3: `payment_db` (Billing & Stripe Integrations)
- `payment_intents`: Internal records of checkout transactions.
  - `id` (SERIAL PRIMARY KEY), `external_id` (VARCHAR UNIQUE) — Stripe PI ID, `user_id` (INTEGER), `seat_id` (INTEGER), `amount_in_cents` (INTEGER), `status` (VARCHAR DEFAULT 'pending').
- `webhook_inbox`: Webhook dedup log (Stripe webhook idempotency).
  - `id` (SERIAL PRIMARY KEY), `stripe_event_id` (VARCHAR UNIQUE), `event_type` (VARCHAR), `payload` (JSONB), `status` (VARCHAR DEFAULT 'PENDING').
- `seats`: Local cached replica of seat prices (provides server-side price control).
  - `id` (SERIAL PRIMARY KEY), `number` (VARCHAR UNIQUE), `price_in_cents` (INTEGER).
- `outbox`: Transactional outbox log.

## 3. Index Optimization & Query Tuning
### Partial Indexing
We define partial indexes to prevent full table scans and guarantee fast constraints:
1. `idx_one_hold_per_user` on `seats(held_by) WHERE status = 'held'`:
   Enforces at the DB engine layer that a user can only have at most one active hold.
2. `idx_seats_held_until` on `seats(held_until) WHERE status = 'held'`:
   Allows the cleanup background sweeper to scan only active locks.
3. `idx_seats_available` on `seats(status) WHERE status = 'available'`:
   Optimizes search parameters for browsing available inventory.

## 4. Key Concurrency Queries
### 1. Atomic Hold Row Locking (Pessimistic)
Uses `FOR UPDATE` to lock the target seat row inside a transaction:
```sql
BEGIN;
SELECT * FROM seats WHERE id = $1 FOR UPDATE;
-- Verify status === 'available' (if not, ROLLBACK and 409)
UPDATE seats SET status = 'held', held_by = $2, held_until = $3 WHERE id = $1;
INSERT INTO outbox (event_type, payload) VALUES ('seat.held', '...');
COMMIT;
```
### 2. Replica-Safe Expiry Sweeper
Uses `SKIP LOCKED` so replicas don't deadlock while cleaning up expired holds:
```sql
BEGIN;
SELECT id, number FROM seats 
WHERE status = 'held' AND held_until < NOW()
LIMIT 50 FOR UPDATE SKIP LOCKED;
-- Loop results
UPDATE seats SET status = 'available', held_by = NULL, held_until = NULL WHERE id = $1;
INSERT INTO outbox (event_type, payload) VALUES ('seat.released', '...');
COMMIT;
```
### 3. Saga Kafka Consumer Idempotency Check
Prevents double-processing Kafka retries:
```sql
BEGIN;
-- Attempt to record event ID (Unique index code will throw 23505 duplicate on crash/retry)
INSERT INTO processed_events (event_id, consumer_group) VALUES ($1, 'seat-service');
-- Finalize reservation
UPDATE seats SET status = 'reserved', reserved_by = $2 WHERE id = $3;
COMMIT;
```
