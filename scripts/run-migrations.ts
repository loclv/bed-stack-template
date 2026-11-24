/**
 * Database Migration Runner.
 * Executes versioned SQL migrations against separate microservice databases.
 */

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

let BASE_DB_URL =
	process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432";
// Remove trailing path/database if present to get clean base connection
if (
	BASE_DB_URL.endsWith("/auth_db") ||
	BASE_DB_URL.endsWith("/seat_db") ||
	BASE_DB_URL.endsWith("/payment_db") ||
	BASE_DB_URL.endsWith("/postgres")
) {
	BASE_DB_URL = BASE_DB_URL.substring(0, BASE_DB_URL.lastIndexOf("/"));
}

async function runMigration(dbName: string, sqlFilePath: string) {
	const connectionString = `${BASE_DB_URL}/${dbName}`;
	const client = new pg.Client({ connectionString });

	await client.connect();
	try {
		console.log(
			`Running migration on ${dbName} from ${path.basename(sqlFilePath)}...`,
		);
		const sqlContent = fs.readFileSync(sqlFilePath, "utf-8");
		await client.query(sqlContent);
		console.log(`Successfully completed migration on ${dbName}`);
	} catch (err) {
		console.error(`Migration failed on database ${dbName}:`, err);
		throw err;
	} finally {
		await client.end();
	}
}

async function main() {
	try {
		const rootDir = path.join(import.meta.dirname, "..");

		await runMigration(
			"auth_db",
			path.join(rootDir, "migrations/auth/0001_init.sql"),
		);
		await runMigration(
			"seat_db",
			path.join(rootDir, "migrations/seat/0001_init.sql"),
		);
		await runMigration(
			"payment_db",
			path.join(rootDir, "migrations/payment/0001_init.sql"),
		);

		console.log("All microservices migrations completed successfully!");
	} catch (err) {
		console.error("Migrations execution halted due to errors:", err);
		process.exit(1);
	}
}

main();
