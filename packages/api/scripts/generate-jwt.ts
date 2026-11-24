// JWT Token Generator for Testing
// Usage: bun run scripts/generate-jwt.ts [userId] [email]
// Example: bun run scripts/generate-jwt.ts 1 "dev@example.com"

import { config } from "../src/utils/const";

interface JwtPayload {
	id: number;
	email: string;
}

async function generateTestToken(payload: JwtPayload): Promise<string> {
	const encoder = new TextEncoder();
	const secret = encoder.encode(config.jwtSecret);

	// Create JWT header
	const header = { alg: "HS256", typ: "JWT" };
	const headerBase64 = btoa(JSON.stringify(header)).replace(/=/g, "");

	// Create JWT payload with exp claim (7 days)
	const now = Math.floor(Date.now() / 1000);
	const fullPayload = {
		...payload,
		iat: now,
		exp: now + 7 * 24 * 60 * 60,
	};
	const payloadBase64 = btoa(JSON.stringify(fullPayload)).replace(/=/g, "");

	// Create signature
	const data = `${headerBase64}.${payloadBase64}`;
	const key = await crypto.subtle.importKey(
		"raw",
		secret,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
	const signatureBase64 = btoa(
		String.fromCharCode(...new Uint8Array(signature)),
	).replace(/=/g, "");

	return `${headerBase64}.${payloadBase64}.${signatureBase64}`;
}

async function main() {
	const args = process.argv.slice(2);

	const userId = args[0] ? parseInt(args[0], 10) : 1;
	const email = args[1] || "dev@example.com";

	if (Number.isNaN(userId)) {
		console.error("Error: User ID must be a number");
		process.exit(1);
	}

	const payload: JwtPayload = { id: userId, email };
	const token = await generateTestToken(payload);

	console.log("\n=== JWT Token Generated ===");
	console.log(`User ID: ${userId}`);
	console.log(`Email: ${email}`);
	console.log("\nToken:");
	console.log(token);
	console.log("\n=== Browser Console Script ===");
	console.log("Copy and paste this into your browser console:");
	console.log(`localStorage.setItem('auth-token', '${token}');`);
	console.log("console.log('Token set in localStorage');");
	console.log("\n=== For API Testing (curl) ===");
	console.log(
		`curl -H "Authorization: Bearer ${token}" http://localhost:3000/tasks`,
	);
}

main();
