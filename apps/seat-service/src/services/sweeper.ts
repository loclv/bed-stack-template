/**
 * Expired hold sweeper service.
 *
 * Periodically cleans up expired seat holds using batch processing
 * with FOR UPDATE SKIP LOCKED for replica-safe operation.
 *
 * Trade-off: sweeper is proactive (no stale UI) vs lazy cleanup (simpler).
 * We chose sweeper because stale held seats block other users.
 * TODO(prod): For multi-instance deployments, SKIP LOCKED ensures no coordination needed.
 */

import { Counter, createLogger, type Registry } from "@bed-stack/be-core";
import type pg from "pg";
import type { SeatServiceConfig } from "../config";

const logger = createLogger("sweeper");

/**
 * Background job that releases expired seat holds.
 * Uses FOR UPDATE SKIP LOCKED so multiple replicas can run safely.
 */
export class HoldSweeper {
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private running = false;
	private sweepCounter: Counter;

	constructor(
		private pool: pg.Pool,
		private config: SeatServiceConfig,
		metricsRegistry: Registry,
	) {
		this.sweepCounter = new Counter({
			name: "seats_sweep_released_total",
			help: "Total seats released by sweeper",
			registers: [metricsRegistry],
		});
	}

	/**
	 * Start the sweeper background job.
	 */
	start(): void {
		if (this.running) return;
		this.running = true;

		// Run immediately on start, then on interval
		this.sweep();
		this.intervalId = setInterval(
			() => this.sweep(),
			this.config.sweeperIntervalMs,
		);

		logger.info("Hold sweeper started", {
			intervalMs: this.config.sweeperIntervalMs,
			batchSize: this.config.sweeperBatchSize,
		});
	}

	/**
	 * Stop the sweeper gracefully.
	 */
	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		this.running = false;
		logger.info("Hold sweeper stopped");
	}

	/**
	 * Sweep one batch of expired holds.
	 *
	 * Uses SKIP LOCKED to avoid contention with other sweeper replicas
	 * or concurrent hold/release operations. This is safer than advisory
	 * locks because it works correctly with PgBouncer transaction pooling.
	 */
	private async sweep(): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");

			// Select expired holds with SKIP LOCKED (replica-safe)
			const result = await client.query<{
				id: number;
				number: string;
				held_by: number;
			}>(
				`SELECT id, number, held_by FROM seats
				 WHERE status = 'held' AND held_until < NOW()
				 ORDER BY held_until ASC
				 LIMIT $1
				 FOR UPDATE SKIP LOCKED`,
				[this.config.sweeperBatchSize],
			);

			if (result.rows.length === 0) {
				await client.query("COMMIT");
				return;
			}

			const ids = result.rows.map((r) => r.id);

			// Release all expired holds in batch
			await client.query(
				`UPDATE seats
				 SET status = 'available', held_by = NULL, held_at = NULL, held_until = NULL
				 WHERE id = ANY($1)`,
				[ids],
			);

			await client.query("COMMIT");

			this.sweepCounter.inc(result.rows.length);
			logger.info("Swept expired holds", {
				count: result.rows.length,
				seats: result.rows.map((r) => r.number),
			});
		} catch (err) {
			await client.query("ROLLBACK");
			logger.error("Sweep failed", { error: err as Error });
		} finally {
			client.release();
		}
	}
}
