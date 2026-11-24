import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { authPlugin } from "./routes/auth";
import { seatsPlugin } from "./routes/seats";
import { usersPlugin } from "./routes/users";
import { config } from "./utils/const";
import { logger } from "./utils/logger";
import { generalRateLimitOptions, rateLimiter } from "./utils/rate-limiter";
import { ResponseBuilder } from "./utils/response";

const generalLimiter = rateLimiter.createLimiter(
	"general",
	generalRateLimitOptions,
);

const app = new Elysia({
	maxBodySize: 1024 * 1024, // 1MB request body limit
})
	.use(
		config.nodeEnv !== "production"
			? openapi({
					path: "/openapi",
					documentation: {
						info: {
							title: "Seat Reservation API",
							version: "1.0.0",
						},
					},
				})
			: (app) => app,
	)
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
	.use(authPlugin)
	.use(usersPlugin)
	.use(seatsPlugin)

	.derive(({ request }) => {
		// Extract client IP — only trust proxy headers when TRUST_PROXY=true
		let clientIP = "127.0.0.1";
		if (config.trustProxy) {
			const forwarded = request.headers.get("x-forwarded-for");
			if (forwarded) {
				// Take the first (leftmost) IP, which is the original client
				clientIP = forwarded.split(",")[0]?.trim() || clientIP;
			} else {
				clientIP = request.headers.get("x-real-ip") || clientIP;
			}
		}

		const rateLimitResult = generalLimiter.check(clientIP);
		return {
			rateLimitResult,
			clientIP,
		};
	})
	.onBeforeHandle(({ rateLimitResult, set }) => {
		if (!rateLimitResult.allowed) {
			logger.warn("Rate limit exceeded", {
				clientIP: rateLimitResult,
				totalHits: rateLimitResult.totalHits,
				resetTime: rateLimitResult.resetTime,
			});
			set.status = 429;
			return ResponseBuilder.error("Too many requests", "RATE_LIMIT_EXCEEDED", {
				retryAfter: Math.ceil(
					(rateLimitResult.resetTime.getTime() - Date.now()) / 1000,
				),
			});
		}
	})
	.onBeforeHandle(({ set }) => {
		set.headers["X-Content-Type-Options"] = "nosniff";
		set.headers["X-Frame-Options"] = "DENY";
		set.headers["Strict-Transport-Security"] =
			"max-age=31536000; includeSubDomains";
		set.headers["Content-Security-Policy"] =
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'";
		set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
		set.headers["Permissions-Policy"] =
			"camera=(), microphone=(), geolocation=(), interest-cohort=()";
	})
	.get("/", () => {
		return ResponseBuilder.success({
			message: "Seat Reservation API",
			version: "1.0.0",
		});
	})
	.onError(({ error, code }) => {
		logger.error("Unhandled error", { error: error as Error, code });
		return ResponseBuilder.internal("An unexpected error occurred");
	})
	.listen(config.apiPort);

export type App = typeof app;
export { app };

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
