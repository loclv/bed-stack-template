/**
 * JWT authentication middleware for Elysia.
 * Verifies access tokens and checks tokenVersion for instant invalidation.
 */

import { jwt } from "@elysiajs/jwt";
import { Elysia } from "elysia";
import type Redis from "ioredis";
import { createLogger } from "./logger";

const _logger = createLogger("auth-middleware");

/** JWT payload structure for access tokens. */
export interface JwtPayload {
	userId: number;
	email: string;
	tokenVersion: number;
	iat?: number;
	exp?: number;
}

export interface AuthMiddlewareConfig {
	jwtSecret: string;
	redis: Redis;
	/** TTL for tokenVersion cache in seconds. Default: 60 */
	tokenVersionCacheTtlSeconds?: number;
	/**
	 * Optional lookup that returns the user's current tokenVersion (e.g. from DB).
	 * When provided, tokens whose tokenVersion claim doesn't match are rejected,
	 * enabling instant revocation on logout-all / password change.
	 */
	tokenVersionLookup?: (userId: number) => Promise<number>;
}

const TOKEN_VERSION_CACHE_PREFIX = "tv:";
const DEFAULT_CACHE_TTL = 60; // seconds

/**
 * Extract bearer token from Authorization header or cookie.
 */
export function extractToken(
	authHeader: string | undefined,
	cookieToken?: string,
): string | undefined {
	if (authHeader?.startsWith("Bearer ")) {
		return authHeader.slice(7);
	}
	return cookieToken;
}

/**
 * Get tokenVersion from Redis cache, falling back to a DB lookup function.
 * TODO(prod): This caches tokenVersion in Redis to avoid DB query per request.
 * Cache invalidation happens on logout (bump version + delete cache key).
 */
export async function getTokenVersion(
	redis: Redis,
	userId: number,
	dbLookup: (userId: number) => Promise<number>,
	cacheTtl: number = DEFAULT_CACHE_TTL,
): Promise<number> {
	const key = `${TOKEN_VERSION_CACHE_PREFIX}${userId}`;
	const cached = await redis.get(key);
	if (cached !== null) {
		return Number.parseInt(cached, 10);
	}

	const version = await dbLookup(userId);
	await redis.setex(key, cacheTtl, version);
	return version;
}

/**
 * Invalidate the tokenVersion cache for a user (call on logout/logout-all).
 */
export async function invalidateTokenVersionCache(
	redis: Redis,
	userId: number,
): Promise<void> {
	const key = `${TOKEN_VERSION_CACHE_PREFIX}${userId}`;
	await redis.del(key);
}

/**
 * Read the published tokenVersion for a user from Redis.
 * Returns null when no version has been published (unknown — callers
 * should decide whether to allow or deny).
 */
export async function getCachedTokenVersion(
	redis: Redis,
	userId: number,
): Promise<number | null> {
	const cached = await redis.get(`${TOKEN_VERSION_CACHE_PREFIX}${userId}`);
	if (cached === null) return null;
	const version = Number.parseInt(cached, 10);
	return Number.isNaN(version) ? null : version;
}

/**
 * Publish the user's current tokenVersion to Redis so sibling services
 * (which cannot reach the auth database) can reject stale access tokens.
 * Called by the auth service on every token issuance and on logout-all.
 */
export async function publishTokenVersion(
	redis: Redis,
	userId: number,
	version: number,
	ttlSeconds: number,
): Promise<void> {
	await redis.setex(
		`${TOKEN_VERSION_CACHE_PREFIX}${userId}`,
		ttlSeconds,
		String(version),
	);
}

/**
 * Create an Elysia plugin that adds JWT verification with tokenVersion checking.
 */
export function authMiddleware(config: AuthMiddlewareConfig) {
	return new Elysia({ name: "auth-middleware" })
		.use(
			jwt({
				name: "jwt",
				secret: config.jwtSecret,
				alg: "HS256",
			}),
		)
		.derive(async ({ jwt: jwtPlugin, headers, cookie, set }) => {
			const token = extractToken(
				headers.authorization as string | undefined,
				cookie?.token?.value as string | undefined,
			);

			if (!token) {
				return { auth: null as JwtPayload | null };
			}

			try {
				const payload = await jwtPlugin.verify(token);
				if (!payload || typeof payload === "boolean") {
					return { auth: null as JwtPayload | null };
				}

				const auth: JwtPayload = {
					userId: payload.userId as number,
					email: payload.email as string,
					tokenVersion: payload.tokenVersion as number,
				};

				// If a tokenVersion lookup is configured, reject stale tokens
				// (e.g. after logout-all bumped the user's token_version).
				if (config.tokenVersionLookup) {
					const currentVersion = await getTokenVersion(
						config.redis,
						auth.userId,
						config.tokenVersionLookup,
						config.tokenVersionCacheTtlSeconds,
					);
					if (auth.tokenVersion !== currentVersion) {
						return { auth: null as JwtPayload | null };
					}
				}

				return { auth };
			} catch {
				return { auth: null as JwtPayload | null };
			}
		});
}
