import { beforeEach, describe, expect, it } from "bun:test";
import { RateLimiter, type RateLimitOptions } from "../src/utils/rate-limiter";

describe("RateLimiter", () => {
	let limiter: RateLimiter;
	const defaultOptions: RateLimitOptions = {
		windowMs: 60000,
		maxRequests: 5,
	};

	beforeEach(() => {
		limiter = new RateLimiter();
	});

	describe("createLimiter", () => {
		it("should create a new limiter with given options", () => {
			const result = limiter.createLimiter("test", defaultOptions);

			expect(result).toBeDefined();
		});

		it("should create limiters with custom keyGenerator", () => {
			const customOptions: RateLimitOptions = {
				windowMs: 60000,
				maxRequests: 10,
				keyGenerator: (id) => `custom:${id}`,
			};

			const result = limiter.createLimiter("custom", customOptions);
			expect(result).toBeDefined();
		});
	});

	describe("getLimiter", () => {
		it("should retrieve a previously created limiter", () => {
			limiter.createLimiter("test", defaultOptions);
			const result = limiter.getLimiter("test");

			expect(result).toBeDefined();
		});

		it("should return undefined for non-existent limiter", () => {
			const result = limiter.getLimiter("non-existent");

			expect(result).toBeUndefined();
		});
	});

	describe("MemoryRateLimiter.check", () => {
		it("should allow requests within limit", () => {
			const rateLimiter = limiter.createLimiter("test", defaultOptions);
			const result = rateLimiter.check("user-1");

			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(4);
			expect(result.totalHits).toBe(1);
		});

		it("should track multiple requests correctly", () => {
			const rateLimiter = limiter.createLimiter("test", defaultOptions);

			rateLimiter.check("user-1");
			rateLimiter.check("user-1");
			const result = rateLimiter.check("user-1");

			expect(result.allowed).toBe(true);
			expect(result.totalHits).toBe(3);
			expect(result.remaining).toBe(2);
		});

		it("should block requests exceeding limit", () => {
			const rateLimiter = limiter.createLimiter("test", {
				windowMs: 60000,
				maxRequests: 2,
			});

			rateLimiter.check("user-1");
			rateLimiter.check("user-1");
			const result = rateLimiter.check("user-1");

			expect(result.allowed).toBe(false);
			expect(result.remaining).toBe(0);
		});

		it("should track different identifiers separately", () => {
			const rateLimiter = limiter.createLimiter("test", {
				windowMs: 60000,
				maxRequests: 2,
			});

			rateLimiter.check("user-1");
			rateLimiter.check("user-1");
			const result = rateLimiter.check("user-2");

			expect(result.allowed).toBe(true);
			expect(result.totalHits).toBe(1);
		});

		it("should use custom keyGenerator", () => {
			const customOptions: RateLimitOptions = {
				windowMs: 60000,
				maxRequests: 2,
				keyGenerator: (id) => `ip:${id}`,
			};

			const rateLimiter = limiter.createLimiter("test", customOptions);

			rateLimiter.check("192.168.1.1");
			rateLimiter.check("192.168.1.1");
			const result = rateLimiter.check("192.168.1.1");

			expect(result.allowed).toBe(false);
		});

		it("should return correct resetTime", () => {
			const rateLimiter = limiter.createLimiter("test", defaultOptions);
			const result = rateLimiter.check("user-1");

			expect(result.resetTime).toBeInstanceOf(Date);
			expect(result.resetTime.getTime()).toBeGreaterThan(Date.now());
		});
	});
});
