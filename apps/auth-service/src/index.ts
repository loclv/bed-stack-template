/**
 * Auth service — Elysia entry point.
 *
 * Handles authentication, user management, and session tokens.
 * Port: 3001 (configurable via AUTH_PORT)
 *
 * Bounded context: Identity & Access Management
 * Scale profile: CPU-bound (argon2id hashing)
 */

import {
	Counter,
	createDatabase,
	createLogger,
	createMetricsRegistry,
	createRateLimiter,
	createRedisClient,
	healthPlugin,
	installShutdownHandlers,
	metricsPlugin,
	onShutdown,
	pgHealthCheck,
	ResponseBuilder,
	redisHealthCheck,
} from "@bed-stack/be-core";
import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { Elysia } from "elysia";
import { loadAuthConfig } from "./config";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";

const config = loadAuthConfig();
const logger = createLogger("auth-service");

// ─── Infrastructure ──────────────────────────────────────────────────

const { pool, db } = createDatabase({
	connectionString: config.databaseUrl,
	maxConnections: 10, // auth is CPU-bound (argon2), fewer DB connections needed
});

const redis = createRedisClient(config.redisUrl);
await redis.connect();

// ─── Metrics ─────────────────────────────────────────────────────────

const metricsRegistry = createMetricsRegistry("auth-service");

const loginCounter = new Counter({
	name: "auth_login_total",
	help: "Total login attempts",
	labelNames: ["method", "status"],
	registers: [metricsRegistry],
});

const tokenRefreshCounter = new Counter({
	name: "auth_token_refresh_total",
	help: "Total token refresh attempts",
	labelNames: ["status"],
	registers: [metricsRegistry],
});

// ─── Rate Limiters ───────────────────────────────────────────────────

const loginLimiter = createRateLimiter(redis, "login", {
	windowSeconds: 60,
	maxRequests: 10, // 10 per minute per IP
});

// ─── App ─────────────────────────────────────────────────────────────

const app = new Elysia({ maxBodySize: 1024 * 1024 })
	.use(
		cors({
			origin: config.nodeEnv === "production" ? config.webUrl : true,
			credentials: true,
			methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
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
		healthPlugin("auth-service", "1.0.0", [
			pgHealthCheck(pool),
			redisHealthCheck(redis),
		]),
	)
	.use(metricsPlugin(metricsRegistry))
	// Security headers
	.onBeforeHandle(({ set }) => {
		set.headers["X-Content-Type-Options"] = "nosniff";
		set.headers["X-Frame-Options"] = "DENY";
		set.headers["Strict-Transport-Security"] =
			"max-age=31536000; includeSubDomains";
		set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
	})
	.use(
		authRoutes(
			pool,
			redis,
			config,
			loginLimiter,
			loginCounter,
			tokenRefreshCounter,
		),
	)
	.use(userRoutes(pool, config))
	.onError(({ error, code }) => {
		logger.error("Unhandled error", { error: error as Error, code });
		return ResponseBuilder.internal("An unexpected error occurred");
	})
	.listen(config.authPort);

logger.info(`Auth service running on port ${config.authPort}`, {
	port: config.authPort,
	nodeEnv: config.nodeEnv,
});

// ─── Graceful Shutdown ───────────────────────────────────────────────

installShutdownHandlers();

onShutdown(async () => {
	logger.info("Shutting down auth service...");
	app.stop();
});

onShutdown(async () => {
	await redis.quit();
	logger.info("Redis disconnected");
});

onShutdown(async () => {
	await pool.end();
	logger.info("Database pool closed");
});

export type AuthApp = typeof app;
