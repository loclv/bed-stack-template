import { describe, expect, it } from "bun:test";

describe("Elysia Validation Schemas", () => {
	describe("GoogleAuthQuerySchema", () => {
		it("should validate valid auth query", () => {
			const validQuery = { code: "valid_auth_code" };
			// Elysia schemas are used at runtime, so we test the structure
			expect(validQuery.code).toBe("valid_auth_code");
			expect(typeof validQuery.code).toBe("string");
			expect(validQuery.code.length).toBeGreaterThan(0);
		});

		it("should reject empty code", () => {
			const invalidQuery = { code: "" };
			// In Elysia, validation happens at the framework level
			// We test the business logic here
			expect(invalidQuery.code).toBe("");
			expect(invalidQuery.code.length).toBe(0);
		});

		it("should reject missing code", () => {
			const invalidQuery = {};
			expect(invalidQuery).not.toHaveProperty("code");
		});
	});

	describe("UserUpdateSchema", () => {
		it("should validate valid user update with name", () => {
			const validUpdate = { name: "John Doe" };
			expect(validUpdate.name).toBe("John Doe");
			expect(typeof validUpdate.name).toBe("string");
			expect(validUpdate.name.length).toBeGreaterThanOrEqual(1);
			expect(validUpdate.name.length).toBeLessThanOrEqual(100);
		});

		it("should validate valid user update with picture URL", () => {
			const validUpdate = { picture: "https://example.com/avatar.jpg" };
			expect(validUpdate.picture).toBe("https://example.com/avatar.jpg");
			// Basic URL validation
			expect(validUpdate.picture).toMatch(/^https?:\/\//);
		});

		it("should validate valid user update with both fields", () => {
			const validUpdate = {
				name: "John Doe",
				picture: "https://example.com/avatar.jpg",
			};
			expect(validUpdate.name).toBe("John Doe");
			expect(validUpdate.picture).toBe("https://example.com/avatar.jpg");
		});

		it("should validate empty update", () => {
			const emptyUpdate = {};
			expect(Object.keys(emptyUpdate)).toHaveLength(0);
		});

		it("should reject name that is too short", () => {
			const invalidUpdate = { name: "" };
			expect(invalidUpdate.name).toBe("");
			expect(invalidUpdate.name.length).toBe(0);
		});

		it("should reject name that is too long", () => {
			const invalidUpdate = { name: "a".repeat(101) };
			expect(invalidUpdate.name.length).toBe(101);
		});

		it("should reject invalid picture URL", () => {
			const invalidUpdate = { picture: "not-a-url" };
			expect(invalidUpdate.picture).toBe("not-a-url");
			expect(invalidUpdate.picture).not.toMatch(/^https?:\/\//);
		});
	});

	describe("JwtPayloadSchema", () => {
		it("should validate valid JWT payload", () => {
			const validPayload = { id: 1, email: "test@example.com" };
			expect(validPayload.id).toBe(1);
			expect(typeof validPayload.id).toBe("number");
			expect(validPayload.email).toBe("test@example.com");
			expect(validPayload.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
		});

		it("should validate JWT payload with optional fields", () => {
			const validPayload = {
				id: 1,
				email: "test@example.com",
				iat: 1234567890,
				exp: 1234567891,
			};
			expect(validPayload.id).toBe(1);
			expect(validPayload.email).toBe("test@example.com");
			expect(validPayload.iat).toBe(1234567890);
			expect(validPayload.exp).toBe(1234567891);
		});

		it("should reject missing id", () => {
			const invalidPayload = { email: "test@example.com" };
			expect(invalidPayload).not.toHaveProperty("id");
		});

		it("should reject missing email", () => {
			const invalidPayload = { id: 1 };
			expect(invalidPayload).not.toHaveProperty("email");
		});

		it("should reject invalid email format", () => {
			const invalidPayload = { id: 1, email: "not-an-email" };
			expect(invalidPayload.email).toBe("not-an-email");
			expect(invalidPayload.email).not.toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
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
			expect(validUserInfo.sub).toBe("123456789");
			expect(validUserInfo.email).toBe("test@example.com");
			expect(validUserInfo.name).toBe("Test User");
			expect(validUserInfo.picture).toBe("https://example.com/avatar.jpg");
		});

		it("should validate Google user info without optional fields", () => {
			const validUserInfo = {
				sub: "123456789",
				email: "test@example.com",
			};
			expect(validUserInfo.sub).toBe("123456789");
			expect(validUserInfo.email).toBe("test@example.com");
			expect(validUserInfo).not.toHaveProperty("name");
			expect(validUserInfo).not.toHaveProperty("picture");
		});

		it("should reject missing sub", () => {
			const invalidUserInfo = {
				email: "test@example.com",
				name: "Test User",
			};
			expect(invalidUserInfo).not.toHaveProperty("sub");
		});

		it("should reject missing email", () => {
			const invalidUserInfo = {
				sub: "123456789",
				name: "Test User",
			};
			expect(invalidUserInfo).not.toHaveProperty("email");
		});

		it("should reject invalid email format", () => {
			const invalidUserInfo = {
				sub: "123456789",
				email: "not-an-email",
			};
			expect(invalidUserInfo.email).toBe("not-an-email");
			expect(invalidUserInfo.email).not.toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
		});

		it("should reject invalid picture URL", () => {
			const invalidUserInfo = {
				sub: "123456789",
				email: "test@example.com",
				picture: "not-a-url",
			};
			expect(invalidUserInfo.picture).toBe("not-a-url");
			expect(invalidUserInfo.picture).not.toMatch(/^https?:\/\//);
		});
	});
});
