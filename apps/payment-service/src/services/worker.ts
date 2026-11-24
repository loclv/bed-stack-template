/**
 * Webhook Inbox Worker.
 *
 * Periodically processes pending webhook events stored in webhook_inbox,
 * updates payment intent status, and publishes outbox events in a single transaction.
 *
 * Guarantees idempotency and replica-safe outbox delivery via SKIP LOCKED.
 */

import { appendOutbox, createLogger } from "@bed-stack/be-core";
import {
	createEvent,
	type PaymentCompletedPayload,
	type PaymentFailedPayload,
	TOPICS,
} from "@bed-stack/contracts";
import type pg from "pg";

const logger = createLogger("webhook-inbox-worker");

export interface WebhookInboxEntry {
	id: number;
	stripe_event_id: string;
	event_type: string;
	payload: {
		id: string;
		type: string;
		data: {
			object: {
				id: string;
				amount: number;
				metadata: {
					seatId: string;
					userId: string;
				};
			};
		};
	};
	status: string;
	retry_count: number;
}

export class WebhookInboxWorker {
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private running = false;

	constructor(
		private pool: pg.Pool,
		private pollIntervalMs = 2000,
		private maxRetries = 5,
	) {}

	/**
	 * Start the background worker.
	 */
	start(): void {
		if (this.running) return;
		this.running = true;
		this.intervalId = setInterval(
			() => this.processInboxBatch(),
			this.pollIntervalMs,
		);
		logger.info("Webhook inbox worker started", {
			pollIntervalMs: this.pollIntervalMs,
		});
	}

	/**
	 * Stop the background worker.
	 */
	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		this.running = false;
		logger.info("Webhook inbox worker stopped");
	}

	/**
	 * Process a batch of pending webhook events.
	 */
	private async processInboxBatch(): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");

			// Acquire rows using SKIP LOCKED for multi-instance safety
			const result = await client.query<WebhookInboxEntry>(
				`SELECT id, stripe_event_id, event_type, payload, status, retry_count
				 FROM webhook_inbox
				 WHERE status = 'PENDING'
				 ORDER BY id ASC
				 LIMIT 10
				 FOR UPDATE SKIP LOCKED`,
			);

			for (const entry of result.rows) {
				try {
					const event = entry.payload;
					const stripeEventId = entry.stripe_event_id;
					const eventType = entry.event_type;

					const stripeObject = event.data.object;
					const paymentIntentId = stripeObject.id;
					const amountInCents = stripeObject.amount;
					const seatId = Number(stripeObject.metadata.seatId);
					const userId = Number(stripeObject.metadata.userId);

					if (Number.isNaN(seatId) || Number.isNaN(userId)) {
						throw new Error(
							`Invalid metadata in webhook: seatId=${stripeObject.metadata.seatId}, userId=${stripeObject.metadata.userId}`,
						);
					}

					logger.info("Processing webhook event", {
						stripeEventId,
						eventType,
						paymentIntentId,
					});

					if (eventType === "payment_intent.succeeded") {
						// 1. Update status of payment intent in DB
						await client.query(
							`UPDATE payment_intents
							 SET status = 'completed', updated_at = NOW()
							 WHERE external_id = $1`,
							[paymentIntentId],
						);

						// 2. Transactional outbox: emit payment.completed event
						await appendOutbox(
							client,
							TOPICS.PAYMENT_COMPLETED,
							createEvent(TOPICS.PAYMENT_COMPLETED, "payment-service", {
								paymentIntentId,
								seatId,
								userId,
								amountInCents,
							} satisfies PaymentCompletedPayload) as any,
						);

						logger.info("Payment completed processed successfully", {
							paymentIntentId,
							seatId,
							userId,
						});
					} else if (eventType === "payment_intent.payment_failed") {
						// 1. Update status to failed
						await client.query(
							`UPDATE payment_intents
							 SET status = 'failed', updated_at = NOW()
							 WHERE external_id = $1`,
							[paymentIntentId],
						);

						// 2. Transactional outbox: emit payment.failed event
						await appendOutbox(
							client,
							TOPICS.PAYMENT_FAILED,
							createEvent(TOPICS.PAYMENT_FAILED, "payment-service", {
								paymentIntentId,
								seatId,
								userId,
								reason: "Payment failed during simulated charge",
							} satisfies PaymentFailedPayload) as any,
						);

						logger.info("Payment failed processed successfully", {
							paymentIntentId,
							seatId,
							userId,
						});
					}

					// Mark webhook event as processed
					await client.query(
						`UPDATE webhook_inbox
						 SET status = 'DONE', processed_at = NOW()
						 WHERE id = $1`,
						[entry.id],
					);
				} catch (err) {
					const newRetryCount = entry.retry_count + 1;
					const nextStatus =
						newRetryCount >= this.maxRetries ? "DEAD" : "PENDING";

					await client.query(
						`UPDATE webhook_inbox
						 SET status = $1, retry_count = $2
						 WHERE id = $3`,
						[nextStatus, newRetryCount, entry.id],
					);

					logger.error("Failed to process webhook entry", {
						id: entry.id,
						stripeEventId: entry.stripe_event_id,
						retryCount: newRetryCount,
						status: nextStatus,
						error: err as Error,
					});
				}
			}

			await client.query("COMMIT");
		} catch (err) {
			await client.query("ROLLBACK");
			logger.error("Failed webhook inbox batch processing", {
				error: err as Error,
			});
		} finally {
			client.release();
		}
	}
}
