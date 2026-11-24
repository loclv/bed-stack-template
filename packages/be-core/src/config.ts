/**
 * Zod-based environment configuration with required/optional var handling.
 * Throws at startup if required variables are missing — no fallback for secrets.
 */

import { createLogger } from "./logger";

const logger = createLogger("config");

/**
 * Get a required environment variable. Throws if missing.
 * @throws Error if the environment variable is not set
 */
export function getRequiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		logger.error(`Required environment variable ${name} is missing`, {
			envVar: name,
		});
		throw new Error(
			`Environment variable ${name} is required but not set. Refusing to start.`,
		);
	}
	return value;
}

/**
 * Get an optional environment variable with a default value.
 */
export function getEnv(name: string, defaultValue: string): string {
	return process.env[name] || defaultValue;
}

/**
 * Get an optional numeric environment variable with a default value.
 */
export function getEnvNumber(name: string, defaultValue: number): number {
	const value = process.env[name];
	if (!value) return defaultValue;
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed)) {
		logger.warn(`Invalid number for env var ${name}, using default`, {
			envVar: name,
			value,
			defaultValue,
		});
		return defaultValue;
	}
	return parsed;
}

/**
 * Get an optional boolean environment variable.
 */
export function getEnvBool(name: string, defaultValue: boolean): boolean {
	const value = process.env[name];
	if (!value) return defaultValue;
	return value.toLowerCase() === "true" || value === "1";
}

/** Common configuration shared across all services. */
export interface BaseServiceConfig {
	nodeEnv: string;
	logLevel: string;
	databaseUrl: string;
	redisUrl: string;
	kafkaBrokers: string[];
	jwtSecret: string;
	jwtRefreshSecret: string;
	trustProxy: boolean;
}

/**
 * Load base service configuration from environment variables.
 * Secret variables have no defaults and will throw if missing.
 */
export function loadBaseConfig(serviceName?: string): BaseServiceConfig {
	const dbUrl = serviceName
		? process.env[`${serviceName.toUpperCase()}_DATABASE_URL`] ||
			process.env.DATABASE_URL
		: process.env.DATABASE_URL;

	if (!dbUrl) {
		logger.error(
			`Database URL is missing. Checked env: ${serviceName ? `${serviceName.toUpperCase()}_DATABASE_URL or ` : ""}DATABASE_URL`,
		);
		throw new Error("DATABASE_URL is required but not set. Refusing to start.");
	}

	return {
		nodeEnv: getEnv("NODE_ENV", "development"),
		logLevel: getEnv("LOG_LEVEL", "info"),
		databaseUrl: dbUrl,
		redisUrl: getEnv("REDIS_URL", "redis://localhost:6379"),
		kafkaBrokers: getEnv("KAFKA_BROKERS", "localhost:9092").split(","),
		jwtSecret: getRequiredEnv("JWT_SECRET"),
		jwtRefreshSecret: getRequiredEnv("JWT_REFRESH_SECRET"),
		trustProxy: getEnvBool("TRUST_PROXY", false),
	};
}
