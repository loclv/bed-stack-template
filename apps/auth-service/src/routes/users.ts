/**
 * User profile routes for the auth service.
 */

import { createLogger, ResponseBuilder } from "@bed-stack/be-core";
import { Elysia, t } from "elysia";
import type pg from "pg";
import type { AuthServiceConfig } from "../config";

const logger = createLogger("user-routes");

/**
 * Create user routes plugin.
 */
export function userRoutes(pool: pg.Pool, _config: AuthServiceConfig) {
	return new Elysia({ prefix: "/users" })
		.get("/me", async ({ jwt, cookie, set }) => {
			const token = cookie?.token?.value;
			if (!token) {
				return ResponseBuilder.success({ authenticated: false });
			}

			try {
				const payload = await jwt.verify(token);
				if (!payload || typeof payload === "boolean") {
					return ResponseBuilder.success({ authenticated: false });
				}

				const userId = payload.userId as number;
				const result = await pool.query<{
					id: number;
					email: string;
					name: string | null;
					picture: string | null;
				}>("SELECT id, email, name, picture FROM users WHERE id = $1", [
					userId,
				]);

				const user = result.rows[0];
				if (!user) {
					return ResponseBuilder.success({ authenticated: false });
				}

				return ResponseBuilder.success({ user });
			} catch {
				return ResponseBuilder.success({ authenticated: false });
			}
		})
		.patch(
			"/me",
			async ({ body, jwt, cookie, set }) => {
				const token = cookie?.token?.value;
				if (!token) {
					set.status = 401;
					return ResponseBuilder.unauthorized();
				}

				try {
					const payload = await jwt.verify(token);
					if (!payload || typeof payload === "boolean") {
						set.status = 401;
						return ResponseBuilder.unauthorized();
					}

					const userId = payload.userId as number;
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
						[name || null, picture || null, userId],
					);

					const user = result.rows[0];
					if (!user) {
						set.status = 404;
						return ResponseBuilder.notFound("User not found");
					}

					logger.info("User profile updated", { userId });
					return ResponseBuilder.success({ user });
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
