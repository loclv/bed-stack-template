/**
 * Argon2id password hashing with timing equalization.
 *
 * Uses argon2id (memory-hard, resistant to GPU attacks) for password hashing.
 * Includes timing equalization to prevent user enumeration via login timing.
 */

import { createLogger } from "@bed-stack/be-core/logger";
import argon2 from "argon2";

const logger = createLogger("password");

/** Argon2id configuration. */
const ARGON2_OPTIONS: argon2.Options = {
	type: argon2.argon2id,
	memoryCost: 65536, // 64 MB
	timeCost: 3, // 3 iterations
	parallelism: 4, // 4 threads
};

/**
 * Hash a password using argon2id.
 * @param password - Plain text password to hash
 * @returns Encoded argon2id hash string
 */
export async function hashPassword(password: string): Promise<string> {
	const hash = await argon2.hash(password, ARGON2_OPTIONS);
	logger.debug("Password hashed successfully");
	return hash;
}

/**
 * Verify a password against an argon2id hash.
 * @returns true if password matches the hash
 */
export async function verifyPassword(
	hash: string,
	password: string,
): Promise<boolean> {
	try {
		return await argon2.verify(hash, password);
	} catch (err) {
		logger.error("Password verification error", { error: err as Error });
		return false;
	}
}

/**
 * Perform a dummy hash operation to equalize timing for non-existent users.
 * This prevents user enumeration via login response time differences.
 *
 * When a login attempt targets a non-existent email, we still run argon2
 * so the response time is indistinguishable from a real user with wrong password.
 */
export async function dummyHash(): Promise<void> {
	await argon2.hash("dummy-password-for-timing-equalization", ARGON2_OPTIONS);
}
