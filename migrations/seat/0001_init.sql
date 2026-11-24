-- Seat database schema initial migration

CREATE TABLE IF NOT EXISTS seats (
  id SERIAL PRIMARY KEY,
  number VARCHAR(10) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  held_by INTEGER,
  held_at TIMESTAMPTZ,
  held_until TIMESTAMPTZ,
  reserved_by INTEGER,
  reserved_at TIMESTAMPTZ,
  price_in_cents INTEGER NOT NULL DEFAULT 5000,
  version INTEGER NOT NULL DEFAULT 0
);

-- Partial indexes for status-filtered queries to prevent full table scans
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_hold_per_user ON seats(held_by) WHERE status = 'held';
CREATE INDEX IF NOT EXISTS idx_seats_held_until ON seats(held_until) WHERE status = 'held';
CREATE INDEX IF NOT EXISTS idx_seats_available ON seats(status) WHERE status = 'available';

CREATE TABLE IF NOT EXISTS reservations (
  id SERIAL PRIMARY KEY,
  seat_id INTEGER NOT NULL REFERENCES seats(id),
  user_id INTEGER NOT NULL,
  payment_intent_id VARCHAR(255) NOT NULL UNIQUE,
  amount_in_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processed_events (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(255) NOT NULL,
  consumer_group VARCHAR(100) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, consumer_group)
);

CREATE TABLE IF NOT EXISTS outbox (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_seat_outbox_status ON outbox(status) WHERE status = 'PENDING';

-- Seed initial seats
INSERT INTO seats (number, price_in_cents) VALUES
  ('A1', 5000), ('A2', 5000), ('A3', 5000),
  ('B1', 7500), ('B2', 7500), ('B3', 7500)
ON CONFLICT (number) DO NOTHING;
