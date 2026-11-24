import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	googleId: text("google_id").unique(),
	email: text("email").notNull().unique(),
	name: text("name"),
	picture: text("picture"),

	createdAt: integer("created_at", { mode: "timestamp" })
		.default(sql`(strftime('%s', 'now'))`)
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.default(sql`(strftime('%s', 'now'))`)
		.notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const seats = sqliteTable("seats", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	number: text("number").notNull().unique(),
	status: text("status").notNull().default("available"), // 'available', 'locked', 'reserved'
	lockedBy: integer("locked_by").references(() => users.id),
	lockedAt: integer("locked_at", { mode: "timestamp" }),
	reservedBy: integer("reserved_by").references(() => users.id),
	reservedAt: integer("reserved_at", { mode: "timestamp" }),
	priceInCents: integer("price_in_cents").notNull().default(5000),
});

export const reservations = sqliteTable("reservations", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	seatId: integer("seat_id")
		.notNull()
		.references(() => seats.id),
	userId: integer("user_id")
		.notNull()
		.references(() => users.id),
	paymentIntentId: text("payment_intent_id").notNull(),
	amountInCents: integer("amount_in_cents").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.default(sql`(strftime('%s', 'now'))`)
		.notNull(),
});

export type Seat = typeof seats.$inferSelect;
export type NewSeat = typeof seats.$inferInsert;
export const refreshTokens = sqliteTable("refresh_tokens", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	userId: integer("user_id")
		.notNull()
		.references(() => users.id),
	tokenHash: text("token_hash").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.default(sql`(strftime('%s', 'now'))`)
		.notNull(),
});

export type Reservation = typeof reservations.$inferSelect;
export type NewReservation = typeof reservations.$inferInsert;
