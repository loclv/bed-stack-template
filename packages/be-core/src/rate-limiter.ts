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
	 * Atomically increment the counter, set the window expiry on first hit,
	 * and read the remaining TTL — all in one Lua script so a crash or
	 * concurrent request can't leave a key without an expiry (which would
	 * rate-limit that identifier forever).
	 */
	private static readonly CHECK_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

	/**
	 * Check if a request from the given identifier is allowed.
	 * Uses a Lua script for an atomic fixed-window counter.
	 */
	async check(identifier: string): Promise<RateLimitResult> {
		const key = `ratelimit:${this.prefix}:${identifier}`;
		const now = Date.now();
		const windowMs = this.config.windowSeconds * 1000;

		try {
			const results = (await this.redis.eval(
				RedisRateLimiter.CHECK_SCRIPT,
				1,
				key,
				windowMs,
			)) as [number, number];

			const count = results[0] || 0;
			const ttl = results[1] || -1;

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
