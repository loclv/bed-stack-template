import { logger } from "./logger";

export interface Config {
	googleClientId: string;
	googleClientSecret: string;
	googleRedirectUri: string;
	jwtSecret: string;
	jwtCookieName: string;
	nodeEnv: string;
	logLevel: string;
	apiPort: number;
	webUrl: string;
	databasePath: string;
	trustProxy: boolean;
}

function getRequiredEnvVar(
	name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "JWT_SECRET",
): string {
	const value = process.env[name];
	if (!value) {
		logger.error(`Required environment variable ${name} is missing`, {
			envVar: name,
		});
		throw new Error(`Environment variable ${name} is required`);
	}
	return value;
}

function getEnvVar(name: string, defaultValue: string): string {
	return process.env[name] || defaultValue;
}

function getEnvNumber(name: string, defaultValue: number): number {
	const value = process.env[name];
	if (!value) return defaultValue;
	const parsed = parseInt(value, 10);
	if (Number.isNaN(parsed)) {
		logger.warn(
			`Invalid number for environment variable ${name}, using default`,
			{ envVar: name, value, defaultValue },
		);
		return defaultValue;
	}
	return parsed;
}

export const config: Config = {
	googleClientId: getRequiredEnvVar("GOOGLE_CLIENT_ID"),
	googleClientSecret: getRequiredEnvVar("GOOGLE_CLIENT_SECRET"),
	googleRedirectUri: getEnvVar(
		"GOOGLE_REDIRECT_URI",
		"http://localhost:3000/auth/callback",
	),
	jwtSecret: getRequiredEnvVar("JWT_SECRET"),
	jwtCookieName: getEnvVar("JWT_COOKIE_NAME", "token"),
	nodeEnv: getEnvVar("NODE_ENV", "development"),
	logLevel: getEnvVar("LOG_LEVEL", "info"),
	apiPort: getEnvNumber("API_PORT", 3000),
	webUrl: getEnvVar("WEB_URL", "http://localhost:4097"),
	databasePath: getEnvVar("DATABASE_PATH", "sqlite.db"),
	trustProxy: getEnvVar("TRUST_PROXY", "false") === "true",
};
