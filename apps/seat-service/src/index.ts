/**
 * Seat service — Elysia entry point.
 *
 * Handles seat listing, holding, releasing, and real-time updates via SSE.
 * Port: 3002 (configurable via SEAT_PORT)
 *
 * Bounded context: Seat Inventory & Availability
 * Scale profile: DB-bound (frequent reads, lock contention under load)
 */

import {
	createDatabase,
	createKafkaClient,
	createLogger,
	createMetricsRegistry,
	createRedisClient,
	healthPlugin,
	installShutdownHandlers,
	KafkaProducer,
	metricsPlugin,
	OutboxWorker,
	onShutdown,
	pgHealthCheck,
	ResponseBuilder,
	redisHealthCheck,
} from "@bed-stack/be-core";
import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { Elysia } from "elysia";
import { loadSeatConfig } from "./config";
import { seatRoutes } from "./routes/seats";
import { startSeatEventConsumer } from "./services/seat-events";
import { HoldSweeper } from "./services/sweeper";

const config = loadSeatConfig();
const logger = createLogger("seat-service");

// ─── Infrastructure ──────────────────────────────────────────────────

const { pool } = createDatabase({
	connectionString: config.databaseUrl,
	maxConnections: 20, // seat service is DB-bound, more connections needed
});

const redis = createRedisClient(config.redisUrl);
await redis.connect();

const kafka = createKafkaClient({
	brokers: config.kafkaBrokers,
	clientId: "seat-service",
});

const kafkaProducer = new KafkaProducer(kafka);
await kafkaProducer.connect();

// ─── Metrics ─────────────────────────────────────────────────────────

const metricsRegistry = createMetricsRegistry("seat-service");

// ─── Background Workers ──────────────────────────────────────────────

// Expired hold sweeper
const sweeper = new HoldSweeper(pool, config, metricsRegistry);
sweeper.start();

// Outbox worker (publishes seat events to Kafka)
const outboxWorker = new OutboxWorker(pool, kafkaProducer);
outboxWorker.start();

// Kafka consumer for payment events (compensation)
const eventConsumer = await startSeatEventConsumer(
	pool,
	config.kafkaBrokers,
	metricsRegistry,
);

// ─── App ─────────────────────────────────────────────────────────────

const app = new Elysia({ maxBodySize: 1024 * 1024 })
	.use(
		cors({
			origin: config.nodeEnv === "production" ? config.webUrl : true,
			credentials: true,
			methods: ["GET", "POST", "OPTIONS"],
			allowedHeaders: ["Content-Type", "Authorization"],
		}),
	)
	.use(
		jwt({
			name: "jwt",
			secret: config.jwtSecret,
			alg: "HS256",
		}),
	)
	.use(
		healthPlugin("seat-service", "1.0.0", [
			pgHealthCheck(pool),
			redisHealthCheck(redis),
		]),
	)
	.use(metricsPlugin(metricsRegistry))
	.onBeforeHandle(({ set }) => {
		set.headers["X-Content-Type-Options"] = "nosniff";
		set.headers["X-Frame-Options"] = "DENY";
		set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
	})
	// NOTE: Elysia hooks are positional — onError must be registered before
	// route plugins to apply to them.
	.onError(({ error, code }) => {
		logger.error("Unhandled error", { error: error as Error, code });
		return ResponseBuilder.internal("An unexpected error occurred");
	})
	.use(seatRoutes(pool, redis, config, metricsRegistry))
	.listen(config.seatPort);

logger.info(`Seat service running on port ${config.seatPort}`, {
	port: config.seatPort,
	nodeEnv: config.nodeEnv,
});

// ─── Graceful Shutdown ───────────────────────────────────────────────

installShutdownHandlers();

onShutdown(async () => {
	logger.info("Shutting down seat service...");
	app.stop();
	sweeper.stop();
	outboxWorker.stop();
});

onShutdown(async () => {
	await eventConsumer.disconnect();
	await kafkaProducer.disconnect();
	logger.info("Kafka disconnected");
});

onShutdown(async () => {
	await redis.quit();
	logger.info("Redis disconnected");
});

onShutdown(async () => {
	await pool.end();
	logger.info("Database pool closed");
});
