/**
 * Payment Service — Elysia Entry Point.
 *
 * Handles payment intent registration and Stripe webhook notifications.
 * Port: 3003 (configurable via PAYMENT_PORT)
 *
 * Bounded context: Billing & Payments
 * Scale profile: I/O-bound (frequent outbound calls to payment gateway / Stripe APIs)
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
import { loadPaymentConfig } from "./config";
import { paymentRoutes } from "./routes/payment";
import { MockStripeProvider } from "./services/provider";
import { WebhookInboxWorker } from "./services/worker";

const config = loadPaymentConfig();
const logger = createLogger("payment-service");

// ─── Infrastructure ──────────────────────────────────────────────────

// Payment service is I/O-bound. Connection pool size 10 is standard.
const { pool } = createDatabase({
	connectionString: config.databaseUrl,
	maxConnections: 10,
});

const redis = createRedisClient(config.redisUrl);
await redis.connect();

const kafka = createKafkaClient({
	brokers: config.kafkaBrokers,
	clientId: "payment-service",
});

const kafkaProducer = new KafkaProducer(kafka);
await kafkaProducer.connect();

// ─── Metrics ─────────────────────────────────────────────────────────

const metricsRegistry = createMetricsRegistry("payment-service");

// ─── Payment Integration ──────────────────────────────────────────────

// We use self-referential path for simulated webhook callbacks.
// In a production environment, this would target the gateway endpoint.
const webhookUrl = `http://localhost:${config.paymentPort}/payments/webhook`;
const paymentProvider = new MockStripeProvider(webhookUrl);

// ─── Background Workers ──────────────────────────────────────────────

// Webhook inbox processor
const inboxWorker = new WebhookInboxWorker(pool);
inboxWorker.start();

// Outbox publisher (publishes payment events to Kafka)
const outboxWorker = new OutboxWorker(pool, kafkaProducer);
outboxWorker.start();

// ─── App Definition ──────────────────────────────────────────────────

const app = new Elysia({ maxBodySize: 1024 * 1024 })
	.use(
		cors({
			origin: config.nodeEnv === "production" ? config.webUrl : true,
			credentials: true,
			methods: ["GET", "POST", "OPTIONS"],
			allowedHeaders: ["Content-Type", "Authorization", "x-csrf-token"],
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
		healthPlugin("payment-service", "1.0.0", [
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
		logger.error("Unhandled error in payment-service", {
			error: error as Error,
			code,
		});
		return ResponseBuilder.internal(
			"An unexpected error occurred in billing services",
		);
	})
	.use(paymentRoutes(pool, redis, config, paymentProvider))
	.listen(config.paymentPort);

logger.info(`Payment service running on port ${config.paymentPort}`, {
	port: config.paymentPort,
	nodeEnv: config.nodeEnv,
});

// ─── Graceful Shutdown ───────────────────────────────────────────────

installShutdownHandlers();

onShutdown(async () => {
	logger.info("Shutting down payment service...");
	app.stop();
	inboxWorker.stop();
	outboxWorker.stop();
});

onShutdown(async () => {
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

export type PaymentApp = typeof app;
