import { and, eq, lt } from "drizzle-orm";
import { type Elysia, t } from "elysia";
import { nanoid } from "nanoid";
import { db } from "../db";
import { reservations, type Seat, seats } from "../db/schema";
import { csrfProtection } from "../utils/csrf";
import { DatabaseWrapper } from "../utils/database";
import { logger } from "../utils/logger";
import { ResponseBuilder } from "../utils/response";
import {
	type JwtPayload,
	JwtPayloadSchema,
	validateSchemaWithError,
} from "../utils/validation";

type JWTPlugin = {
	verify: (token: string) => Promise<false | Record<string, unknown>>;
};

const dbWrapper = new DatabaseWrapper(db);

// Extract token from Authorization header or httpOnly cookie
function getToken(
	authHeader: string | undefined,
	cookieToken?: string,
): string | undefined {
	if (authHeader?.startsWith("Bearer ")) {
		return authHeader.slice(7);
	}
	return cookieToken;
}

// Verify token and retrieve user ID
async function getUserFromToken(
	jwt: JWTPlugin,
	token: string | undefined,
): Promise<
	{ success: true; userId: number } | { success: false; error: string }
> {
	if (!token || typeof token !== "string" || !jwt) {
		return { success: false, error: "Authentication required" };
	}

	try {
		const payload = await jwt.verify(token);
		if (payload === false) {
			return { success: false, error: "Authentication failed" };
		}

		const payloadValidation = validateSchemaWithError<JwtPayload>(
			JwtPayloadSchema as any,
			payload as Record<string, unknown>,
		);
		if (!payloadValidation.success || !payloadValidation.data) {
			return { success: false, error: "Invalid authentication token" };
		}
		return { success: true, userId: payloadValidation.data.id };
	} catch (error) {
		logger.error("Failed to verify JWT token", { error: error as Error });
		return { success: false, error: "Authentication failed" };
	}
}

// Release locks older than 5 minutes
async function clearExpiredLocks() {
	const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
	try {
		await dbWrapper.update(
			db
				.update(seats)
				.set({
					status: "available",
					lockedBy: null,
					lockedAt: null,
				})
				.where(
					and(eq(seats.status, "locked"), lt(seats.lockedAt, fiveMinutesAgo)),
				),
		);
	} catch (error) {
		logger.error("Failed to clear expired locks", { error: error as Error });
	}
}

export const seatsPlugin = (app: Elysia) =>
	app
		.get("/seats", async () => {
			await clearExpiredLocks();
			try {
				const allSeats = await dbWrapper.selectMany<Seat>(
					db.select().from(seats).orderBy(seats.number),
				);
				return ResponseBuilder.success({ seats: allSeats });
			} catch (error) {
				logger.error("Failed to get seats", { error: error as Error });
				return ResponseBuilder.internal("Failed to retrieve seats");
			}
		})
		.post(
			"/seats/:id/lock",
			async ({ jwt, params, headers, cookie }) => {
				const csrfHeader = headers[csrfProtection.getHeaderName()] as
					| string
					| undefined;
				const csrfCookie = cookie[csrfProtection.getCookieName()]?.value;
				if (
					!(await csrfProtection.validateToken(
						csrfHeader || "",
						csrfCookie || "",
					))
				) {
					return ResponseBuilder.forbidden("CSRF validation failed");
				}

				const token = getToken(
					headers.authorization as string | undefined,
					cookie.token?.value,
				);
				const authResult = await getUserFromToken(jwt, token);
				if (!authResult.success) {
					return ResponseBuilder.unauthorized(authResult.error);
				}

				const userId = authResult.userId;
				const seatId = Number(params.id);

				if (Number.isNaN(seatId)) {
					return ResponseBuilder.validation("Invalid seat ID", [
						{ message: "Seat ID must be a number", path: "params.id" },
					]);
				}

				await clearExpiredLocks();

				try {
					const seat = await dbWrapper.selectOne<Seat>(
						db.select().from(seats).where(eq(seats.id, seatId)),
					);

					if (!seat) {
						return ResponseBuilder.notFound("Seat not found");
					}

					if (seat.status === "reserved") {
						return ResponseBuilder.error(
							"Seat is already reserved",
							"SEAT_ALREADY_RESERVED",
						);
					}

					if (seat.status === "locked" && seat.lockedBy !== userId) {
						return ResponseBuilder.error(
							"Seat is locked by another user",
							"SEAT_LOCKED_BY_OTHER",
						);
					}

					if (seat.status === "locked" && seat.lockedBy === userId) {
						const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
						if (seat.lockedAt && seat.lockedAt < fiveMinutesAgo) {
							// Lock expired, re-lock atomically
							const reLocked = await dbWrapper.updateAndReturn<Seat>(
								db
									.update(seats)
									.set({
										status: "locked",
										lockedBy: userId,
										lockedAt: new Date(),
									})
									.where(and(eq(seats.id, seatId), eq(seats.lockedBy, userId)))
									.returning(),
							);
							if (!reLocked) {
								return ResponseBuilder.error(
									"Failed to re-lock seat",
									"LOCK_FAILED",
								);
							}
							return ResponseBuilder.success({
								message: "Seat locked",
								seatId,
							});
						}
						// Extend lock atomically
						await dbWrapper.update(
							db
								.update(seats)
								.set({ lockedAt: new Date() })
								.where(and(eq(seats.id, seatId), eq(seats.lockedBy, userId))),
						);
						return ResponseBuilder.success({
							message: "Seat lock extended",
							seatId,
						});
					}

					// Atomic lock: only update if seat is still available
					const locked = await dbWrapper.updateAndReturn<Seat>(
						db
							.update(seats)
							.set({
								status: "locked",
								lockedBy: userId,
								lockedAt: new Date(),
							})
							.where(and(eq(seats.id, seatId), eq(seats.status, "available")))
							.returning(),
					);

					if (!locked) {
						return ResponseBuilder.error(
							"Seat is no longer available",
							"SEAT_UNAVAILABLE",
						);
					}

					logger.info("Seat locked successfully", { seatId, userId });
					return ResponseBuilder.success({ message: "Seat locked", seatId });
				} catch (error) {
					logger.error("Failed to lock seat", {
						error: error as Error,
						seatId,
						userId,
					});
					return ResponseBuilder.internal("Failed to lock seat");
				}
			},
			{
				params: t.Object({
					id: t.String(),
				}),
				headers: t.Object({
					authorization: t.Optional(t.String()),
					[csrfProtection.getHeaderName()]: t.Optional(t.String()),
				}),
			},
		)
		.post(
			"/seats/:id/unlock",
			async ({ jwt, params, headers, cookie }) => {
				const csrfHeader = headers[csrfProtection.getHeaderName()] as
					| string
					| undefined;
				const csrfCookie = cookie[csrfProtection.getCookieName()]?.value;
				if (
					!(await csrfProtection.validateToken(
						csrfHeader || "",
						csrfCookie || "",
					))
				) {
					return ResponseBuilder.forbidden("CSRF validation failed");
				}

				const token = getToken(
					headers.authorization as string | undefined,
					cookie.token?.value,
				);
				const authResult = await getUserFromToken(jwt, token);
				if (!authResult.success) {
					return ResponseBuilder.unauthorized(authResult.error);
				}

				const userId = authResult.userId;
				const seatId = Number(params.id);

				if (Number.isNaN(seatId)) {
					return ResponseBuilder.validation("Invalid seat ID", [
						{ message: "Seat ID must be a number", path: "params.id" },
					]);
				}

				try {
					const seat = await dbWrapper.selectOne<Seat>(
						db.select().from(seats).where(eq(seats.id, seatId)),
					);

					if (!seat) {
						return ResponseBuilder.notFound("Seat not found");
					}

					if (seat.status !== "locked" || seat.lockedBy !== userId) {
						return ResponseBuilder.error(
							"Seat lock not held by you",
							"LOCK_NOT_HELD",
						);
					}

					// Unlock seat
					await dbWrapper.update(
						db
							.update(seats)
							.set({
								status: "available",
								lockedBy: null,
								lockedAt: null,
							})
							.where(eq(seats.id, seatId)),
					);

					logger.info("Seat unlocked successfully", { seatId, userId });
					return ResponseBuilder.success({ message: "Seat unlocked", seatId });
				} catch (error) {
					logger.error("Failed to unlock seat", {
						error: error as Error,
						seatId,
						userId,
					});
					return ResponseBuilder.internal("Failed to unlock seat");
				}
			},
			{
				params: t.Object({
					id: t.String(),
				}),
				headers: t.Object({
					authorization: t.Optional(t.String()),
					[csrfProtection.getHeaderName()]: t.Optional(t.String()),
				}),
			},
		)
		.post(
			"/seats/:id/reserve",
			async ({ jwt, params, headers, body, cookie }) => {
				const csrfHeader = headers[csrfProtection.getHeaderName()] as
					| string
					| undefined;
				const csrfCookie = cookie[csrfProtection.getCookieName()]?.value;
				if (
					!(await csrfProtection.validateToken(
						csrfHeader || "",
						csrfCookie || "",
					))
				) {
					return ResponseBuilder.forbidden("CSRF validation failed");
				}

				const token = getToken(
					headers.authorization as string | undefined,
					cookie.token?.value,
				);
				const authResult = await getUserFromToken(jwt, token);
				if (!authResult.success) {
					return ResponseBuilder.unauthorized(authResult.error);
				}

				const userId = authResult.userId;
				const seatId = Number(params.id);
				const { simulatedStatus } = body;

				if (Number.isNaN(seatId)) {
					return ResponseBuilder.validation("Invalid seat ID", [
						{ message: "Seat ID must be a number", path: "params.id" },
					]);
				}

				if (simulatedStatus === "fail") {
					return ResponseBuilder.error(
						"Simulated payment failed",
						"PAYMENT_FAILED",
					);
				}

				await clearExpiredLocks();

				try {
					const result = await dbWrapper.transaction(async (tx) => {
						const txWrapper = new DatabaseWrapper(tx);

						// Lock the seat within transaction for update (concurrency protection)
						const seat = await txWrapper.selectOne<Seat>(
							tx.select().from(seats).where(eq(seats.id, seatId)),
						);

						if (!seat) {
							throw new Error("Seat not found");
						}

						if (seat.status === "reserved") {
							throw new Error("Seat already reserved");
						}

						if (seat.status !== "locked" || seat.lockedBy !== userId) {
							throw new Error("Seat lock expired or not held by user");
						}

						const paymentIntentId = `pi_mock_${nanoid()}`;

						// 1. Update seat status to reserved (atomically check via RETURNING)
						const updated = await txWrapper.updateAndReturn<Seat>(
							tx
								.update(seats)
								.set({
									status: "reserved",
									reservedBy: userId,
									reservedAt: new Date(),
									lockedBy: null,
									lockedAt: null,
								})
								.where(eq(seats.id, seatId))
								.returning(),
						);

						if (!updated) {
							throw new Error("Seat reservation failed - concurrency conflict");
						}

						// 2. Create reservation record
						const reservation = await txWrapper.insertAndReturn(
							tx.insert(reservations).values({
								seatId,
								userId,
								paymentIntentId,
								amountInCents: seat.priceInCents,
							}),
						);

						return { seat, reservation };
					});

					logger.info("Seat reserved successfully", {
						seatId,
						userId,
						reservationId: (result.reservation as any).id,
					});
					return ResponseBuilder.success({
						message: "Seat reserved successfully",
						seat: result.seat,
						reservation: result.reservation,
					});
				} catch (error) {
					logger.error("Failed to reserve seat", {
						error: error as Error,
						seatId,
						userId,
					});
					return ResponseBuilder.error(
						(error as Error).message || "Failed to reserve seat",
						"RESERVATION_FAILED",
					);
				}
			},
			{
				params: t.Object({
					id: t.String(),
				}),
				body: t.Object({
					simulatedStatus: t.Optional(
						t.Union([t.Literal("success"), t.Literal("fail")]),
					),
				}),
				headers: t.Object({
					authorization: t.Optional(t.String()),
					[csrfProtection.getHeaderName()]: t.Optional(t.String()),
				}),
			},
		);
