/**
 * Auth service configuration.
 * Extends base config with auth-specific environment variables.
 */

import {
	type BaseServiceConfig,
	getEnv,
	getEnvNumber,
	loadBaseConfig,
} from "@bed-stack/be-core/config";

export interface AuthServiceConfig extends BaseServiceConfig {
	authPort: number;
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
		webUrl: getEnv("WEB_URL", "http://localhost:4097"),
		atTtlSeconds: getEnvNumber("JWT_AT_TTL_SECONDS", 900), // 15 minutes
		rtTtlSeconds: getEnvNumber("RT_TTL_SECONDS", 7_776_000), // 90 days
		rtGraceWindowSeconds: getEnvNumber("RT_GRACE_WINDOW_SECONDS", 10),
	};
}
