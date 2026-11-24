import { eq } from "drizzle-orm";
import { type Elysia, t } from "elysia";
import { db } from "../db";
import { type User, users } from "../db/schema";
import { csrfProtection } from "../utils/csrf";
import { DatabaseWrapper } from "../utils/database";
import { logger } from "../utils/logger";
import { ResponseBuilder } from "../utils/response";
import {
	type JwtPayload,
	JwtPayloadSchema,
	type UserUpdate,
	UserUpdateSchema,
	validateSchemaWithError,
} from "../utils/validation";

const dbWrapper = new DatabaseWrapper(db);

// Extract token from Authorization header or httpOnly cookie
function getToken(
	authHeader: string | undefined,
	cookieToken?: string,
): string | undefined {
	if (authHeader?.startsWith("Bearer ")) {
		return authHeader.slice(7);
	}
	return cookieToken;
}

export const usersPlugin = (app: Elysia) =>
	app
		.get("/users/me", async ({ jwt, headers, cookie }) => {
			const token = getToken(
				headers.authorization as string | undefined,
				cookie.token?.value,
			);

			if (!token || typeof token !== "string" || !jwt) {
				return ResponseBuilder.success({ authenticated: false });
			}

			try {
				const payload = await jwt.verify(token);

				// Validate JWT payload with Elysia TypeBox
				const payloadValidation = validateSchemaWithError<JwtPayload>(
					// biome-ignore lint/suspicious/noExplicitAny: Required for TypeBox schema compatibility
					JwtPayloadSchema as any,
					payload as Record<string, unknown>,
				);
				if (!payloadValidation.success || !payloadValidation.data) {
					logger.warn("Invalid JWT payload in /users/me", {
						error: payloadValidation.error,
					});
					return ResponseBuilder.success({ authenticated: false });
				}

				const jwtPayload = payloadValidation.data;

				const user = (await dbWrapper.selectOne<{
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
						.where(eq(users.id, jwtPayload.id)),
				)) as User | null;

				if (!user) {
					logger.warn("User not found in /users/me", {
						userId: jwtPayload.id,
					});
					return ResponseBuilder.success({ authenticated: false });
				}

				return ResponseBuilder.success({ user });
			} catch (error) {
				logger.error("Failed to get user profile", { error: error as Error });
				return ResponseBuilder.success({ authenticated: false });
			}
		})
		.patch(
			"/users/me",
			async ({ body, headers, jwt, cookie }) => {
				const token = getToken(
					headers.authorization as string | undefined,
					cookie.token?.value,
				);

				if (!token || typeof token !== "string" || !jwt) {
					return ResponseBuilder.unauthorized("Authentication required");
				}

				// CSRF protection: compare HMAC signature header against cookie nonce
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
					logger.warn("CSRF validation failed for user update", {
						hasHeader: !!csrfHeader,
						hasCookie: !!csrfCookie,
					});
					return ResponseBuilder.forbidden("CSRF validation failed");
				}

				try {
					const payload = await jwt.verify(token);

					// Validate JWT payload with Elysia TypeBox
					const payloadValidation = validateSchemaWithError<JwtPayload>(
						// biome-ignore lint/suspicious/noExplicitAny: Required for TypeBox schema compatibility
						JwtPayloadSchema as any,
						payload as Record<string, unknown>,
					);
					if (!payloadValidation.success || !payloadValidation.data) {
						logger.warn("Invalid JWT payload in user update", {
							error: payloadValidation.error,
						});
						return ResponseBuilder.unauthorized("Invalid authentication token");
					}

					// Validate request body with Elysia TypeBox
					const bodyValidation = validateSchemaWithError<UserUpdate>(
						// biome-ignore lint/suspicious/noExplicitAny: Required for TypeBox schema compatibility
						UserUpdateSchema as any,
						body,
					);
					if (!bodyValidation.success || !bodyValidation.data) {
						logger.warn("Invalid user update body", {
							error: bodyValidation.error,
							body,
						});
						return ResponseBuilder.validation("Invalid request body", [
							{
								message: bodyValidation.error || "Invalid request body",
								path: "body",
							},
						]);
					}

					const jwtPayload = payloadValidation.data;
					const { name, picture } = bodyValidation.data;

					const updatedUser = (await dbWrapper.updateAndReturn(
						db
							.update(users)
							.set({
								name: name ?? undefined,
								picture: picture ?? undefined,
								updatedAt: new Date(),
							})
							.where(eq(users.id, jwtPayload.id))
							.returning(),
					)) as User;

					if (!updatedUser) {
						logger.error("Failed to retrieve updated user", {
							userId: jwtPayload.id,
						});
						return ResponseBuilder.internal("Failed to update profile");
					}

					logger.info("User profile updated successfully", {
						userId: updatedUser.id,
						email: updatedUser.email,
						updatedFields: { name: !!name, picture: !!picture },
					});

					return ResponseBuilder.success({ user: updatedUser });
				} catch (error) {
					logger.error("Failed to update user profile", {
						error: error as Error,
					});
					return ResponseBuilder.internal("Failed to update profile");
				}
			},
			{
				body: t.Object({
					name: t.Optional(t.String()),
					picture: t.Optional(t.String()),
				}),
				headers: t.Object({
					[csrfProtection.getHeaderName()]: t.Optional(t.String()),
				}),
			},
		);
