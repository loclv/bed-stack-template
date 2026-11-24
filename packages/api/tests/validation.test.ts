import { describe, expect, it } from "bun:test";
import {
	GoogleAuthQuerySchema,
	GoogleUserInfoSchema,
	JwtPayloadSchema,
	UserUpdateSchema,
	validateSchema,
} from "../src/utils/validation";

describe("Validation Schemas", () => {
	describe("GoogleAuthQuerySchema", () => {
		it("should validate valid auth query", () => {
			const validQuery = { code: "valid_auth_code" };
			const result = validateSchema(GoogleAuthQuerySchema, validQuery);

			expect(result).not.toBeNull();
			if (result) {
				expect((result as any).code).toBe("valid_auth_code");
			}
		});

		it("should reject empty code", () => {
			const invalidQuery = { code: "" };
			const result = validateSchema(GoogleAuthQuerySchema, invalidQuery);

			expect(result).toBeNull();
		});

		it("should reject missing code", () => {
			const invalidQuery = {};
			const result = validateSchema(GoogleAuthQuerySchema, invalidQuery);

			expect(result).toBeNull();
		});
	});

	describe("UserUpdateSchema", () => {
		it("should validate valid user update with name", () => {
			const validUpdate = { name: "John Doe" };
			const result = validateSchema(UserUpdateSchema, validUpdate);

			expect(result).not.toBeNull();
			if (result) {
				expect((result as any).name).toBe("John Doe");
			}
		});

		it("should validate valid user update with picture URL", () => {
			const validUpdate = { picture: "https://example.com/avatar.jpg" };
			const result = validateSchema(UserUpdateSchema, validUpdate);

			expect(result).not.toBeNull();
			if (result) {
				expect((result as any).picture).toBe("https://example.com/avatar.jpg");
			}
		});

		it("should validate valid user update with both fields", () => {
			const validUpdate = {
				name: "John Doe",
				picture: "https://example.com/avatar.jpg",
			};
			const result = validateSchema(UserUpdateSchema, validUpdate);

			expect(result).not.toBeNull();
		});

		it("should validate empty update", () => {
			const emptyUpdate = {};
			const result = validateSchema(UserUpdateSchema, emptyUpdate);

			expect(result).not.toBeNull();
		});

		it("should reject name that is too short", () => {
			const invalidUpdate = { name: "" };
			const result = validateSchema(UserUpdateSchema, invalidUpdate);

			expect(result).toBeNull();
		});

		it("should reject name that is too long", () => {
			const invalidUpdate = { name: "a".repeat(101) };
			const result = validateSchema(UserUpdateSchema, invalidUpdate);

			expect(result).toBeNull();
		});

		it("should reject invalid picture URL", () => {
			const invalidUpdate = { picture: "not-a-url" };
			const result = validateSchema(UserUpdateSchema, invalidUpdate);

			expect(result).toBeNull();
		});
	});

	describe("JwtPayloadSchema", () => {
		it("should validate valid JWT payload", () => {
			const validPayload = { id: 1, email: "test@example.com" };
			const result = validateSchema(JwtPayloadSchema, validPayload);

			expect(result).not.toBeNull();
			if (result) {
				expect((result as any).id).toBe(1);
				expect((result as any).email).toBe("test@example.com");
			}
		});

		it("should validate JWT payload with optional fields", () => {
			const validPayload = {
				id: 1,
				email: "test@example.com",
				iat: 1234567890,
				exp: 1234567891,
			};
			const result = validateSchema(JwtPayloadSchema, validPayload);

			expect(result).not.toBeNull();
		});

		it("should reject missing id", () => {
			const invalidPayload = { email: "test@example.com" };
			const result = validateSchema(JwtPayloadSchema, invalidPayload);

			expect(result).toBeNull();
		});

		it("should reject missing email", () => {
			const invalidPayload = { id: 1 };
			const result = validateSchema(JwtPayloadSchema, invalidPayload);

			expect(result).toBeNull();
		});

		it("should reject invalid email format", () => {
			const invalidPayload = { id: 1, email: "not-an-email" };
			const result = validateSchema(JwtPayloadSchema, invalidPayload);

			expect(result).toBeNull();
		});
	});

	describe("GoogleUserInfoSchema", () => {
		it("should validate valid Google user info", () => {
			const validUserInfo = {
				sub: "123456789",
				email: "test@example.com",
				name: "Test User",
				picture: "https://example.com/avatar.jpg",
			};
			const result = validateSchema(GoogleUserInfoSchema, validUserInfo);

			expect(result).not.toBeNull();
			if (result) {
				expect((result as any).sub).toBe("123456789");
				expect((result as any).email).toBe("test@example.com");
				expect((result as any).name).toBe("Test User");
				expect((result as any).picture).toBe("https://example.com/avatar.jpg");
			}
		});

		it("should validate Google user info without optional fields", () => {
			const validUserInfo = {
				sub: "123456789",
				email: "test@example.com",
			};
			const result = validateSchema(GoogleUserInfoSchema, validUserInfo);

			expect(result).not.toBeNull();
		});

		it("should reject missing sub", () => {
			const invalidUserInfo = {
				email: "test@example.com",
				name: "Test User",
			};
			const result = validateSchema(GoogleUserInfoSchema, invalidUserInfo);

			expect(result).toBeNull();
		});

		it("should reject missing email", () => {
			const invalidUserInfo = {
				sub: "123456789",
				name: "Test User",
			};
			const result = validateSchema(GoogleUserInfoSchema, invalidUserInfo);

			expect(result).toBeNull();
		});

		it("should reject invalid email format", () => {
			const invalidUserInfo = {
				sub: "123456789",
				email: "not-an-email",
			};
			const result = validateSchema(GoogleUserInfoSchema, invalidUserInfo);

			expect(result).toBeNull();
		});

		it("should reject invalid picture URL", () => {
			const invalidUserInfo = {
				sub: "123456789",
				email: "test@example.com",
				picture: "not-a-url",
			};
			const result = validateSchema(GoogleUserInfoSchema, invalidUserInfo);

			expect(result).toBeNull();
		});
	});
});
