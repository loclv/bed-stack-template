/**
 * Transactional outbox pattern implementation.
 * Writes events to an outbox table in the same transaction as business data,
 * then a worker polls and publishes to Kafka.
 *
 * This guarantees at-least-once delivery without 2PC.
 */

import type pg from "pg";
import type { KafkaProducer } from "./kafka";
import { createLogger } from "./logger";

const logger = createLogger("outbox");

/** Default batch size for outbox processing. */
const DEFAULT_BATCH_SIZE = 50;
/** Default max retries before marking as DEAD. */
const DEFAULT_MAX_RETRIES = 5;
/** Default poll interval in ms. */
const DEFAULT_POLL_INTERVAL_MS = 5000;

export interface OutboxEntry {
	id: number;
	event_type: string;
	payload: Record<string, unknown>;
	status: string;
	retry_count: number;
	max_retries: number;
}

/**
 * Append an outbox entry within an existing transaction.
 * Call this in the same transaction as your business update.
 *
 * @param client - PG client from the active transaction
 * @param eventType - Kafka topic / event type
 * @param payload - Event payload object
 */
export async function appendOutbox(
	client: pg.PoolClient,
	eventType: string,
	payload: Record<string, unknown>,
): Promise<void> {
	await client.query(
		`INSERT INTO outbox (event_type, payload, status, retry_count, max_retries)
		 VALUES ($1, $2, 'PENDING', 0, $3)`,
		[eventType, JSON.stringify(payload), DEFAULT_MAX_RETRIES],
	);
}

/**
 * Outbox worker that polls pending entries and publishes to Kafka.
 * Uses FOR UPDATE SKIP LOCKED for replica-safe processing.
 */
export class OutboxWorker {
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private running = false;

	constructor(
		private pool: pg.Pool,
		private producer: KafkaProducer,
		private batchSize: number = DEFAULT_BATCH_SIZE,
		private pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
	) {}

	/**
	 * Start polling the outbox table.
	 */
	start(): void {
		if (this.running) return;
		this.running = true;
		this.intervalId = setInterval(
			() => this.processBatch(),
			this.pollIntervalMs,
		);
		logger.info("Outbox worker started", {
			batchSize: this.batchSize,
			pollIntervalMs: this.pollIntervalMs,
		});
	}

	/**
	 * Stop the outbox worker gracefully.
	 */
	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		this.running = false;
		logger.info("Outbox worker stopped");
	}

	/**
	 * Process one batch of outbox entries.
	 * Uses SKIP LOCKED so multiple replicas can run concurrently without conflict.
	 */
	private async processBatch(): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");

			// SKIP LOCKED: safe for multiple worker replicas
			const result = await client.query<OutboxEntry>(
				`SELECT id, event_type, payload, status, retry_count, max_retries
				 FROM outbox
				 WHERE status = 'PENDING'
				 ORDER BY id ASC
				 LIMIT $1
				 FOR UPDATE SKIP LOCKED`,
				[this.batchSize],
			);

			for (const entry of result.rows) {
				try {
					await this.producer.publish(
						entry.event_type,
						String(entry.id),
						entry.payload,
					);

					await client.query(
						`UPDATE outbox SET status = 'DONE', processed_at = NOW() WHERE id = $1`,
						[entry.id],
					);
				} catch (err) {
					const newRetryCount = entry.retry_count + 1;
					const newStatus =
						newRetryCount >= entry.max_retries ? "DEAD" : "PENDING";

					await client.query(
						`UPDATE outbox SET status = $1, retry_count = $2 WHERE id = $3`,
						[newStatus, newRetryCount, entry.id],
					);

					if (newStatus === "DEAD") {
						// TODO(prod): Alert on DEAD outbox entries (PagerDuty/Slack)
						logger.error("Outbox entry moved to DEAD", {
							entryId: entry.id,
							eventType: entry.event_type,
							error: err as Error,
						});
					} else {
						logger.warn("Outbox entry retry", {
							entryId: entry.id,
							retryCount: newRetryCount,
							error: err as Error,
						});
					}
				}
			}

			await client.query("COMMIT");
		} catch (err) {
			await client.query("ROLLBACK");
			logger.error("Outbox batch processing failed", { error: err as Error });
		} finally {
			client.release();
		}
	}
}
