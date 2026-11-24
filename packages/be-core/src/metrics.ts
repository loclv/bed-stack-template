/**
 * Prometheus metrics endpoint for business and infrastructure monitoring.
 * Provides counters and histograms via prom-client.
 */

import { Elysia } from "elysia";
import {
	Counter,
	collectDefaultMetrics,
	Histogram,
	Registry,
} from "prom-client";
import { createLogger } from "./logger";

const logger = createLogger("metrics");

/**
 * Create a metrics registry with default Node.js metrics.
 */
export function createMetricsRegistry(serviceName: string): Registry {
	const registry = new Registry();
	registry.setDefaultLabels({ service: serviceName });
	collectDefaultMetrics({ register: registry });
	logger.info("Metrics registry created", { service: serviceName });
	return registry;
}

/**
 * Create an Elysia plugin that exposes /metrics endpoint.
 */
export function metricsPlugin(registry: Registry) {
	return new Elysia({ name: "metrics" }).get("/metrics", async ({ set }) => {
		set.headers["content-type"] = registry.contentType;
		return registry.metrics();
	});
}

/**
 * Pre-built business metric counters.
 * Each service should create its own counters for domain-specific events.
 */
export function createBusinessCounters(registry: Registry) {
	const httpRequestsTotal = new Counter({
		name: "http_requests_total",
		help: "Total HTTP requests",
		labelNames: ["method", "path", "status"],
		registers: [registry],
	});

	const httpRequestDuration = new Histogram({
		name: "http_request_duration_seconds",
		help: "HTTP request duration in seconds",
		labelNames: ["method", "path"],
		buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
		registers: [registry],
	});

	return { httpRequestsTotal, httpRequestDuration };
}

export { Counter, Histogram, Registry };
