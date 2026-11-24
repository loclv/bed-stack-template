/**
 * User profile routes for the auth service.
 */

import {
	createCsrfProtection,
	createLogger,
	ResponseBuilder,
} from "@bed-stack/be-core";
import { Elysia, t } from "elysia";
import type pg from "pg";
import type { AuthServiceConfig } from "../config";

const logger = createLogger("user-routes");

type CookieJar = Record<
	string,
	{ value?: string; set: (opts: Record<string, unknown>) => void }
>;

interface UserRow {
	id: number;
	email: string;
	name: string | null;
	picture: string | null;
	token_version: number;
}

/**
 * Create user routes plugin.
 */
export function userRoutes(pool: pg.Pool, config: AuthServiceConfig) {
	const csrfProtection = createCsrfProtection(config.jwtSecret);

	/**
	 * Verify the JWT and confirm its tokenVersion claim matches the user's
	 * current version (rejects tokens revoked by logout-all).
	 * Returns the user row, or null when unauthenticated/stale.
	 */
	const authenticate = async (
		jwt: { verify: (token: string) => Promise<unknown> },
		cookie: CookieJar,
	): Promise<UserRow | null> => {
		const token = cookie?.token?.value;
		if (!token) return null;

		try {
			const payload = (await jwt.verify(token)) as
				| { userId?: number; tokenVersion?: number }
				| boolean
				| null;
			if (!payload || typeof payload === "boolean" || !payload.userId) {
				return null;
			}

			const result = await pool.query<UserRow>(
				"SELECT id, email, name, picture, token_version FROM users WHERE id = $1",
				[payload.userId],
			);
			const user = result.rows[0];
			if (!user) return null;

			if (
				payload.tokenVersion !== undefined &&
				user.token_version !== payload.tokenVersion
			) {
				return null;
			}

			return user;
		} catch {
			return null;
		}
	};

	return new Elysia({ prefix: "/users" })
		.get("/me", async ({ jwt, cookie }) => {
			const user = await authenticate(jwt, cookie as any);
			if (!user) {
				return ResponseBuilder.success({ authenticated: false });
			}
			return ResponseBuilder.success({
				authenticated: true,
				user: {
					id: user.id,
					email: user.email,
					name: user.name,
					picture: user.picture,
				},
			});
		})
		.patch(
			"/me",
			async ({ body, jwt, cookie, set, headers }) => {
				// CSRF: mutating endpoint authenticated by cookie — require the
				// double-submit header signed over the csrf-token cookie nonce.
				const headerToken = (headers as Record<string, unknown>)[
					csrfProtection.getHeaderName()
				] as string | undefined;
				const cookieNonce = (cookie as any)?.[csrfProtection.getCookieName()]
					?.value as string | undefined;
				if (
					!(await csrfProtection.validateToken(
						headerToken || "",
						cookieNonce || "",
					))
				) {
					set.status = 403;
					return ResponseBuilder.forbidden("Invalid CSRF token");
				}

				const user = await authenticate(jwt, cookie as any);
				if (!user) {
					set.status = 401;
					return ResponseBuilder.unauthorized();
				}

				try {
					const { name, picture } = body;

					const result = await pool.query<{
						id: number;
						email: string;
						name: string | null;
						picture: string | null;
					}>(
						`UPDATE users
						 SET name = COALESCE($1, name),
						     picture = COALESCE($2, picture),
						     updated_at = NOW()
						 WHERE id = $3
						 RETURNING id, email, name, picture`,
						[name || null, picture || null, user.id],
					);

					const updated = result.rows[0];
					if (!updated) {
						set.status = 404;
						return ResponseBuilder.notFound("User not found");
					}

					logger.info("User profile updated", { userId: user.id });
					return ResponseBuilder.success({ user: updated });
				} catch (err) {
					logger.error("Failed to update profile", { error: err as Error });
					return ResponseBuilder.internal("Failed to update profile");
				}
			},
			{
				body: t.Object({
					name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
					picture: t.Optional(t.String()),
				}),
			},
		);
}
