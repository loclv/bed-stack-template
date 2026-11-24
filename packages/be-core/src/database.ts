/**
 * PostgreSQL database connection pool using pg (node-postgres).
 * Configures pool size per formula: (cpu * 2) + spindles.
 * Integrates with Drizzle ORM for type-safe queries.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createLogger } from "./logger";

const logger = createLogger("database");

/** Default pool size: (2 CPUs * 2) + 1 spindle = 5 */
const DEFAULT_POOL_MAX = 5;

export interface DatabaseConfig {
	connectionString: string;
	/** Maximum number of connections. Formula: (cpu * 2) + spindles. Default: 5 */
	maxConnections?: number;
	/** Connection timeout in milliseconds. Default: 5000 */
	connectionTimeoutMs?: number;
	/** Idle timeout in milliseconds. Default: 30000 */
	idleTimeoutMs?: number;
}

/**
 * Create a PostgreSQL connection pool and Drizzle ORM instance.
 * @returns Object with pool (for health checks/shutdown) and db (Drizzle instance)
 */
export function createDatabase(config: DatabaseConfig) {
	const pool = new pg.Pool({
		connectionString: config.connectionString,
		max: config.maxConnections || DEFAULT_POOL_MAX,
		connectionTimeoutMillis: config.connectionTimeoutMs || 5000,
		idleTimeoutMillis: config.idleTimeoutMs || 30000,
	});

	pool.on("error", (err) => {
		logger.error("Unexpected pool error", { error: err });
	});

	pool.on("connect", () => {
		logger.debug("New database connection established");
	});

	// TODO(prod): Consider PgBouncer for connection pooling at scale
	// Pool size 5 is fine for dev. Production should tune per:
	// max = (cpu_cores * 2) + effective_spindle_count
	const db = drizzle(pool);

	logger.info("Database pool created", {
		maxConnections: config.maxConnections || DEFAULT_POOL_MAX,
	});

	return { pool, db };
}

/**
 * Run raw SQL for migrations and DDL.
 */
export async function runSQL(
	pool: pg.Pool,
	sql: string,
): Promise<pg.QueryResult> {
	const client = await pool.connect();
	try {
		return await client.query(sql);
	} finally {
		client.release();
	}
}

export type { pg };
