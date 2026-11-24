import { eq } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { db } from "./db";
import { users } from "./db/schema";
import { config } from "./utils/const";
import { DatabaseError, DatabaseWrapper } from "./utils/database";
import { logger } from "./utils/logger";
import {
	type GoogleUserInfo,
	GoogleUserInfoSchema,
	validateSchema,
} from "./utils/validation";

const dbWrapper = new DatabaseWrapper(db);

export function createOAuth2Client(): OAuth2Client {
	return new OAuth2Client(
		config.googleClientId,
		config.googleClientSecret,
		config.googleRedirectUri,
	);
}

export function generateAuthUrl() {
	const oauth2Client = createOAuth2Client();
	return oauth2Client.generateAuthUrl({
		access_type: "offline",
		scope: [
			"https://www.googleapis.com/auth/userinfo.profile",
			"https://www.googleapis.com/auth/userinfo.email",
		],
		prompt: "consent",
	});
}

export async function verifyGoogleToken(
	code: string,
): Promise<GoogleUserInfo | null> {
	const oauth2Client = createOAuth2Client();

	try {
		const { tokens } = await oauth2Client.getToken(code);
		oauth2Client.setCredentials(tokens);

		if (!tokens.id_token) {
			logger.warn("Google token response missing id_token");
			return null;
		}

		const ticket = await oauth2Client.verifyIdToken({
			idToken: tokens.id_token,
			audience: config.googleClientId,
		});

		const payload = ticket.getPayload();
		if (!payload?.email) {
			logger.warn("Invalid Google token payload", {
				hasPayload: !!payload,
				hasEmail: !!payload?.email,
			});
			return null;
		}

		const userInfo: GoogleUserInfo = {
			sub: payload.sub,
			email: payload.email,
			name: payload.name,
			picture: payload.picture,
		};

		// Validate with Elysia TypeBox schema
		const validated = validateSchema<GoogleUserInfo>(
			GoogleUserInfoSchema,
			userInfo,
		);
		if (!validated) {
			logger.error("Google user info validation failed", {
				userInfo,
			});
			return null;
		}

		logger.info("Google token verified successfully", {
			email: validated.email,
		});
		return validated;
	} catch (error) {
		logger.error("Failed to verify Google token", {
			error: error as Error,
			codeLength: code.length,
		});
		return null;
	}
}

export async function findOrCreateUser(googleUser: GoogleUserInfo) {
	try {
		// Check if user exists
		const existingUser = await dbWrapper.selectOne<{
			id: number;
			name: string | null;
			picture: string | null;
		}>(db.select().from(users).where(eq(users.googleId, googleUser.sub)));

		if (existingUser) {
			// Update existing user with latest info
			const updatedUser = await dbWrapper.updateAndReturn<{
				id: number;
				email: string;
				name: string | null;
				picture: string | null;
			}>(
				db
					.update(users)
					.set({
						name: googleUser.name || existingUser.name,
						picture: googleUser.picture || existingUser.picture,
						updatedAt: new Date(),
					})
					.where(eq(users.id, existingUser.id))
					.returning(),
			);

			if (!updatedUser) {
				throw new DatabaseError("Failed to retrieve updated user");
			}

			logger.info("User updated successfully", {
				userId: updatedUser.id,
				email: updatedUser.email,
			});
			return updatedUser;
		}

		// Create new user
		let newUser: { id: number; email: string };
		try {
			newUser = (await dbWrapper.insert(
				db.insert(users).values({
					googleId: googleUser.sub,
					email: googleUser.email,
					name: googleUser.name || null,
					picture: googleUser.picture || null,
				}),
			)) as { id: number; email: string };
		} catch (insertError) {
			// Concurrent first-login race: another request may have already
			// created this user between our SELECT and INSERT.
			const racedUser = await dbWrapper.selectOne<{
				id: number;
				email: string;
				name: string | null;
				picture: string | null;
			}>(db.select().from(users).where(eq(users.googleId, googleUser.sub)));

			if (racedUser) {
				logger.info("User created concurrently, using existing record", {
					userId: racedUser.id,
					email: racedUser.email,
				});
				return racedUser;
			}
			throw insertError;
		}

		logger.info("User created successfully", {
			userId: newUser.id,
			email: newUser.email,
		});
		return newUser;
	} catch (error) {
		if (error instanceof DatabaseError) {
			throw error;
		}
		logger.error("Failed to find or create user", {
			googleUser: { sub: googleUser.sub, email: googleUser.email },
			error: error as Error,
		});
		throw new DatabaseError("Failed to find or create user", error as Error);
	}
}
