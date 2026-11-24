/**
 * Auth service configuration.
 * Extends base config with auth-specific environment variables.
 */

import {
	type BaseServiceConfig,
	getEnv,
	getEnvNumber,
	getRequiredEnv,
	loadBaseConfig,
} from "@bed-stack/be-core/config";

export interface AuthServiceConfig extends BaseServiceConfig {
	authPort: number;
	googleClientId: string;
	googleClientSecret: string;
	googleRedirectUri: string;
	webUrl: string;
	atTtlSeconds: number;
	rtTtlSeconds: number;
	rtGraceWindowSeconds: number;
}

/**
 * Load auth service configuration from environment variables.
 */
export function loadAuthConfig(): AuthServiceConfig {
	const base = loadBaseConfig("auth");
	return {
		...base,
		authPort: getEnvNumber("AUTH_PORT", 3001),
		googleClientId: getRequiredEnv("GOOGLE_CLIENT_ID"),
		googleClientSecret: getRequiredEnv("GOOGLE_CLIENT_SECRET"),
		googleRedirectUri: getEnv(
			"GOOGLE_REDIRECT_URI",
			"http://localhost:8080/api/auth/callback",
		),
		webUrl: getEnv("WEB_URL", "http://localhost:4097"),
		atTtlSeconds: getEnvNumber("JWT_AT_TTL_SECONDS", 900), // 15 minutes
		rtTtlSeconds: getEnvNumber("RT_TTL_SECONDS", 7_776_000), // 90 days
		rtGraceWindowSeconds: getEnvNumber("RT_GRACE_WINDOW_SECONDS", 10),
	};
}
