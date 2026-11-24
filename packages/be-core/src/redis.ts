/**
 * Redis client wrapper for caching, rate limiting, and pub/sub.
 * Uses ioredis for robust connection handling with reconnection.
 */

import Redis from "ioredis";
import { createLogger } from "./logger";

const logger = createLogger("redis");

/**
 * Create a Redis client with connection event logging.
 */
export function createRedisClient(url: string): Redis {
	const client = new Redis(url, {
		maxRetriesPerRequest: 3,
		lazyConnect: true,
		retryStrategy: (times: number) => {
			if (times > 10) {
				logger.error("Redis: max reconnection attempts reached");
				return null;
			}
			return Math.min(times * 200, 5000);
		},
	});

	client.on("connect", () => {
		logger.info("Redis connected");
	});

	client.on("error", (err) => {
		logger.error("Redis error", { error: err });
	});

	client.on("close", () => {
		logger.warn("Redis connection closed");
	});

	return client;
}

/**
 * Create a separate Redis client for pub/sub subscriber.
 * Pub/sub requires a dedicated connection since it enters subscriber mode.
 */
export function createRedisSubscriber(url: string): Redis {
	const sub = createRedisClient(url);
	logger.info("Redis subscriber client created");
	return sub;
}

export type { Redis };
