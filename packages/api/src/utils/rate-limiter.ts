import { logger } from "./logger";

export interface RateLimitOptions {
	windowMs: number;
	maxRequests: number;
	keyGenerator?: (identifier: string) => string;
	skipSuccessfulRequests?: boolean;
	skipFailedRequests?: boolean;
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	resetTime: Date;
	totalHits: number;
}

class MemoryRateLimiter {
	private requests: Map<string, { count: number; resetTime: Date }> = new Map();

	constructor(private options: RateLimitOptions) {}

	private getKey(identifier: string): string {
		if (this.options.keyGenerator) {
			return this.options.keyGenerator(identifier);
		}
		return `rate_limit:${identifier}`;
	}

	private cleanup(): void {
		const now = new Date();
		for (const [key, data] of this.requests.entries()) {
			if (now > data.resetTime) {
				this.requests.delete(key);
			}
		}
	}

	check(identifier: string): RateLimitResult {
		this.cleanup();
		const key = this.getKey(identifier);
		const now = new Date();

		const existing = this.requests.get(key);

		if (!existing || now > existing.resetTime) {
			const resetTime = new Date(now.getTime() + this.options.windowMs);
			this.requests.set(key, { count: 1, resetTime });

			return {
				allowed: true,
				remaining: this.options.maxRequests - 1,
				resetTime,
				totalHits: 1,
			};
		}

		const newCount = existing.count + 1;
		const allowed = newCount <= this.options.maxRequests;

		if (allowed) {
			existing.count = newCount;
		}

		return {
			allowed,
			remaining: Math.max(0, this.options.maxRequests - newCount),
			resetTime: existing.resetTime,
			totalHits: newCount,
		};
	}
}

export class RateLimiter {
	private limiters: Map<string, MemoryRateLimiter> = new Map();

	createLimiter(name: string, options: RateLimitOptions): MemoryRateLimiter {
		const limiter = new MemoryRateLimiter(options);
		this.limiters.set(name, limiter);
		logger.info("Rate limiter created", { name, options });
		return limiter;
	}

	getLimiter(name: string): MemoryRateLimiter | undefined {
		return this.limiters.get(name);
	}
}

export const rateLimiter = new RateLimiter();

export const authRateLimitOptions: RateLimitOptions = {
	windowMs: 15 * 60 * 1000, // 15 minutes
	maxRequests: 5, // 5 attempts per 15 minutes
	keyGenerator: (identifier: string) => `auth:${identifier}`,
};

export const generalRateLimitOptions: RateLimitOptions = {
	windowMs: 15 * 60 * 1000, // 15 minutes
	maxRequests: 100, // 100 requests per 15 minutes
	keyGenerator: (identifier: string) => `general:${identifier}`,
};
