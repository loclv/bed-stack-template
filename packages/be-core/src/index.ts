/**
 * @bed-stack/be-core
 *
 * Shared backend utilities for all microservices.
 * Provides config, logging, database, Redis, Kafka, health, shutdown, metrics.
 */

export {
	type AuthMiddlewareConfig,
	authMiddleware,
	extractToken,
	getTokenVersion,
	invalidateTokenVersionCache,
	type JwtPayload,
} from "./auth-middleware";
export {
	type BaseServiceConfig,
	getEnv,
	getEnvBool,
	getEnvNumber,
	getRequiredEnv,
	loadBaseConfig,
} from "./config";
export { createDatabase, runSQL } from "./database";
export {
	type HealthDependency,
	healthPlugin,
	pgHealthCheck,
	redisHealthCheck,
} from "./health";
export {
	createKafkaClient,
	type KafkaConfig,
	KafkaConsumer,
	KafkaProducer,
} from "./kafka";
export { createLogger, Logger, LogLevel } from "./logger";
export {
	Counter,
	createBusinessCounters,
	createMetricsRegistry,
	Histogram,
	metricsPlugin,
	Registry,
} from "./metrics";
export { appendOutbox, type OutboxEntry, OutboxWorker } from "./outbox";
export {
	createRateLimiter,
	type RateLimitConfig,
	type RateLimitResult,
	RedisRateLimiter,
} from "./rate-limiter";
export { createRedisClient, createRedisSubscriber } from "./redis";
export {
	type ApiResponse,
	type PaginatedResponse,
	ResponseBuilder,
} from "./response";
export { installShutdownHandlers, onShutdown } from "./shutdown";
