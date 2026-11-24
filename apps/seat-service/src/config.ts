/**
 * Seat service configuration.
 * Extends base config with seat-specific environment variables.
 */

import {
	type BaseServiceConfig,
	getEnv,
	getEnvNumber,
	loadBaseConfig,
} from "@bed-stack/be-core/config";

export interface SeatServiceConfig extends BaseServiceConfig {
	seatPort: number;
	holdTtlSeconds: number;
	sweeperIntervalMs: number;
	sweeperBatchSize: number;
	webUrl: string;
}

/**
 * Load seat service configuration from environment variables.
 */
export function loadSeatConfig(): SeatServiceConfig {
	const base = loadBaseConfig("seat");
	return {
		...base,
		seatPort: getEnvNumber("SEAT_PORT", 3002),
		holdTtlSeconds: getEnvNumber("HOLD_TTL_SECONDS", 300), // 5 minutes
		sweeperIntervalMs: getEnvNumber("SWEEPER_INTERVAL_MS", 30_000), // 30s
		sweeperBatchSize: getEnvNumber("SWEEPER_BATCH_SIZE", 50),
		webUrl: getEnv("WEB_URL", "http://localhost:4097"),
	};
}
