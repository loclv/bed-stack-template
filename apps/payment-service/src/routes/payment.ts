/**
 * Payment routes: reserve seat, webhook receiver.
 *
 * Security & Reliability:
 * - Rate limiting on checkout creation.
 * - Server-controlled amounts (fetched from payment-service seats cache).
 * - Webhook HMAC signature verification via crypto.timingSafeEqual.
 * - Webhook freshness verification (timestamp check).
 * - Webhook idempotency via unique constraint on stripe_event_id in webhook_inbox.
 * - Webhook ack-fast pattern (verify signature -> insert inbox -> 200 OK, process async).
 */

import {
	createLogger,
	createRateLimiter,
	ResponseBuilder,
} from "@bed-stack/be-core";
import { Elysia, t } from "elysia";
import type Redis from "ioredis";
import type pg from "pg";
import type { PaymentServiceConfig } from "../config";
import type { MockStripeProvider } from "../services/provider";

const logger = createLogger("payment-routes");

interface SeatCacheRow {
	id: number;
	number: string;
	price_in_cents: number;
}

export function paymentRoutes(
	pool: pg.Pool,
	redis: Redis,
	config: PaymentServiceConfig,
	provider: MockStripeProvider,
) {
	// Rate limiter for payment attempts (e.g. 15 requests per minute per IP)
	const paymentLimiter = createRateLimiter(redis, "payment-rate-limit", {
		windowSeconds: 60,
		maxRequests: 15,
	});

	// Helper to extract client IP
	function getClientIP(request: Request): string {
		if (config.trustProxy) {
			const forwarded = request.headers.get("x-forwarded-for");
			if (forwarded) return forwarded.split(",")[0]?.trim() || "127.0.0.1";
			return request.headers.get("x-real-ip") || "127.0.0.1";
		}
		return "127.0.0.1";
	}

	return (
		new Elysia()
			// ─── Initiate Payment / Reserve Seat ──────────────────────────────────
			// Routes matching front-end call `/seats/:id/reserve`
			.post(
				"/seats/:id/reserve",
				async ({ params, jwt, cookie, set, body, request }) => {
					// 1. Rate Limiting Check
					const clientIP = getClientIP(request);
					const rateCheck = await paymentLimiter.check(clientIP);
					if (!rateCheck.allowed) {
						set.status = 429;
						set.headers["Retry-After"] = String(
							rateCheck.retryAfterSeconds || 60,
						);
						return ResponseBuilder.error(
							"Too many payment attempts. Please back off.",
							"RATE_LIMIT_EXCEEDED",
						);
					}

					// 2. Authentication Check
					const token = cookie?.token?.value;
					if (!token) {
						set.status = 401;
						return ResponseBuilder.unauthorized();
					}

					let userId: number;
					try {
						const payload = await jwt.verify(token);
						if (!payload || typeof payload === "boolean") {
							set.status = 401;
							return ResponseBuilder.unauthorized();
						}
						userId = payload.userId as number;
					} catch {
						set.status = 401;
						return ResponseBuilder.unauthorized();
					}

					const seatId = Number(params.id);
					if (Number.isNaN(seatId)) {
						set.status = 400;
						return ResponseBuilder.validation("Invalid seat ID");
					}

					// 3. Server-Controlled Amount Lookup
					const seatResult = await pool.query<SeatCacheRow>(
						"SELECT id, number, price_in_cents FROM seats WHERE id = $1",
						[seatId],
					);
					const seat = seatResult.rows[0];

					if (!seat) {
						set.status = 404;
						return ResponseBuilder.notFound("Seat details not found in cache");
					}

					const amountInCents = seat.price_in_cents;
					const simulatedOutcome = body.simulatedStatus || "success";

					const client = await pool.connect();
					try {
						await client.query("BEGIN");

						// 4. Create Payment Intent record
						// external_id is initially temporary, updated after calling Stripe
						const piResult = await client.query<{ id: number }>(
							`INSERT INTO payment_intents (external_id, user_id, seat_id, amount_in_cents, status)
						 VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
							[`tmp_pi_${crypto.randomUUID()}`, userId, seatId, amountInCents],
						);
						const intentRecord = piResult.rows[0]!;

						// 5. Invoke Payment Provider (Stripe SDK mock)
						const stripeIntent = await provider.createPaymentIntent(
							amountInCents,
							{
								seatId: String(seatId),
								userId: String(userId),
								dbIntentId: String(intentRecord.id),
							},
						);

						// Update record with official Stripe ID
						await client.query(
							`UPDATE payment_intents
						 SET external_id = $1
						 WHERE id = $2`,
							[stripeIntent.id, intentRecord.id],
						);

						await client.query("COMMIT");

						// 6. Simulate Webhook Delivery asynchronously
						const webhookType =
							simulatedOutcome === "success"
								? "payment_intent.succeeded"
								: "payment_intent.payment_failed";

						const eventId = `evt_mock_${crypto.randomUUID()}`;

						// Spawn asynchronous Stripe webhook notification
						// (The mock provider has a built-in delay and fetch payload construction)
						provider.simulateWebhookDelivery(
							eventId,
							webhookType,
							stripeIntent.id,
							seatId,
							userId,
							amountInCents,
							config.stripeWebhookSecret,
						);

						logger.info("Payment reservation initiated", {
							seatId,
							userId,
							paymentIntentId: stripeIntent.id,
							outcome: simulatedOutcome,
						});

						// Return success to the client
						return ResponseBuilder.success({
							message: "Payment initiated",
							paymentIntentId: stripeIntent.id,
						});
					} catch (err) {
						await client.query("ROLLBACK");
						logger.error("Failed to initiate payment intent", {
							error: err as Error,
							seatId,
							userId,
						});
						return ResponseBuilder.internal(
							"Failed to process payment request",
						);
					} finally {
						client.release();
					}
				},
				{
					params: t.Object({ id: t.String() }),
					body: t.Object({
						simulatedStatus: t.Optional(
							t.Union([t.Literal("success"), t.Literal("fail")]),
						),
					}),
				},
			)

			// ─── Stripe Webhook Receiver ──────────────────────────────────────
			// Webhook endpoint: POST /payments/webhook
			.post("/payments/webhook", async ({ request, set }) => {
				const signatureHeader = request.headers.get("Stripe-Signature");
				if (!signatureHeader) {
					logger.warn("Webhook request missing Stripe-Signature header");
					set.status = 400;
					return ResponseBuilder.validation("Missing Stripe-Signature header");
				}

				// Get raw request body as text for precise signature validation
				const rawBody = await request.text();

				// 1. Verify HMAC-SHA256 signature and timestamp freshness
				const isValid = provider.verifyWebhookSignature(
					rawBody,
					signatureHeader,
					config.stripeWebhookSecret,
					config.webhookToleranceSeconds,
				);

				if (!isValid) {
					logger.warn("Webhook signature validation failed");
					set.status = 401;
					return ResponseBuilder.unauthorized("Invalid webhook signature");
				}

				// 2. Parse event payload
				let event: { id: string; type: string };
				try {
					event = JSON.parse(rawBody);
				} catch (err) {
					logger.error("Failed to parse webhook JSON payload", {
						error: err as Error,
					});
					set.status = 400;
					return ResponseBuilder.validation("Invalid JSON payload");
				}

				const stripeEventId = event.id;
				const eventType = event.type;

				// 3. Webhook Idempotency & Ack-Fast Pattern
				// Insert the event into the inbox. Enforces unique constraint on stripe_event_id.
				try {
					await pool.query(
						`INSERT INTO webhook_inbox (stripe_event_id, event_type, payload, status)
						 VALUES ($1, $2, $3, 'PENDING')`,
						[stripeEventId, eventType, rawBody],
					);

					logger.info("Webhook event saved to inbox (ack-fast)", {
						stripeEventId,
						eventType,
					});

					// Return 200 immediately, letting the inbox worker process async
					return { received: true };
				} catch (err) {
					const pgErr = err as { code?: string };
					if (pgErr.code === "23505") {
						// Event already exists (duplicate delivery).
						// Acknowledge with 200 OK so Stripe does not retry.
						logger.debug("Duplicate webhook event received, acknowledging", {
							stripeEventId,
						});
						return { received: true, duplicate: true };
					}

					logger.error("Failed to store webhook in inbox", {
						error: err as Error,
						stripeEventId,
					});
					set.status = 500;
					return ResponseBuilder.internal("Failed to persist webhook event");
				}
			})
	);
}
