import { describe, expect, it } from "bun:test";
import { type CSRFOptions, CSRFProtection } from "../src/utils/csrf";

describe("CSRFProtection", () => {
	describe("default options", () => {
		const csrf = new CSRFProtection();

		it("should have default cookie name", () => {
			expect(csrf.getCookieName()).toBe("csrf-token");
		});

		it("should have default header name", () => {
			expect(csrf.getHeaderName()).toBe("x-csrf-token");
		});
	});

	describe("custom options", () => {
		const customOptions: CSRFOptions = {
			secretLength: 64,
			cookieName: "custom-csrf",
			headerName: "x-custom-csrf",
		};
		const csrf = new CSRFProtection(customOptions);

		it("should use custom cookie name", () => {
			expect(csrf.getCookieName()).toBe("custom-csrf");
		});

		it("should use custom header name", () => {
			expect(csrf.getHeaderName()).toBe("x-custom-csrf");
		});
	});

	describe("generateTokens", () => {
		it("should generate nonce cookie with default length and HMAC header", async () => {
			const csrf = new CSRFProtection();
			const tokens = await csrf.generateTokens();

			// Cookie (nonce) should have default secretLength
			expect(tokens.cookie).toHaveLength(32);
			// Header (HMAC-SHA256 hex) should be 64 chars
			expect(tokens.header).toHaveLength(64);
			// Cookie and header should be different (signed double-submit)
			expect(tokens.cookie).not.toBe(tokens.header);
		});

		it("should generate nonce with custom length", async () => {
			const csrf = new CSRFProtection({ secretLength: 64 });
			const tokens = await csrf.generateTokens();

			expect(tokens.cookie).toHaveLength(64);
			// HMAC is always 64 hex chars regardless of nonce length
			expect(tokens.header).toHaveLength(64);
		});

		it("should generate unique tokens each time", async () => {
			const csrf = new CSRFProtection();
			const tokens1 = await csrf.generateTokens();
			const tokens2 = await csrf.generateTokens();

			expect(tokens1.cookie).not.toBe(tokens2.cookie);
			expect(tokens1.header).not.toBe(tokens2.header);
		});
	});

	describe("validateToken", () => {
		const csrf = new CSRFProtection({ secretLength: 32 });

		it("should return false when header token is missing", async () => {
			const result = await csrf.validateToken("", "somecookie");
			expect(result).toBe(false);
		});

		it("should return false when cookie nonce is missing", async () => {
			const result = await csrf.validateToken("sometoken", "");
			expect(result).toBe(false);
		});

		it("should return false when both are missing", async () => {
			const result = await csrf.validateToken("", "");
			expect(result).toBe(false);
		});

		it("should return false when header doesn't match HMAC of cookie", async () => {
			const result = await csrf.validateToken(
				"wrong-signature",
				"some-nonce-value-that-is-32chars",
			);
			expect(result).toBe(false);
		});

		it("should return false for mismatched cookie nonce", async () => {
			const tokens = await csrf.generateTokens();
			// Use valid header but with a different cookie nonce
			const result = await csrf.validateToken(
				tokens.header,
				"different-nonce-value-32-chars!!",
			);
			expect(result).toBe(false);
		});

		it("should return true when header is valid HMAC of cookie nonce", async () => {
			const tokens = await csrf.generateTokens();
			// header = HMAC(cookie, jwtSecret), so this should pass
			const result = await csrf.validateToken(tokens.header, tokens.cookie);
			expect(result).toBe(true);
		});
	});
});
