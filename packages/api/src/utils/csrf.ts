import { timingSafeEqual } from "node:crypto";
import { config } from "./const";
import { logger } from "./logger";

export interface CSRFOptions {
	secretLength?: number;
	cookieName?: string;
	headerName?: string;
}

export interface CSRFTokens {
	token: string;
	cookie: string;
	header: string;
}

const encoder = new TextEncoder();

/**
 * CSRF protection using the Signed Double-Submit Cookie pattern.
 * The cookie holds a random nonce; the header holds HMAC(nonce, serverSecret).
 * Validation recomputes the HMAC and compares using constant-time equality.
 */
export class CSRFProtection {
	private secretLength!: number;
	private cookieName!: string;
	private headerName!: string;

	constructor(options: CSRFOptions = {}) {
		this.secretLength = options.secretLength || 32;
		this.cookieName = options.cookieName || "csrf-token";
		this.headerName = options.headerName || "x-csrf-token";
	}

	/**
	 * Generate a cryptographically random nonce string.
	 */
	private generateNonce(): string {
		const chars =
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
		const bytes = crypto.getRandomValues(new Uint8Array(this.secretLength));
		let result = "";
		for (let i = 0; i < this.secretLength; i++) {
			result += chars.charAt(bytes[i]! % chars.length);
		}
		return result;
	}

	/**
	 * Compute HMAC-SHA256 signature of the nonce using the JWT secret as key.
	 */
	private async signNonce(nonce: string): Promise<string> {
		const key = await crypto.subtle.importKey(
			"raw",
			encoder.encode(config.jwtSecret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const signature = await crypto.subtle.sign(
			"HMAC",
			key,
			encoder.encode(nonce),
		);
		return Array.from(new Uint8Array(signature))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	/**
	 * Generate a CSRF token pair: nonce for cookie, HMAC signature for header.
	 */
	async generateTokens(): Promise<CSRFTokens> {
		const nonce = this.generateNonce();
		const signature = await this.signNonce(nonce);

		logger.debug("CSRF tokens generated", {
			nonceLength: nonce.length,
		});

		return { token: nonce, cookie: nonce, header: signature };
	}

	/**
	 * Validate a CSRF token pair using constant-time comparison.
	 * @param headerToken - The HMAC signature sent in the request header.
	 * @param cookieNonce - The nonce stored in the cookie.
	 * @returns true if the header is a valid HMAC of the cookie nonce.
	 */
	async validateToken(
		headerToken: string,
		cookieNonce: string,
	): Promise<boolean> {
		if (!headerToken || !cookieNonce) {
			logger.warn("CSRF validation failed: missing token or cookie", {
				hasToken: !!headerToken,
				hasCookie: !!cookieNonce,
			});
			return false;
		}

		try {
			const expectedSignature = await this.signNonce(cookieNonce);

			// Constant-time comparison to prevent timing attacks
			const expectedBuf = Buffer.from(expectedSignature, "utf-8");
			const receivedBuf = Buffer.from(headerToken, "utf-8");

			if (expectedBuf.length !== receivedBuf.length) {
				logger.warn("CSRF validation failed: signature length mismatch");
				return false;
			}

			const isValid = timingSafeEqual(expectedBuf, receivedBuf);

			if (!isValid) {
				logger.warn("CSRF validation failed: signature mismatch");
			}

			return isValid;
		} catch (error) {
			logger.error("CSRF validation error", { error: error as Error });
			return false;
		}
	}

	getCookieName(): string {
		return this.cookieName;
	}

	getHeaderName(): string {
		return this.headerName;
	}
}

export const csrfProtection = new CSRFProtection();
