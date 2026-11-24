/**
 * Seat routes: list, hold, release, reserve, SSE stream.
 *
 * Concurrency strategy:
 * - Hold uses SELECT ... FOR UPDATE within a transaction (pessimistic locking)
 * - DB-level partial unique index enforces 1 hold per user
 * - 409 response with Retry-After header for contention
 *
 * DECISIONS: chose FOR UPDATE over SERIALIZABLE because:
 * 1. Fail-fast 409 is better UX than serialization retry
 * 2. FOR UPDATE locks only the target row, not the whole table
 * 3. With short hold TTL, lock contention is minimal
 *
 * Limitation: under extreme contention (1000 users same seat), DB connection
 * pool will queue. Acceptable because hold TTL is short (5min) and pool size
 * is bounded. If needed, can add advisory lock for fail-fast reject.
 */

import {
	appendOutbox,
	Counter,
	createCsrfProtection,
	createLogger,
	getCachedTokenVersion,
	type Registry,
	ResponseBuilder,
} from "@bed-stack/be-core";
import {
	type SeatHeldPayload,
	type SeatReleasedPayload,
	TOPICS,
} from "@bed-stack/contracts";
import { Elysia, t } from "elysia";
import type Redis from "ioredis";
import type pg from "pg";
import type { SeatServiceConfig } from "../config";

const logger = createLogger("seat-routes");

interface SeatRow {
	id: number;
	number: string;
	status: string;
	held_by: number | null;
	held_at: Date | null;
	held_until: Date | null;
	reserved_by: number | null;
	reserved_at: Date | null;
	price_in_cents: number;
	version: number;
}

/**
 * Create seat routes plugin.
 */
export function seatRoutes(
	pool: pg.Pool,
	redis: Redis,
	config: SeatServiceConfig,
	metricsRegistry: Registry,
) {
	const seatsHeldCounter = new Counter({
		name: "seats_held_total",
		help: "Total seats held",
		registers: [metricsRegistry],
	});

	const seatsReleasedCounter = new Counter({
		name: "seats_released_total",
		help: "Total seats released",
		labelNames: ["reason"],
		registers: [metricsRegistry],
	});

	const _seatsReservedCounter = new Counter({
		name: "seats_reserved_total",
		help: "Total seats reserved",
		registers: [metricsRegistry],
	});

	const hotSeatCounter = new Counter({
		name: "hot_seat_detected_total",
		help: "Times a seat had contention (409)",
		registers: [metricsRegistry],
	});

	const csrfProtection = createCsrfProtection(config.jwtSecret);

	/**
	 * Verify the x-csrf-token header against the csrf-token cookie nonce.
	 * Mutating endpoints authenticate via cookie, so they require the
	 * double-submit signature issued by the auth service.
	 */
	const isCsrfValid = async (
		headers: Record<string, unknown>,
		cookie: { [key: string]: { value?: string } | undefined },
	): Promise<boolean> => {
		const headerToken = headers[csrfProtection.getHeaderName()] as
			| string
			| undefined;
		const cookieNonce = cookie?.[csrfProtection.getCookieName()]?.value;
		return csrfProtection.validateToken(headerToken || "", cookieNonce || "");
	};

	/**
	 * Reject access tokens whose tokenVersion was revoked by logout-all.
	 * The auth service publishes the current version to Redis; when no
	 * version is published the check is skipped (unknown state).
	 */
	const isTokenVersionCurrent = async (
		userId: number,
		tokenVersion: unknown,
	): Promise<boolean> => {
		if (typeof tokenVersion !== "number") return true;
		const current = await getCachedTokenVersion(redis, userId);
		return current === null || current === tokenVersion;
	};

	const holdHandler = async ({
		params,
		jwt,
		cookie,
		set,
		headers,
	}: {
		params: { id: string };
		jwt: any;
		cookie: any;
		set: any;
		headers: Record<string, unknown>;
	}) => {
		// Auth check
		const token = cookie?.token?.value;
		if (!token) {
			set.status = 401;
			return ResponseBuilder.unauthorized();
		}

		if (!(await isCsrfValid(headers, cookie))) {
			set.status = 403;
			return ResponseBuilder.forbidden("Invalid CSRF token");
		}

		let userId: number;
		let tokenVersion: unknown;
		try {
			const payload = await jwt.verify(token);
			if (!payload || typeof payload === "boolean") {
				set.status = 401;
				return ResponseBuilder.unauthorized();
			}
			userId = payload.userId as number;
			tokenVersion = payload.tokenVersion;
		} catch {
			set.status = 401;
			return ResponseBuilder.unauthorized();
		}

		if (!(await isTokenVersionCurrent(userId, tokenVersion))) {
			set.status = 401;
			return ResponseBuilder.unauthorized("Session has been revoked");
		}

		const seatId = Number(params.id);
		if (Number.isNaN(seatId)) {
			set.status = 400;
			return ResponseBuilder.validation("Invalid seat ID");
		}

		const holdUntil = new Date(Date.now() + config.holdTtlSeconds * 1000);
		const client = await pool.connect();

		try {
			await client.query("BEGIN");

			// SELECT FOR UPDATE — lock the row for atomic check-and-update
			const seatResult = await client.query<SeatRow>(
				"SELECT * FROM seats WHERE id = $1 FOR UPDATE",
				[seatId],
			);
			const seat = seatResult.rows[0];

			if (!seat) {
				await client.query("ROLLBACK");
				set.status = 404;
				return ResponseBuilder.notFound("Seat not found");
			}

			if (seat.status === "reserved") {
				await client.query("ROLLBACK");
				set.status = 409;
				return ResponseBuilder.conflict("Seat is already reserved");
			}

			if (seat.status === "held" && seat.held_by !== userId) {
				await client.query("ROLLBACK");
				set.status = 409;
				const retryAfterSeconds = seat.held_until
					? Math.max(
							0,
							Math.ceil(
								(new Date(seat.held_until).getTime() - Date.now()) / 1000,
							),
						)
					: config.holdTtlSeconds;
				set.headers["Retry-After"] = String(retryAfterSeconds);
				hotSeatCounter.inc();
				return ResponseBuilder.conflict("Seat is held by another user");
			}

			if (seat.status === "held" && seat.held_by === userId) {
				// Extend hold
				await client.query(`UPDATE seats SET held_until = $1 WHERE id = $2`, [
					holdUntil,
					seatId,
				]);
				await client.query("COMMIT");
				return ResponseBuilder.success({
					message: "Hold extended",
					seatId,
				});
			}

			// Atomic hold: check available + update in one TX
			// The partial unique index (held_by WHERE status='held')
			// enforces 1 hold per user at DB level
			await client.query(
				`UPDATE seats
				 SET status = 'held', held_by = $1, held_at = NOW(), held_until = $2
				 WHERE id = $3 AND status = 'available'`,
				[userId, holdUntil, seatId],
			);

			// Outbox: emit seat.held event in same transaction
			await appendOutbox(client, TOPICS.SEAT_HELD, {
				seatId,
				seatNumber: seat.number,
				userId,
				heldUntil: holdUntil.toISOString(),
				priceInCents: seat.price_in_cents,
			} satisfies SeatHeldPayload);

			await client.query("COMMIT");

			// Publish to Redis for SSE fanout
			// TODO(prod): Use Redis pub/sub for multi-instance SSE
			await redis.publish(
				"seat-updates",
				JSON.stringify({
					type: "seat.held",
					seatId,
					status: "held",
					heldBy: userId,
				}),
			);

			seatsHeldCounter.inc();
			logger.info("Seat held", { seatId, userId });
			return ResponseBuilder.success({ message: "Seat held", seatId });
		} catch (err) {
			await client.query("ROLLBACK");

			// Check for unique constraint violation (1 hold per user)
			const pgErr = err as { code?: string };
			if (pgErr.code === "23505") {
				set.status = 409;
				return ResponseBuilder.conflict(
					"You already hold a seat. Release it before holding another.",
				);
			}

			logger.error("Failed to hold seat", {
				error: err as Error,
				seatId,
				userId,
			});
			return ResponseBuilder.internal("Failed to hold seat");
		} finally {
			client.release();
		}
	};

	const releaseHandler = async ({
		params,
		jwt,
		cookie,
		set,
		headers,
	}: {
		params: { id: string };
		jwt: any;
		cookie: any;
		set: any;
		headers: Record<string, unknown>;
	}) => {
		const token = cookie?.token?.value;
		if (!token) {
			set.status = 401;
			return ResponseBuilder.unauthorized();
		}

		if (!(await isCsrfValid(headers, cookie))) {
			set.status = 403;
			return ResponseBuilder.forbidden("Invalid CSRF token");
		}

		let userId: number;
		let tokenVersion: unknown;
		try {
			const payload = await jwt.verify(token);
			if (!payload || typeof payload === "boolean") {
				set.status = 401;
				return ResponseBuilder.unauthorized();
			}
			userId = payload.userId as number;
			tokenVersion = payload.tokenVersion;
		} catch {
			set.status = 401;
			return ResponseBuilder.unauthorized();
		}

		if (!(await isTokenVersionCurrent(userId, tokenVersion))) {
			set.status = 401;
			return ResponseBuilder.unauthorized("Session has been revoked");
		}

		const seatId = Number(params.id);
		if (Number.isNaN(seatId)) {
			set.status = 400;
			return ResponseBuilder.validation("Invalid seat ID");
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");

			const result = await client.query<SeatRow>(
				"SELECT * FROM seats WHERE id = $1 FOR UPDATE",
				[seatId],
			);
			const seat = result.rows[0];

			if (!seat) {
				await client.query("ROLLBACK");
				set.status = 404;
				return ResponseBuilder.notFound("Seat not found");
			}

			if (seat.status !== "held" || seat.held_by !== userId) {
				await client.query("ROLLBACK");
				set.status = 409;
				return ResponseBuilder.conflict("You do not hold this seat");
			}

			await client.query(
				`UPDATE seats
				 SET status = 'available', held_by = NULL, held_at = NULL, held_until = NULL
				 WHERE id = $1`,
				[seatId],
			);

			await appendOutbox(client, TOPICS.SEAT_RELEASED, {
				seatId,
				seatNumber: seat.number,
				userId,
				reason: "user_cancelled",
			} satisfies SeatReleasedPayload);

			await client.query("COMMIT");

			await redis.publish(
				"seat-updates",
				JSON.stringify({
					type: "seat.released",
					seatId,
					status: "available",
				}),
			);

			seatsReleasedCounter.inc({ reason: "user_cancelled" });
			logger.info("Seat released", { seatId, userId });
			return ResponseBuilder.success({
				message: "Seat released",
				seatId,
			});
		} catch (err) {
			await client.query("ROLLBACK");
			logger.error("Failed to release seat", { error: err as Error });
			return ResponseBuilder.internal("Failed to release seat");
		} finally {
			client.release();
		}
	};

	return (
		new Elysia({ prefix: "/seats" })
			// ─── List all seats ───────────────────────────────────────────────
			.get("/", async () => {
				try {
					const result = await pool.query<SeatRow>(
						`SELECT id, number, status, held_by, held_at, held_until,
					        reserved_by, reserved_at, price_in_cents
					 FROM seats ORDER BY number`,
					);
					const mappedSeats = result.rows.map((row) => ({
						id: row.id,
						number: row.number,
						status: row.status === "held" ? "locked" : row.status,
						lockedBy: row.held_by,
						lockedAt: row.held_at ? new Date(row.held_at).toISOString() : null,
						reservedBy: row.reserved_by,
						reservedAt: row.reserved_at
							? new Date(row.reserved_at).toISOString()
							: null,
						priceInCents: row.price_in_cents,
					}));
					return ResponseBuilder.success({ seats: mappedSeats });
				} catch (err) {
					logger.error("Failed to list seats", { error: err as Error });
					return ResponseBuilder.internal("Failed to retrieve seats");
				}
			})

			// ─── Hold / Lock a seat ───────────────────────────────────────────
			.post("/:id/hold", holdHandler, {
				params: t.Object({ id: t.String() }),
			})

			.post("/:id/lock", holdHandler, {
				params: t.Object({ id: t.String() }),
			})

			// ─── Release / Unlock a seat ─────────────────────────────────────
			.post("/:id/release", releaseHandler, {
				params: t.Object({ id: t.String() }),
			})

			.post("/:id/unlock", releaseHandler, {
				params: t.Object({ id: t.String() }),
			})

			// ─── SSE Stream for seat updates ──────────────────────────────────
			// TODO(prod): For horizontal scaling, use Redis pub/sub subscriber
			// per instance. Current implementation uses Redis pub/sub which is
			// already multi-instance safe.
			.get("/stream", async ({ set }) => {
				set.headers["Content-Type"] = "text/event-stream";
				set.headers["Cache-Control"] = "no-cache";
				set.headers.Connection = "keep-alive";

				const encoder = new TextEncoder();
				let subscriber: Redis | null = null;
				let heartbeat: ReturnType<typeof setInterval> | null = null;

				const cleanup = () => {
					if (heartbeat) {
						clearInterval(heartbeat);
						heartbeat = null;
					}
					if (subscriber) {
						subscriber.unsubscribe();
						subscriber.quit();
						subscriber = null;
					}
				};

				const stream = new ReadableStream({
					start(controller) {
						let closed = false;
						const safeEnqueue = (chunk: string) => {
							if (closed) return;
							try {
								controller.enqueue(encoder.encode(chunk));
							} catch {
								closed = true;
							}
						};

						subscriber = redis.duplicate();

						subscriber.subscribe("seat-updates", (err) => {
							if (err) {
								logger.error("SSE subscribe failed", {
									error: err as Error,
								});
								closed = true;
								controller.close();
							}
						});

						subscriber.on("message", (_channel: string, message: string) => {
							safeEnqueue(`data: ${message}\n\n`);
						});

						// Heartbeat every 30s to keep connection alive
						heartbeat = setInterval(() => {
							safeEnqueue(": heartbeat\n\n");
						}, 30_000);
					},
					// Called when the client disconnects — releases the Redis
					// subscriber connection and stops the heartbeat interval.
					cancel() {
						cleanup();
					},
				});

				return new Response(stream, {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						Connection: "keep-alive",
					},
				});
			})
	);
}
