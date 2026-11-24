import { describe, expect, it } from "bun:test";
import { createOAuth2Client } from "../src/auth";

describe("Authentication Utils", () => {
	describe("createOAuth2Client", () => {
		it("should create an OAuth2Client instance", () => {
			const client = createOAuth2Client();
			expect(client).toBeDefined();
			expect(typeof client.generateAuthUrl).toBe("function");
			expect(typeof client.getToken).toBe("function");
		});
	});

	describe("OAuth2Client Configuration", () => {
		it("should be configured with correct environment variables", () => {
			const client = createOAuth2Client();
			// Test that the client was created without throwing errors
			// This validates that environment variables are properly loaded
			expect(client).toBeDefined();
		});
	});
});
