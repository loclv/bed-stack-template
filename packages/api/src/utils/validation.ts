import { Value } from "@sinclair/typebox/value";
import { t } from "elysia";
import { logger } from "./logger";

export const GoogleAuthQuerySchema = t.Object({
	code: t.String({
		minLength: 1,
		error: "Authorization code is required",
	}),
});

export const UserUpdateSchema = t.Object({
	name: t.Optional(
		t.String({
			minLength: 1,
			maxLength: 100,
			error: "Name must be between 1 and 100 characters",
		}),
	),
	picture: t.Optional(
		t.String({
			format: "uri",
			error: "Picture must be a valid URL",
		}),
	),
});

export const JwtPayloadSchema = t.Object({
	id: t.Number(),
	email: t.String({
		format: "email",
		error: "Email must be a valid email address",
	}),
	iat: t.Optional(t.Number()),
	exp: t.Optional(t.Number()),
});

export const GoogleUserInfoSchema = t.Object({
	sub: t.String(),
	email: t.String({
		format: "email",
		error: "Email must be a valid email address",
	}),
	name: t.Optional(t.String()),
	picture: t.Optional(
		t.String({
			format: "uri",
			error: "Picture must be a valid URL",
		}),
	),
});

export const ApiKeyCreateSchema = t.Object({
	name: t.Optional(
		t.String({
			minLength: 1,
			maxLength: 100,
			error: "Name must be between 1 and 100 characters",
		}),
	),
	expiresAt: t.Optional(t.Number()),
});

export const ApiKeyRevokeSchema = t.Object({
	id: t.Number({
		error: "API key ID is required",
	}),
});

export type JwtPayload = typeof JwtPayloadSchema.static;
export type UserUpdate = typeof UserUpdateSchema.static;
export type GoogleUserInfo = typeof GoogleUserInfoSchema.static;
export type GoogleAuthQuery = typeof GoogleAuthQuerySchema.static;
export type ApiKeyCreate = typeof ApiKeyCreateSchema.static;
export type ApiKeyRevoke = typeof ApiKeyRevokeSchema.static;

// Helper functions for validation
export function validateSchema<T>(schema: T, data: unknown): T | null {
	try {
		// biome-ignore lint/suspicious/noExplicitAny: Required for TypeBox schema compatibility
		const errors = Array.from(Value.Errors(schema as any, data));
		if (errors.length > 0) {
			logger.error("Schema validation failed", {
				errors: errors.map((e) => ({ path: e.path, message: e.message })),
			});
			return null;
		}
		// biome-ignore lint/suspicious/noExplicitAny: Required for TypeBox schema compatibility
		const result = Value.Decode(schema as any, data);
		return result as T;
	} catch (error) {
		logger.error("Schema validation threw an exception", {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export function validateSchemaWithError<T>(
	schema: T,
	data: unknown,
): { success: boolean; data?: T; error?: string } {
	try {
		// The Elysia schema is already a TypeBox schema
		// biome-ignore lint/suspicious/noExplicitAny: Required for TypeBox schema compatibility
		const errors = Array.from(Value.Errors(schema as any, data));
		if (errors.length > 0) {
			return {
				success: false,
				error: errors.map((e) => e.message).join(", "),
			};
		}
		// biome-ignore lint/suspicious/noExplicitAny: Required for TypeBox schema compatibility
		const result = Value.Decode(schema as any, data);
		return { success: true, data: result as T };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Validation failed",
		};
	}
}
