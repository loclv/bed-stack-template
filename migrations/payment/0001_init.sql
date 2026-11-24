-- Payment database schema initial migration

CREATE TABLE IF NOT EXISTS payment_intents (
  id SERIAL PRIMARY KEY,
  external_id VARCHAR(255) NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  seat_id INTEGER NOT NULL,
  amount_in_cents INTEGER NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_inbox (
  id SERIAL PRIMARY KEY,
  stripe_event_id VARCHAR(255) NOT NULL UNIQUE,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_webhook_inbox_status ON webhook_inbox(status) WHERE status = 'PENDING';

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
CREATE INDEX IF NOT EXISTS idx_payment_outbox_status ON outbox(status) WHERE status = 'PENDING';

-- Cache of seats for local server-side controlled prices
CREATE TABLE IF NOT EXISTS seats (
  id SERIAL PRIMARY KEY,
  number VARCHAR(10) NOT NULL UNIQUE,
  price_in_cents INTEGER NOT NULL
);

-- Seed same seats as seat service for local lookup (server-side price controls)
INSERT INTO seats (id, number, price_in_cents) VALUES
  (1, 'A1', 5000), (2, 'A2', 5000), (3, 'A3', 5000),
  (4, 'B1', 7500), (5, 'B2', 7500), (6, 'B3', 7500)
ON CONFLICT (number) DO NOTHING;
