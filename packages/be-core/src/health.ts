/**
 * Health check Elysia plugin providing /health/live and /health/ready endpoints.
 * - /health/live: returns 200 if process is alive (liveness probe)
 * - /health/ready: checks all dependencies (readiness probe)
 */

import { Elysia } from "elysia";
import type Redis from "ioredis";
import type pg from "pg";
import { createLogger } from "./logger";

const logger = createLogger("health");

const startTime = Date.now();

export interface HealthDependency {
	name: string;
	check: () => Promise<boolean>;
}

/**
 * Build a health dependency checker for PostgreSQL.
 */
export function pgHealthCheck(pool: pg.Pool): HealthDependency {
	return {
		name: "postgres",
		check: async () => {
			try {
				const client = await pool.connect();
				await client.query("SELECT 1");
				client.release();
				return true;
			} catch {
				return false;
			}
		},
	};
}

/**
 * Build a health dependency checker for Redis.
 */
export function redisHealthCheck(redis: Redis): HealthDependency {
	return {
		name: "redis",
		check: async () => {
			try {
				const result = await redis.ping();
				return result === "PONG";
			} catch {
				return false;
			}
		},
	};
}

/**
 * Create Elysia health check plugin with liveness and readiness probes.
 * @param serviceName - Name of the service for identification
 * @param version - Service version string
 * @param dependencies - Array of health check dependencies
 */
export function healthPlugin(
	serviceName: string,
	version: string,
	dependencies: HealthDependency[],
) {
	return new Elysia({ name: "health" })
		.get("/health/live", () => ({
			status: "ok",
			service: serviceName,
			version,
			uptime: Math.floor((Date.now() - startTime) / 1000),
			timestamp: new Date().toISOString(),
		}))
		.get("/health/ready", async ({ set }) => {
			const results: Record<string, string> = {};
			let allHealthy = true;

			for (const dep of dependencies) {
				try {
					const healthy = await dep.check();
					results[dep.name] = healthy ? "up" : "down";
					if (!healthy) allHealthy = false;
				} catch {
					results[dep.name] = "down";
					allHealthy = false;
				}
			}

			const status = allHealthy ? "ready" : "degraded";

			if (!allHealthy) {
				set.status = 503;
				logger.warn("Health check degraded", { dependencies: results });
			}

			return {
				status,
				service: serviceName,
				version,
				uptime: Math.floor((Date.now() - startTime) / 1000),
				dependencies: results,
				timestamp: new Date().toISOString(),
			};
		});
}
