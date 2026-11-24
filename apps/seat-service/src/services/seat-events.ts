/**
 * Kafka consumer for payment events in the seat service.
 * Handles compensation: releases seat when payment fails.
 *
 * Idempotency: uses processed_events table with UNIQUE(event_id, consumer_group).
 */

import {
	Counter,
	createKafkaClient,
	createLogger,
	KafkaConsumer,
	type Registry,
} from "@bed-stack/be-core";
import {
	type EventEnvelope,
	type PaymentCompletedPayload,
	type PaymentFailedPayload,
	TOPICS,
} from "@bed-stack/contracts";
import type pg from "pg";

const logger = createLogger("seat-event-consumer");
const CONSUMER_GROUP = "seat-service";

/**
 * Start the Kafka consumer for payment events.
 */
export async function startSeatEventConsumer(
	pool: pg.Pool,
	kafkaBrokers: string[],
	metricsRegistry: Registry,
): Promise<KafkaConsumer> {
	const kafka = createKafkaClient({
		brokers: kafkaBrokers,
		clientId: "seat-service",
	});

	const consumer = new KafkaConsumer(kafka, CONSUMER_GROUP);
	await consumer.connect();

	const compensationCounter = new Counter({
		name: "seat_compensation_total",
		help: "Total seat compensations (release on payment fail)",
		labelNames: ["result"],
		registers: [metricsRegistry],
	});

	await consumer.subscribe(
		[TOPICS.PAYMENT_COMPLETED, TOPICS.PAYMENT_FAILED],
		async ({ topic, message }) => {
			if (!message.value) return;

			const event = JSON.parse(message.value.toString()) as EventEnvelope<
				PaymentCompletedPayload | PaymentFailedPayload
			>;

			const eventId = event.eventId;
			const client = await pool.connect();

			try {
				await client.query("BEGIN");

				// Idempotency check: has this event been processed already?
				const existing = await client.query(
					`SELECT id FROM processed_events
					 WHERE event_id = $1 AND consumer_group = $2`,
					[eventId, CONSUMER_GROUP],
				);

				if (existing.rows.length > 0) {
					await client.query("COMMIT");
					logger.debug("Event already processed, skipping", { eventId });
					return;
				}

				if (topic === TOPICS.PAYMENT_COMPLETED) {
					const payload = event.payload as PaymentCompletedPayload;
					await handlePaymentCompleted(client, payload);
					compensationCounter.inc({ result: "reserved" });
				} else if (topic === TOPICS.PAYMENT_FAILED) {
					const payload = event.payload as PaymentFailedPayload;
					await handlePaymentFailed(client, payload);
					compensationCounter.inc({ result: "released" });
				}

				// Mark event as processed (idempotency)
				await client.query(
					`INSERT INTO processed_events (event_id, consumer_group)
					 VALUES ($1, $2)`,
					[eventId, CONSUMER_GROUP],
				);

				await client.query("COMMIT");
			} catch (err) {
				await client.query("ROLLBACK");
				logger.error("Failed to process payment event", {
					error: err as Error,
					eventId,
					topic,
				});
				throw err; // Will be retried by Kafka consumer
			} finally {
				client.release();
			}
		},
	);

	logger.info("Seat event consumer started", {
		topics: [TOPICS.PAYMENT_COMPLETED, TOPICS.PAYMENT_FAILED],
	});

	return consumer;
}

/**
 * Handle successful payment: finalize reservation.
 */
async function handlePaymentCompleted(
	client: pg.PoolClient,
	payload: PaymentCompletedPayload,
): Promise<void> {
	// Reserve the seat
	await client.query(
		`UPDATE seats
		 SET status = 'reserved', reserved_by = $1, reserved_at = NOW(),
		     held_by = NULL, held_at = NULL, held_until = NULL
		 WHERE id = $2 AND status = 'held' AND held_by = $1`,
		[payload.userId, payload.seatId],
	);

	// Create reservation record
	await client.query(
		`INSERT INTO reservations (seat_id, user_id, payment_intent_id, amount_in_cents)
		 VALUES ($1, $2, $3, $4)`,
		[
			payload.seatId,
			payload.userId,
			payload.paymentIntentId,
			payload.amountInCents,
		],
	);

	logger.info("Seat reserved via payment completion", {
		seatId: payload.seatId,
		userId: payload.userId,
	});
}

/**
 * Handle failed payment: release the hold (compensation).
 */
async function handlePaymentFailed(
	client: pg.PoolClient,
	payload: PaymentFailedPayload,
): Promise<void> {
	await client.query(
		`UPDATE seats
		 SET status = 'available', held_by = NULL, held_at = NULL, held_until = NULL
		 WHERE id = $1 AND status = 'held' AND held_by = $2`,
		[payload.seatId, payload.userId],
	);

	logger.info("Seat released due to payment failure (compensation)", {
		seatId: payload.seatId,
		userId: payload.userId,
		reason: payload.reason,
	});
}
