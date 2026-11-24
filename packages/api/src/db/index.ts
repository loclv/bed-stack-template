import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { config } from "../utils/const";
import * as schema from "./schema";

const sqlite = new Database(config.databasePath);
export const db = drizzle(sqlite, { schema });

sqlite.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id TEXT UNIQUE,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    picture TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  )
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS seats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'available',
    locked_by INTEGER REFERENCES users(id),
    locked_at INTEGER,
    reserved_by INTEGER REFERENCES users(id),
    reserved_at INTEGER,
    price_in_cents INTEGER NOT NULL DEFAULT 5000
  )
`);

sqlite.run(`
  CREATE INDEX IF NOT EXISTS idx_seats_status ON seats(status)
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seat_id INTEGER NOT NULL REFERENCES seats(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    payment_intent_id TEXT NOT NULL,
    amount_in_cents INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  )
`);

sqlite.run(`
  CREATE INDEX IF NOT EXISTS idx_reservations_user_id ON reservations(user_id)
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  )
`);

sqlite.run(`
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)
`);

// Seed 3 seats if the table is empty
const seatsCount = sqlite
	.prepare("SELECT count(*) as count FROM seats")
	.get() as { count: number };
if (seatsCount.count === 0) {
	sqlite.run(
		"INSERT INTO seats (number, status, price_in_cents) VALUES ('A1', 'available', 5000)",
	);
	sqlite.run(
		"INSERT INTO seats (number, status, price_in_cents) VALUES ('A2', 'available', 5000)",
	);
	sqlite.run(
		"INSERT INTO seats (number, status, price_in_cents) VALUES ('A3', 'available', 5000)",
	);
}
