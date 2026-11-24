/**
 * Refresh token service with family tracking and reuse detection.
 *
 * Security model:
 * - Tokens are opaque (48 random bytes, base64url encoded)
 * - Only SHA-256 hash is stored in DB (raw token lives only in httpOnly cookie)
 * - Each token belongs to a "family" (UUID) — a chain of rotations
 * - If a revoked token is reused, the entire family is revoked (theft detection)
 * - Grace window allows old token during network retries
 */

import { getEnvNumber } from "@bed-stack/be-core/config";
import { createLogger } from "@bed-stack/be-core/logger";
import type pg from "pg";

const logger = createLogger("token-service");

const RT_TTL_SECONDS = getEnvNumber("RT_TTL_SECONDS", 7_776_000); // 90 days
const RT_GRACE_WINDOW_SECONDS = getEnvNumber("RT_GRACE_WINDOW_SECONDS", 10);

const encoder = new TextEncoder();

/** SHA-256 hash of a token string, returned as hex. */
async function hashToken(token: string): Promise<string> {
	const hash = await crypto.subtle.digest("SHA-256", encoder.encode(token));
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Generate a cryptographically secure opaque token (48 bytes, base64url). */
function generateOpaqueToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(48));
	// Convert to base64url
	const base64 = btoa(String.fromCharCode(...bytes));
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export interface RefreshTokenRow {
	id: number;
	user_id: number;
	token_hash: string;
	family_id: string;
	rotated_to: number | null;
	is_revoked: boolean;
	expires_at: Date;
	created_at: Date;
	/** created_at of the successor token — i.e. when this token was rotated/revoked. */
	revoked_at?: Date | null;
}

export interface IssuedToken {
	raw: string;
	maxAge: number;
}

/**
 * Issue a new refresh token for a user, starting a new family.
 */
export async function issueNewRefreshToken(
	pool: pg.Pool,
	userId: number,
): Promise<IssuedToken> {
	const raw = generateOpaqueToken();
	const tokenHash = await hashToken(raw);
	const familyId = crypto.randomUUID();
	const expiresAt = new Date(Date.now() + RT_TTL_SECONDS * 1000);

	await pool.query(
		`INSERT INTO refresh_tokens (user_id, token_hash, family_id, is_revoked, expires_at)
		 VALUES ($1, $2, $3, false, $4)`,
		[userId, tokenHash, familyId, expiresAt],
	);

	logger.info("New refresh token family created", { userId, familyId });
	return { raw, maxAge: RT_TTL_SECONDS };
}

export interface RotationResult {
	success: true;
	userId: number;
	newToken: IssuedToken;
}

export interface RotationError {
	success: false;
	error: "INVALID" | "EXPIRED" | "REUSE_DETECTED";
}

/**
 * Rotate a refresh token: revoke old, issue new in the same family.
 * Detects token reuse (stolen token) and revokes the entire family.
 *
 * Grace window: if the old token was revoked within RT_GRACE_WINDOW_SECONDS,
 * treat it as a network retry and return the successor token info.
 */
export async function rotateRefreshToken(
	pool: pg.Pool,
	rawToken: string,
): Promise<RotationResult | RotationError> {
	const tokenHash = await hashToken(rawToken);

	const result = await pool.query<RefreshTokenRow>(
		`SELECT rt.id, rt.user_id, rt.family_id, rt.is_revoked, rt.expires_at,
		        rt.rotated_to, rt.created_at, succ.created_at AS revoked_at
		 FROM refresh_tokens rt
		 LEFT JOIN refresh_tokens succ ON succ.id = rt.rotated_to
		 WHERE rt.token_hash = $1`,
		[tokenHash],
	);

	const stored = result.rows[0];

	if (!stored) {
		return { success: false, error: "INVALID" };
	}

	// Check if token was revoked (potential reuse attack)
	if (stored.is_revoked) {
		// Grace window check: if revoked recently, it might be a network retry.
		// revoked_at is the successor token's created_at (when rotation happened);
		// fall back to created_at for legacy rows without a successor.
		const revokedAt = stored.revoked_at ?? stored.created_at;
		const revokedAgo = Date.now() - new Date(revokedAt).getTime();
		const gracePeriodMs = RT_GRACE_WINDOW_SECONDS * 1000;

		if (stored.rotated_to && revokedAgo < gracePeriodMs) {
			logger.info("Refresh token reuse within grace window", {
				userId: stored.user_id,
				familyId: stored.family_id,
			});
			// Within grace window — this is likely a retry, not theft.
			// The token has already been rotated; client should use the new cookie.
			// Return success with a fresh token (re-rotate is safe).
			return await issueRotatedToken(pool, stored);
		}

		// REUSE DETECTED — revoke entire family
		logger.warn("REFRESH TOKEN REUSE DETECTED — revoking entire family", {
			userId: stored.user_id,
			familyId: stored.family_id,
			tokenId: stored.id,
		});

		await pool.query(
			`UPDATE refresh_tokens SET is_revoked = true
			 WHERE family_id = $1 AND is_revoked = false`,
			[stored.family_id],
		);

		return { success: false, error: "REUSE_DETECTED" };
	}

	// Check expiry
	if (new Date(stored.expires_at) < new Date()) {
		return { success: false, error: "EXPIRED" };
	}

	// Normal rotation: revoke old, issue new
	return await issueRotatedToken(pool, stored);
}

/**
 * Issue a rotated token in the same family, revoking the old one.
 */
async function issueRotatedToken(
	pool: pg.Pool,
	oldToken: RefreshTokenRow,
): Promise<RotationResult> {
	const raw = generateOpaqueToken();
	const tokenHash = await hashToken(raw);
	const expiresAt = new Date(Date.now() + RT_TTL_SECONDS * 1000);

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		// Insert new token
		const newResult = await client.query<{ id: number }>(
			`INSERT INTO refresh_tokens (user_id, token_hash, family_id, is_revoked, expires_at)
			 VALUES ($1, $2, $3, false, $4) RETURNING id`,
			[oldToken.user_id, tokenHash, oldToken.family_id, expiresAt],
		);

		const newTokenId = newResult.rows[0]?.id;

		// Revoke old token and link to successor
		await client.query(
			`UPDATE refresh_tokens SET is_revoked = true, rotated_to = $1
			 WHERE id = $2`,
			[newTokenId, oldToken.id],
		);

		await client.query("COMMIT");

		logger.info("Refresh token rotated", {
			userId: oldToken.user_id,
			familyId: oldToken.family_id,
			oldTokenId: oldToken.id,
			newTokenId,
		});

		return {
			success: true,
			userId: oldToken.user_id,
			newToken: { raw, maxAge: RT_TTL_SECONDS },
		};
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}
}

/**
 * Revoke all refresh tokens for a user (logout-all / account compromise).
 */
export async function revokeAllRefreshTokensForUser(
	pool: pg.Pool,
	userId: number,
): Promise<void> {
	await pool.query(
		`UPDATE refresh_tokens SET is_revoked = true
		 WHERE user_id = $1 AND is_revoked = false`,
		[userId],
	);
	logger.info("All refresh tokens revoked for user", { userId });
}

/**
 * Revoke the token family containing the given raw refresh token.
 * Used for single-session logout: each login starts a new family, so
 * revoking the family ends only that session's refresh-token chain.
 * Returns false if the token is unknown.
 */
export async function revokeTokenFamilyByRawToken(
	pool: pg.Pool,
	rawToken: string,
): Promise<boolean> {
	const tokenHash = await hashToken(rawToken);
	const result = await pool.query<{ family_id: string }>(
		`SELECT family_id FROM refresh_tokens WHERE token_hash = $1`,
		[tokenHash],
	);
	const familyId = result.rows[0]?.family_id;
	if (!familyId) return false;
	await revokeTokenFamily(pool, familyId);
	return true;
}

/**
 * Revoke all tokens in a specific family.
 */
export async function revokeTokenFamily(
	pool: pg.Pool,
	familyId: string,
): Promise<void> {
	await pool.query(
		`UPDATE refresh_tokens SET is_revoked = true
		 WHERE family_id = $1 AND is_revoked = false`,
		[familyId],
	);
	logger.info("Token family revoked", { familyId });
}
