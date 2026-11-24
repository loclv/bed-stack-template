/**
 * Redis-backed rate limiter with per-endpoint configuration.
 * Uses sliding window counter pattern in Redis.
 */

import type Redis from "ioredis";
import { createLogger } from "./logger";

const logger = createLogger("rate-limiter");

export interface RateLimitConfig {
	/** Window duration in seconds. */
	windowSeconds: number;
	/** Max requests per window. */
	maxRequests: number;
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	resetTime: Date;
	totalHits: number;
	retryAfterSeconds?: number;
}

/**
 * Redis-backed sliding window rate limiter.
 * Each limiter instance handles a specific rate limit zone.
 */
export class RedisRateLimiter {
	constructor(
		private redis: Redis,
		private prefix: string,
		private config: RateLimitConfig,
	) {}

	/**
	 * Check if a request from the given identifier is allowed.
	 * Uses Redis INCR + EXPIRE for atomic sliding window.
	 */
	async check(identifier: string): Promise<RateLimitResult> {
		const key = `ratelimit:${this.prefix}:${identifier}`;
		const now = Date.now();

		try {
			const pipeline = this.redis.pipeline();
			pipeline.incr(key);
			pipeline.pttl(key);
			const results = await pipeline.exec();

			if (!results) {
				// Redis unavailable — fail open
				// TODO(prod): Monitor fail-open rate, alert if Redis down
				logger.warn("Rate limiter fail-open: Redis unavailable");
				return {
					allowed: true,
					remaining: this.config.maxRequests,
					resetTime: new Date(now + this.config.windowSeconds * 1000),
					totalHits: 0,
				};
			}

			const count = (results[0]?.[1] as number) || 0;
			const ttl = (results[1]?.[1] as number) || -1;

			// Set expiry on first request in window
			if (ttl === -1 || count === 1) {
				await this.redis.pexpire(key, this.config.windowSeconds * 1000);
			}

			const resetTime = new Date(
				now + (ttl > 0 ? ttl : this.config.windowSeconds * 1000),
			);
			const allowed = count <= this.config.maxRequests;
			const remaining = Math.max(0, this.config.maxRequests - count);

			if (!allowed) {
				const retryAfterSeconds = Math.ceil((resetTime.getTime() - now) / 1000);
				return {
					allowed: false,
					remaining: 0,
					resetTime,
					totalHits: count,
					retryAfterSeconds,
				};
			}

			return { allowed, remaining, resetTime, totalHits: count };
		} catch (err) {
			// Fail open on Redis errors — don't block requests
			logger.error("Rate limiter error, failing open", {
				error: err as Error,
				identifier,
			});
			return {
				allowed: true,
				remaining: this.config.maxRequests,
				resetTime: new Date(now + this.config.windowSeconds * 1000),
				totalHits: 0,
			};
		}
	}
}

/**
 * Create a rate limiter for a specific zone.
 */
export function createRateLimiter(
	redis: Redis,
	zone: string,
	config: RateLimitConfig,
): RedisRateLimiter {
	logger.info("Rate limiter created", { zone, ...config });
	return new RedisRateLimiter(redis, zone, config);
}
