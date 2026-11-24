/**
 * Auth routes: login, register, OAuth callback, refresh, logout, logout-all.
 *
 * Security highlights:
 * - Argon2id password hashing with timing equalization
 * - Opaque refresh tokens in httpOnly cookies (SHA-256 hashed in DB)
 * - Token rotation with family tracking and reuse detection
 * - Audit logging for sensitive actions
 */

import {
	createCsrfProtection,
	createLogger,
	publishTokenVersion,
	ResponseBuilder,
} from "@bed-stack/be-core";
import type { RedisRateLimiter } from "@bed-stack/be-core/rate-limiter";
import { Elysia, t } from "elysia";
import type Redis from "ioredis";
import type pg from "pg";
import type { Counter } from "prom-client";
import type { AuthServiceConfig } from "../config";
import { dummyHash, hashPassword, verifyPassword } from "../services/password";
import {
	issueNewRefreshToken,
	revokeAllRefreshTokensForUser,
	revokeTokenFamilyByRawToken,
	rotateRefreshToken,
} from "../services/token";

const logger = createLogger("auth-routes");

const REFRESH_COOKIE_NAME = "refresh_token";

// tokenVersion is published to Redis so sibling services (seat/payment) can
// reject access tokens revoked by logout-all. The TTL only needs to outlive
// the longest-lived access token; refresh re-publishes on every rotation.
const TOKEN_VERSION_TTL_SECONDS = 24 * 60 * 60;
const CSRF_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

type CookieJar = Record<
	string,
	{ value?: string; set: (opts: Record<string, unknown>) => void }
>;

/**
 * Rotate the CSRF nonce cookie and return the HMAC signature the client must
 * send back as the x-csrf-token header on mutating requests.
 */
async function issueCsrfSignature(
	cookie: CookieJar,
	isProduction: boolean,
	csrfProtection: ReturnType<typeof createCsrfProtection>,
): Promise<string> {
	const tokens = await csrfProtection.generateTokens();
	cookie[csrfProtection.getCookieName()]?.set({
		value: tokens.cookie,
		httpOnly: false,
		secure: isProduction,
		sameSite: "lax",
		path: "/",
		maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
	});
	return tokens.header;
}

/** Validate the x-csrf-token header against the csrf-token cookie nonce. */
async function isCsrfValid(
	headers: Record<string, unknown>,
	cookie: CookieJar,
	csrfProtection: ReturnType<typeof createCsrfProtection>,
): Promise<boolean> {
	const headerToken = headers[csrfProtection.getHeaderName()] as
		| string
		| undefined;
	const cookieNonce = cookie[csrfProtection.getCookieName()]?.value;
	return csrfProtection.validateToken(headerToken || "", cookieNonce || "");
}

/** Set refresh token as httpOnly cookie. */
function setRefreshCookie(
	cookie: Record<string, { set: (opts: Record<string, unknown>) => void }>,
	raw: string,
	maxAge: number,
	isProduction: boolean,
): void {
	cookie[REFRESH_COOKIE_NAME]?.set({
		value: raw,
		httpOnly: true,
		secure: isProduction,
		sameSite: "strict",
		path: "/api/auth",
		maxAge,
	});
}

/** Clear refresh token cookie. */
function clearRefreshCookie(
	cookie: Record<string, { set: (opts: Record<string, unknown>) => void }>,
): void {
	cookie[REFRESH_COOKIE_NAME]?.set({
		value: "",
		httpOnly: true,
		path: "/api/auth",
		maxAge: 0,
	});
}

/** Append an audit log entry. */
async function auditLog(
	pool: pg.Pool,
	userId: number | null,
	action: string,
	details: Record<string, unknown>,
	ipAddress: string,
): Promise<void> {
	try {
		await pool.query(
			`INSERT INTO audit_log (user_id, action, details, ip_address)
			 VALUES ($1, $2, $3, $4)`,
			[userId, action, JSON.stringify(details), ipAddress],
		);
	} catch (err) {
		logger.error("Failed to write audit log", { error: err as Error, action });
	}
}

/** Extract client IP from request headers. */
function getClientIP(request: Request, trustProxy: boolean): string {
	if (trustProxy) {
		const forwarded = request.headers.get("x-forwarded-for");
		if (forwarded) return forwarded.split(",")[0]?.trim() || "127.0.0.1";
		return request.headers.get("x-real-ip") || "127.0.0.1";
	}
	return "127.0.0.1";
}

/**
 * Create auth routes plugin.
 */
export function authRoutes(
	pool: pg.Pool,
	redis: Redis,
	config: AuthServiceConfig,
	loginLimiter: RedisRateLimiter,
	loginCounter: Counter,
	tokenRefreshCounter: Counter,
) {
	const isProduction = config.nodeEnv === "production";
	const csrfProtection = createCsrfProtection(config.jwtSecret);

	return (
		new Elysia({ prefix: "/auth" })
			// ─── Register (email/password) ────────────────────────────────────
			.post(
				"/register",
				async ({ body, set, jwt, cookie, request }) => {
					const clientIP = getClientIP(request, config.trustProxy);
					const rateCheck = await loginLimiter.check(clientIP);
					if (!rateCheck.allowed) {
						set.status = 429;
						set.headers["Retry-After"] = String(
							rateCheck.retryAfterSeconds || 60,
						);
						return ResponseBuilder.error(
							"Too many attempts",
							"RATE_LIMIT_EXCEEDED",
						);
					}

					const { email, password, name } = body;

					// Check if user exists
					const existing = await pool.query(
						"SELECT id FROM users WHERE email = $1",
						[email],
					);
					if (existing.rows.length > 0) {
						set.status = 409;
						return ResponseBuilder.error(
							"Email already registered",
							"EMAIL_EXISTS",
						);
					}

					// Hash password with argon2id
					const passwordHash = await hashPassword(password);

					// Create user
					const result = await pool.query<{ id: number; email: string }>(
						`INSERT INTO users (email, password_hash, name)
					 VALUES ($1, $2, $3) RETURNING id, email`,
						[email, passwordHash, name || null],
					);
					const user = result.rows[0]!;

					// Issue tokens
					const accessToken = await jwt.sign({
						userId: user.id,
						email: user.email,
						tokenVersion: 0,
						exp: Math.floor(Date.now() / 1000) + config.atTtlSeconds,
					});

					const refresh = await issueNewRefreshToken(pool, user.id);
					await publishTokenVersion(
						redis,
						user.id,
						0,
						TOKEN_VERSION_TTL_SECONDS,
					);

					// Set cookies
					cookie.token.set({
						value: accessToken,
						httpOnly: true,
						secure: isProduction,
						sameSite: "lax",
						path: "/",
						maxAge: config.atTtlSeconds,
					});
					setRefreshCookie(
						cookie as any,
						refresh.raw,
						refresh.maxAge,
						isProduction,
					);
					const csrfToken = await issueCsrfSignature(
						cookie as any,
						isProduction,
						csrfProtection,
					);

					loginCounter.inc({ method: "register", status: "success" });
					await auditLog(pool, user.id, "register", { email }, clientIP);

					logger.info("User registered", { userId: user.id, email });
					return ResponseBuilder.success({
						user: { id: user.id, email: user.email },
						csrfToken,
					});
				},
				{
					body: t.Object({
						email: t.String({ format: "email" }),
						password: t.String({ minLength: 8, maxLength: 128 }),
						name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
					}),
				},
			)

			// ─── Login (email/password) ───────────────────────────────────────
			.post(
				"/login",
				async ({ body, set, jwt, cookie, request }) => {
					const clientIP = getClientIP(request, config.trustProxy);
					const rateCheck = await loginLimiter.check(clientIP);
					if (!rateCheck.allowed) {
						set.status = 429;
						set.headers["Retry-After"] = String(
							rateCheck.retryAfterSeconds || 60,
						);
						set.headers["X-RateLimit-Limit"] = String(rateCheck.totalHits);
						set.headers["X-RateLimit-Remaining"] = "0";
						return ResponseBuilder.error(
							"Too many login attempts",
							"RATE_LIMIT_EXCEEDED",
						);
					}

					const { email, password } = body;

					// Look up user
					const result = await pool.query<{
						id: number;
						email: string;
						password_hash: string | null;
						name: string | null;
						token_version: number;
					}>(
						"SELECT id, email, password_hash, name, token_version FROM users WHERE email = $1",
						[email],
					);

					const user = result.rows[0];

					if (!user?.password_hash) {
						// Timing equalization: run argon2 even for non-existent users
						await dummyHash();
						loginCounter.inc({ method: "login", status: "failed" });
						set.status = 401;
						return ResponseBuilder.unauthorized("Invalid email or password");
					}

					const valid = await verifyPassword(user.password_hash, password);
					if (!valid) {
						loginCounter.inc({ method: "login", status: "failed" });
						await auditLog(pool, user.id, "login_failed", { email }, clientIP);
						set.status = 401;
						return ResponseBuilder.unauthorized("Invalid email or password");
					}

					// Issue tokens
					const accessToken = await jwt.sign({
						userId: user.id,
						email: user.email,
						tokenVersion: user.token_version,
						exp: Math.floor(Date.now() / 1000) + config.atTtlSeconds,
					});

					const refresh = await issueNewRefreshToken(pool, user.id);
					await publishTokenVersion(
						redis,
						user.id,
						user.token_version,
						TOKEN_VERSION_TTL_SECONDS,
					);

					cookie.token.set({
						value: accessToken,
						httpOnly: true,
						secure: isProduction,
						sameSite: "lax",
						path: "/",
						maxAge: config.atTtlSeconds,
					});
					setRefreshCookie(
						cookie as any,
						refresh.raw,
						refresh.maxAge,
						isProduction,
					);
					const csrfToken = await issueCsrfSignature(
						cookie as any,
						isProduction,
						csrfProtection,
					);

					loginCounter.inc({ method: "login", status: "success" });
					await auditLog(pool, user.id, "login", { email }, clientIP);

					logger.info("User logged in", { userId: user.id, email });
					return ResponseBuilder.success({
						user: { id: user.id, email: user.email, name: user.name },
						csrfToken,
					});
				},
				{
					body: t.Object({
						email: t.String({ format: "email" }),
						password: t.String({ minLength: 1 }),
					}),
				},
			)

			// ─── Mock Login (development only) ────────────────────────────────
			.post(
				"/mock-login",
				async ({ body, set, jwt, cookie, request }) => {
					if (isProduction) {
						set.status = 404;
						return ResponseBuilder.notFound();
					}

					const { email, name } = body;
					const clientIP = getClientIP(request, config.trustProxy);

					// Upsert user
					const result = await pool.query<{
						id: number;
						email: string;
						name: string | null;
						token_version: number;
					}>(
						`INSERT INTO users (email, name, google_id)
					 VALUES ($1, $2, $3)
					 ON CONFLICT (email) DO UPDATE SET name = COALESCE($2, users.name)
					 RETURNING id, email, name, token_version`,
						[email, name || null, `mock_${crypto.randomUUID()}`],
					);
					const user = result.rows[0]!;

					const accessToken = await jwt.sign({
						userId: user.id,
						email: user.email,
						tokenVersion: user.token_version,
						exp: Math.floor(Date.now() / 1000) + config.atTtlSeconds,
					});

					const refresh = await issueNewRefreshToken(pool, user.id);
					await publishTokenVersion(
						redis,
						user.id,
						user.token_version,
						TOKEN_VERSION_TTL_SECONDS,
					);

					cookie.token.set({
						value: accessToken,
						httpOnly: true,
						secure: false,
						sameSite: "lax",
						path: "/",
						maxAge: config.atTtlSeconds,
					});
					setRefreshCookie(cookie as any, refresh.raw, refresh.maxAge, false);
					const csrfToken = await issueCsrfSignature(
						cookie as any,
						false,
						csrfProtection,
					);

					loginCounter.inc({ method: "mock-login", status: "success" });
					await auditLog(pool, user.id, "mock_login", { email }, clientIP);

					return ResponseBuilder.success({ user, csrfToken });
				},
				{
					body: t.Object({
						email: t.String(),
						name: t.Optional(t.String()),
					}),
				},
			)

			// ─── Refresh Token ────────────────────────────────────────────────
			.post("/refresh", async ({ cookie, jwt, set, request, headers }) => {
				if (
					!(await isCsrfValid(
						headers as Record<string, unknown>,
						cookie as any,
						csrfProtection,
					))
				) {
					set.status = 403;
					return ResponseBuilder.forbidden("Invalid CSRF token");
				}

				const rawToken = cookie[REFRESH_COOKIE_NAME]?.value;
				if (!rawToken) {
					set.status = 401;
					return ResponseBuilder.unauthorized("No refresh token");
				}

				const result = await rotateRefreshToken(pool, rawToken);

				if (!result.success) {
					clearRefreshCookie(cookie as any);
					set.status = 401;
					tokenRefreshCounter.inc({ status: result.error });

					if (result.error === "REUSE_DETECTED") {
						const clientIP = getClientIP(request, config.trustProxy);
						logger.warn("Refresh token reuse detected — possible theft", {
							clientIP,
						});
						await auditLog(pool, null, "session_reuse_detected", {}, clientIP);
					}

					return ResponseBuilder.unauthorized("Token refresh failed");
				}

				// Look up user for new AT
				const userResult = await pool.query<{
					id: number;
					email: string;
					token_version: number;
				}>("SELECT id, email, token_version FROM users WHERE id = $1", [
					result.userId,
				]);
				const user = userResult.rows[0];

				if (!user) {
					set.status = 401;
					return ResponseBuilder.unauthorized("User not found");
				}

				const accessToken = await jwt.sign({
					userId: user.id,
					email: user.email,
					tokenVersion: user.token_version,
					exp: Math.floor(Date.now() / 1000) + config.atTtlSeconds,
				});

				cookie.token.set({
					value: accessToken,
					httpOnly: true,
					secure: isProduction,
					sameSite: "lax",
					path: "/",
					maxAge: config.atTtlSeconds,
				});
				setRefreshCookie(
					cookie as any,
					result.newToken.raw,
					result.newToken.maxAge,
					isProduction,
				);
				await publishTokenVersion(
					redis,
					user.id,
					user.token_version,
					TOKEN_VERSION_TTL_SECONDS,
				);
				const csrfToken = await issueCsrfSignature(
					cookie as any,
					isProduction,
					csrfProtection,
				);

				tokenRefreshCounter.inc({ status: "success" });
				logger.info("Token refreshed", { userId: user.id });
				return ResponseBuilder.success({ authenticated: true, csrfToken });
			})

			// ─── Logout (current session only) ────────────────────────────────
			.post("/logout", async ({ cookie, set, request, headers }) => {
				if (
					!(await isCsrfValid(
						headers as Record<string, unknown>,
						cookie as any,
						csrfProtection,
					))
				) {
					set.status = 403;
					return ResponseBuilder.forbidden("Invalid CSRF token");
				}

				const clientIP = getClientIP(request, config.trustProxy);
				const refreshRaw = cookie[REFRESH_COOKIE_NAME]?.value;

				// Revoke only the family of the presented refresh token.
				// Each login starts a new family, so this ends just this session.
				// The short-lived access token expires on its own (AT TTL ~15min).
				if (refreshRaw) {
					try {
						const revoked = await revokeTokenFamilyByRawToken(pool, refreshRaw);
						if (revoked) {
							await auditLog(pool, null, "logout", {}, clientIP);
							logger.info("User logged out (session revoked)");
						}
					} catch (err) {
						logger.error("Failed to revoke refresh token family", {
							error: err as Error,
						});
					}
				}

				cookie.token.set({ value: "", httpOnly: true, path: "/", maxAge: 0 });
				clearRefreshCookie(cookie as any);

				return ResponseBuilder.success({ success: true });
			})

			// ─── Logout All Devices ───────────────────────────────────────────
			.post("/logout-all", async ({ cookie, jwt, set, request, headers }) => {
				if (
					!(await isCsrfValid(
						headers as Record<string, unknown>,
						cookie as any,
						csrfProtection,
					))
				) {
					set.status = 403;
					return ResponseBuilder.forbidden("Invalid CSRF token");
				}

				const clientIP = getClientIP(request, config.trustProxy);
				const token = cookie.token?.value;

				if (!token) {
					set.status = 401;
					return ResponseBuilder.unauthorized("Authentication required");
				}

				try {
					const payload = await jwt.verify(token);
					if (!payload || typeof payload === "boolean") {
						set.status = 401;
						return ResponseBuilder.unauthorized("Invalid token");
					}

					const userId = payload.userId as number;

					// Bump tokenVersion (invalidates ALL access tokens) and publish
					// the new version so sibling services reject stale tokens too.
					const bumped = await pool.query<{ token_version: number }>(
						`UPDATE users SET token_version = token_version + 1
						 WHERE id = $1 RETURNING token_version`,
						[userId],
					);
					const newVersion = bumped.rows[0]?.token_version;
					if (newVersion !== undefined) {
						await publishTokenVersion(
							redis,
							userId,
							newVersion,
							TOKEN_VERSION_TTL_SECONDS,
						);
					}

					// Revoke ALL refresh tokens for this user
					await revokeAllRefreshTokensForUser(pool, userId);

					await auditLog(pool, userId, "logout_all", {}, clientIP);
					logger.info("User logged out of all devices", { userId });

					cookie.token.set({ value: "", httpOnly: true, path: "/", maxAge: 0 });
					clearRefreshCookie(cookie as any);

					return ResponseBuilder.success({ success: true });
				} catch {
					set.status = 401;
					return ResponseBuilder.unauthorized("Invalid token");
				}
			})

			// ─── Get Current User (from JWT) ──────────────────────────────────
			.get("/me", async ({ jwt, cookie, set }) => {
				const token = cookie.token?.value;
				if (!token) {
					return ResponseBuilder.success({ authenticated: false });
				}

				try {
					const payload = await jwt.verify(token);
					if (!payload || typeof payload === "boolean") {
						return ResponseBuilder.success({ authenticated: false });
					}

					const userId = payload.userId as number;
					const tokenVersion = payload.tokenVersion as number | undefined;
					const result = await pool.query<{
						id: number;
						email: string;
						name: string | null;
						picture: string | null;
						token_version: number;
					}>(
						"SELECT id, email, name, picture, token_version FROM users WHERE id = $1",
						[userId],
					);

					const user = result.rows[0];
					if (!user) {
						return ResponseBuilder.success({ authenticated: false });
					}

					// Reject tokens revoked by logout-all (tokenVersion bump)
					if (
						tokenVersion !== undefined &&
						user.token_version !== tokenVersion
					) {
						return ResponseBuilder.success({ authenticated: false });
					}

					const csrfToken = await issueCsrfSignature(
						cookie as any,
						isProduction,
						csrfProtection,
					);
					return ResponseBuilder.success({
						authenticated: true,
						user: {
							id: user.id,
							email: user.email,
							name: user.name,
							picture: user.picture,
						},
						csrfToken,
					});
				} catch {
					return ResponseBuilder.success({ authenticated: false });
				}
			})
	);
}
