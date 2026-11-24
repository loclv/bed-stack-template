import { eq } from "drizzle-orm";
import { type Elysia, redirect, t } from "elysia";
import { findOrCreateUser, generateAuthUrl, verifyGoogleToken } from "../auth";
import { db } from "../db";
import { refreshTokens, type User, users } from "../db/schema";
import { config } from "../utils/const";
import { csrfProtection } from "../utils/csrf";
import { DatabaseWrapper } from "../utils/database";
import { logger } from "../utils/logger";
import { authRateLimitOptions, rateLimiter } from "../utils/rate-limiter";
import { ResponseBuilder } from "../utils/response";
import {
	type GoogleAuthQuery,
	GoogleAuthQuerySchema,
	type JwtPayload,
	JwtPayloadSchema,
	validateSchemaWithError,
} from "../utils/validation";

const JWT_EXPIRATION = 3_600; // 1 hour
const REFRESH_TOKEN_EXPIRATION = 7_776_000; // 90 days
const ONE_DAY = 86_400;
const REFRESH_COOKIE_NAME = "refresh_token";

const encoder = new TextEncoder();

function extractToken(authHeader: string | undefined): string | undefined {
	if (authHeader?.startsWith("Bearer ")) {
		return authHeader.slice(7);
	}
	return undefined;
}

async function hashToken(token: string): Promise<string> {
	const hash = await crypto.subtle.digest("SHA-256", encoder.encode(token));
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

async function issueRefreshToken(
	userId: number,
): Promise<{ raw: string; maxAge: number }> {
	const raw = crypto.randomUUID();
	const tokenHash = await hashToken(raw);
	const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRATION * 1000);
	await dbWrapper.insert(
		db.insert(refreshTokens).values({ userId, tokenHash, expiresAt }),
	);
	return { raw, maxAge: REFRESH_TOKEN_EXPIRATION };
}

interface CookieSetter {
	set: (opts: Record<string, unknown>) => void;
}

type CookieJar = Record<string, CookieSetter | undefined>;

function setRefreshCookie(cookie: CookieJar, raw: string, maxAge: number) {
	cookie[REFRESH_COOKIE_NAME]?.set({
		value: raw,
		httpOnly: true,
		secure: config.nodeEnv === "production",
		sameSite: "lax",
		path: "/",
		maxAge,
	});
}

function clearRefreshCookie(cookie: CookieJar) {
	cookie[REFRESH_COOKIE_NAME]?.set({
		value: "",
		httpOnly: true,
		path: "/",
		maxAge: 0,
	});
}

const dbWrapper = new DatabaseWrapper(db);
const authLimiter = rateLimiter.createLimiter("auth", authRateLimitOptions);

export const authPlugin = (app: Elysia) =>
	app
		.get("/auth/google", async () => {
			try {
				const authUrl = generateAuthUrl();
				logger.info("Google OAuth URL generated", { authUrl });
				return redirect(authUrl);
			} catch (error) {
				logger.error("Failed to generate auth URL", { error: error as Error });
				return ResponseBuilder.internal(
					"Failed to generate authentication URL",
				);
			}
		})
		.get(
			"/auth/callback",
			async ({ query, set, cookie, jwt, redirect, request }) => {
				let clientIP = "127.0.0.1";
				if (config.trustProxy) {
					const forwarded = request.headers.get("x-forwarded-for");
					if (forwarded) {
						clientIP = forwarded.split(",")[0]?.trim() || clientIP;
					} else {
						clientIP = request.headers.get("x-real-ip") || clientIP;
					}
				}

				// Rate limiting check
				const rateLimitResult = authLimiter.check(clientIP);
				if (!rateLimitResult.allowed) {
					logger.warn("Rate limit exceeded for auth callback", {
						clientIP,
						totalHits: rateLimitResult.totalHits,
						resetTime: rateLimitResult.resetTime,
					});
					set.status = 429;
					return ResponseBuilder.error(
						"Too many authentication attempts",
						"RATE_LIMIT_EXCEEDED",
						{
							retryAfter: Math.ceil(
								(rateLimitResult.resetTime.getTime() - Date.now()) / 1000,
							),
						},
					);
				}

				// Validate query parameters with Elysia TypeBox
				const queryValidation = validateSchemaWithError<GoogleAuthQuery>(
					// biome-ignore lint/suspicious/noExplicitAny: Required for TypeBox schema compatibility
					GoogleAuthQuerySchema as any,
					query,
				);
				if (!queryValidation.success || !queryValidation.data) {
					logger.warn("Invalid query parameters in /auth/google", {
						error: queryValidation.error,
					});
					return ResponseBuilder.validation("Invalid query parameters", [
						{
							message: queryValidation.error || "Invalid query parameters",
							path: "query",
						},
					]);
				}

				const { code } = queryValidation.data;

				try {
					const googleUser = await verifyGoogleToken(code);
					if (!googleUser) {
						logger.warn("Google token verification returned null", {
							codeLength: code.length,
							clientIP,
						});
						set.status = 401;
						return ResponseBuilder.unauthorized(
							"Invalid Google authentication",
						);
					}

					logger.info("Google user verified successfully", {
						email: googleUser.email,
						sub: googleUser.sub,
					});

					const user = (await findOrCreateUser({
						sub: googleUser.sub,
						email: googleUser.email,
						name: googleUser.name,
						picture: googleUser.picture,
					})) as User;

					const token = await jwt.sign({
						id: user.id,
						email: user.email,
						exp: Math.floor(Date.now() / 1000) + JWT_EXPIRATION,
					});

					const refresh = await issueRefreshToken(user.id);

					// Generate CSRF tokens (async HMAC signing)
					const csrfTokens = await csrfProtection.generateTokens();

					// Set JWT token cookie (short-lived)
					cookie.token.set({
						value: token,
						httpOnly: true,
						secure: config.nodeEnv === "production",
						sameSite: "lax",
						path: "/",
						maxAge: JWT_EXPIRATION,
					});

					// Set refresh token cookie (long-lived, rotated on use)
					setRefreshCookie(cookie, refresh.raw, refresh.maxAge);

					// Set CSRF nonce cookie (JS-readable for double-submit)
					cookie[csrfProtection.getCookieName()].set({
						value: csrfTokens.cookie,
						httpOnly: false,
						secure: config.nodeEnv === "production",
						sameSite: "lax",
						path: "/",
						maxAge: ONE_DAY,
					});

					logger.info("User authenticated successfully", {
						userId: user.id,
						email: user.email,
						clientIP,
					});

					return redirect(config.webUrl);
				} catch (error) {
					logger.error("Authentication failed", {
						error: error as Error,
						codeLength: code.length,
						clientIP,
					});
					set.status = 500;
					return ResponseBuilder.internal("Authentication failed");
				}
			},
		)
		.get("/auth/me", async ({ jwt, headers, cookie }) => {
			const token =
				extractToken(headers.authorization as string | undefined) ||
				cookie.token?.value;
			if (!token || typeof token !== "string") {
				return ResponseBuilder.success({ authenticated: false });
			}

			try {
				const payload = await jwt.verify(token);
				const payloadValidation = validateSchemaWithError<JwtPayload>(
					// biome-ignore lint/suspicious/noExplicitAny: Required for TypeBox schema compatibility
					JwtPayloadSchema as any,
					payload as Record<string, unknown>,
				);
				if (!payloadValidation.success || !payloadValidation.data) {
					logger.warn("Invalid JWT payload in /auth/me", {
						error: payloadValidation.error,
					});
					return ResponseBuilder.unauthorized("Invalid authentication token");
				}

				const user = await dbWrapper.selectOne<{
					id: number;
					email: string;
					name: string | null;
					picture: string | null;
				}>(
					db
						.select({
							id: users.id,
							email: users.email,
							name: users.name,
							picture: users.picture,
						})
						.from(users)
						.where(eq(users.id, payloadValidation.data.id)),
				);

				if (!user) {
					logger.warn("User not found for JWT payload", {
						userId: payloadValidation.data?.id,
					});
					return ResponseBuilder.success({ authenticated: false });
				}

				// Return HMAC signature so frontend can send it as x-csrf-token header
				const csrfCookie = cookie[csrfProtection.getCookieName()]?.value;
				let csrfSignature: string | null = null;
				if (csrfCookie) {
					const tokens = await csrfProtection.generateTokens();
					// Regenerate: set new nonce in cookie, return new signature
					cookie[csrfProtection.getCookieName()].set({
						value: tokens.cookie,
						httpOnly: false,
						secure: config.nodeEnv === "production",
						sameSite: "lax",
						path: "/",
						maxAge: ONE_DAY,
					});
					csrfSignature = tokens.header;
				}

				return ResponseBuilder.success({
					authenticated: true,
					user,
					csrfToken: csrfSignature,
				});
			} catch (error) {
				logger.error("Failed to verify JWT token", { error: error as Error });
				return ResponseBuilder.success({ authenticated: false });
			}
		})
		.post(
			"/auth/logout",
			async ({ headers, cookie, jwt }) => {
				const csrfHeader = headers[csrfProtection.getHeaderName()] as
					| string
					| undefined;
				const csrfCookie = cookie[csrfProtection.getCookieName()]?.value;
				if (
					!(await csrfProtection.validateToken(
						csrfHeader || "",
						csrfCookie || "",
					))
				) {
					return ResponseBuilder.forbidden("CSRF validation failed");
				}

				try {
					// Invalidate all refresh tokens for the authenticated user
					const token = cookie.token?.value;
					if (token) {
						const payload = await jwt.verify(token);
						if (payload && typeof payload !== "boolean") {
							await dbWrapper.delete(
								db
									.delete(refreshTokens)
									.where(eq(refreshTokens.userId, payload.id as number)),
							);
						}
					}

					cookie.token.set({
						value: "",
						httpOnly: true,
						path: "/",
						maxAge: 0,
					});
					clearRefreshCookie(cookie);
					logger.info("User logged out successfully");
					return ResponseBuilder.success({ success: true });
				} catch (error) {
					logger.error("Failed to logout", { error: error as Error });
					return ResponseBuilder.internal("Failed to logout");
				}
			},
			{
				headers: t.Object({
					[csrfProtection.getHeaderName()]: t.Optional(t.String()),
				}),
			},
		)
		.post("/auth/refresh", async ({ cookie, jwt, set, headers }) => {
			// CSRF validation for refresh endpoint
			const csrfHeader = headers[csrfProtection.getHeaderName()] as
				| string
				| undefined;
			const csrfCookie = cookie[csrfProtection.getCookieName()]?.value;
			if (
				!(await csrfProtection.validateToken(
					csrfHeader || "",
					csrfCookie || "",
				))
			) {
				return ResponseBuilder.forbidden("CSRF validation failed");
			}

			const rawToken = cookie[REFRESH_COOKIE_NAME]?.value;
			if (!rawToken) {
				set.status = 401;
				return ResponseBuilder.unauthorized("No refresh token");
			}

			try {
				const tokenHash = await hashToken(rawToken);
				const stored = await dbWrapper.selectOne<{
					id: number;
					userId: number;
					expiresAt: Date;
				}>(
					db
						.select({
							id: refreshTokens.id,
							userId: refreshTokens.userId,
							expiresAt: refreshTokens.expiresAt,
						})
						.from(refreshTokens)
						.where(eq(refreshTokens.tokenHash, tokenHash)),
				);

				if (!stored || stored.expiresAt < new Date()) {
					set.status = 401;
					clearRefreshCookie(cookie);
					return ResponseBuilder.unauthorized(
						"Refresh token expired or invalid",
					);
				}

				const refreshUser = await dbWrapper.selectOne<{
					id: number;
					email: string;
				}>(
					db
						.select({ id: users.id, email: users.email })
						.from(users)
						.where(eq(users.id, stored.userId)),
				);

				if (!refreshUser) {
					set.status = 401;
					clearRefreshCookie(cookie);
					return ResponseBuilder.unauthorized("User not found");
				}

				// Rotate atomically: delete old token and insert the new one in a
				// single transaction so a failure can't strand the user logged out.
				const refresh = await dbWrapper.transaction(async (tx) => {
					const txWrapper = new DatabaseWrapper(tx);
					// biome-ignore lint/suspicious/noExplicitAny: drizzle transaction handle
					const txDb = tx as any;
					await txWrapper.delete(
						txDb.delete(refreshTokens).where(eq(refreshTokens.id, stored.id)),
					);

					const raw = crypto.randomUUID();
					const tokenHash = await hashToken(raw);
					const expiresAt = new Date(
						Date.now() + REFRESH_TOKEN_EXPIRATION * 1000,
					);
					await txWrapper.insert(
						txDb.insert(refreshTokens).values({
							userId: refreshUser.id,
							tokenHash,
							expiresAt,
						}),
					);
					return { raw, maxAge: REFRESH_TOKEN_EXPIRATION };
				});

				const newToken = await jwt.sign({
					id: refreshUser.id,
					email: refreshUser.email,
					exp: Math.floor(Date.now() / 1000) + JWT_EXPIRATION,
				});

				cookie.token.set({
					value: newToken,
					httpOnly: true,
					secure: config.nodeEnv === "production",
					sameSite: "lax",
					path: "/",
					maxAge: JWT_EXPIRATION,
				});
				setRefreshCookie(cookie, refresh.raw, refresh.maxAge);

				// Issue new CSRF tokens on refresh
				const csrfTokens = await csrfProtection.generateTokens();
				cookie[csrfProtection.getCookieName()].set({
					value: csrfTokens.cookie,
					httpOnly: false,
					secure: config.nodeEnv === "production",
					sameSite: "lax",
					path: "/",
					maxAge: ONE_DAY,
				});

				logger.info("Token refreshed successfully", { userId: refreshUser.id });
				return ResponseBuilder.success({
					authenticated: true,
					csrfToken: csrfTokens.header,
				});
			} catch (error) {
				logger.error("Failed to refresh token", { error: error as Error });
				set.status = 401;
				return ResponseBuilder.unauthorized("Token refresh failed");
			}
		})
		.post(
			"/auth/mock-login",
			async ({ body, jwt, cookie, set, request }) => {
				if (config.nodeEnv === "production") {
					logger.warn("Mock login attempted in production");
					set.status = 404;
					return ResponseBuilder.notFound();
				}

				let clientIP = "127.0.0.1";
				if (config.trustProxy) {
					const forwarded = request.headers.get("x-forwarded-for");
					if (forwarded) {
						clientIP = forwarded.split(",")[0]?.trim() || clientIP;
					} else {
						clientIP = request.headers.get("x-real-ip") || clientIP;
					}
				}

				const rateLimitResult = authLimiter.check(clientIP);
				if (!rateLimitResult.allowed) {
					logger.warn("Rate limit exceeded for mock login", {
						clientIP,
						totalHits: rateLimitResult.totalHits,
						resetTime: rateLimitResult.resetTime,
					});
					set.status = 429;
					return ResponseBuilder.error(
						"Too many authentication attempts",
						"RATE_LIMIT_EXCEEDED",
						{
							retryAfter: Math.ceil(
								(rateLimitResult.resetTime.getTime() - Date.now()) / 1000,
							),
						},
					);
				}

				const { email, name } = body;
				try {
					const existingUser = await dbWrapper.selectOne<{
						id: number;
						email: string;
						name: string | null;
						picture: string | null;
						googleId: string | null;
					}>(db.select().from(users).where(eq(users.email, email)));

					if (
						existingUser?.googleId &&
						!existingUser.googleId.startsWith("mock_")
					) {
						logger.warn(
							"Mock login blocked - email belongs to a real Google user",
							{ email },
						);
						return ResponseBuilder.forbidden(
							"This email is registered with Google OAuth; use Google login",
						);
					}

					const user =
						existingUser ||
						(await dbWrapper.insertAndReturn<{
							id: number;
							email: string;
							name: string | null;
							picture?: string | null;
						}>(
							db.insert(users).values({
								email,
								name: name || null,
								googleId: `mock_${crypto.randomUUID()}`,
							}),
						));

					const token = await jwt.sign({
						id: user.id,
						email: user.email,
						exp: Math.floor(Date.now() / 1000) + JWT_EXPIRATION,
					});

					const refresh = await issueRefreshToken(user.id);

					const csrfTokens = await csrfProtection.generateTokens();

					// Set JWT token cookie (short-lived)
					cookie.token.set({
						value: token,
						httpOnly: true,
						secure: config.nodeEnv === "production",
						sameSite: "lax",
						path: "/",
						maxAge: JWT_EXPIRATION,
					});

					// Set refresh token cookie (long-lived, rotated on use)
					setRefreshCookie(cookie, refresh.raw, refresh.maxAge);

					// Set CSRF nonce cookie (JS-readable)
					cookie[csrfProtection.getCookieName()].set({
						value: csrfTokens.cookie,
						httpOnly: false,
						secure: config.nodeEnv === "production",
						sameSite: "lax",
						path: "/",
						maxAge: ONE_DAY,
					});

					logger.info("Mock user authenticated successfully", {
						userId: user.id,
						email: user.email,
					});

					// Return HMAC signature (not the JWT!) so frontend can set it as header
					return ResponseBuilder.success({
						user,
						csrfToken: csrfTokens.header,
					});
				} catch (error) {
					logger.error("Mock login failed", { error: error as Error });
					return ResponseBuilder.internal("Mock login failed");
				}
			},
			{
				body: t.Object({
					email: t.String(),
					name: t.Optional(t.String()),
				}),
			},
		);
