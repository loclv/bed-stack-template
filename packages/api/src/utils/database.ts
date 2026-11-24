import { logger } from "./logger";
import { type ApiResponse, ResponseBuilder } from "./response";

export class DatabaseError extends Error {
	constructor(
		message: string,
		public cause?: Error,
	) {
		super(message);
		this.name = "DatabaseError";
	}
}

export class DatabaseWrapper {
	private db: unknown;

	constructor(db: unknown) {
		this.db = db;
	}

	async selectOne<T>(query: unknown): Promise<T | null> {
		try {
			const result = await (query as { get: () => T | null }).get();
			logger.debug("Database selectOne executed", { result: !!result });
			return result || null;
		} catch (error) {
			const dbError = new DatabaseError(
				"Failed to execute select query",
				error as Error,
			);
			logger.error("Database selectOne failed", {
				query: String(query),
				error: dbError,
			});
			throw dbError;
		}
	}

	async selectMany<T>(query: unknown): Promise<T[]> {
		try {
			const result = await (query as { all: () => T[] }).all();
			logger.debug("Database selectMany executed", { count: result.length });
			return result;
		} catch (error) {
			const dbError = new DatabaseError(
				"Failed to execute select query",
				error as Error,
			);
			logger.error("Database selectMany failed", {
				query: String(query),
				error: dbError,
			});
			throw dbError;
		}
	}

	async insert(query: unknown): Promise<unknown> {
		try {
			const result = await (
				query as { returning: () => { get: () => unknown } }
			)
				.returning()
				.get();
			logger.debug("Database insert executed", {
				id: (result as { id?: number })?.id,
			});
			return result;
		} catch (error) {
			const dbError = new DatabaseError(
				"Failed to execute insert query",
				error as Error,
			);
			logger.error("Database insert failed", {
				query: String(query),
				error: dbError,
			});
			throw dbError;
		}
	}

	async update(query: unknown): Promise<boolean> {
		try {
			await (query as { run: () => Promise<void> }).run();
			logger.debug("Database update executed");
			return true;
		} catch (error) {
			const dbError = new DatabaseError(
				"Failed to execute update query",
				error as Error,
			);
			logger.error("Database update failed", {
				query: String(query),
				error: dbError,
			});
			throw dbError;
		}
	}

	async updateAndReturn<T>(query: unknown): Promise<T | null> {
		try {
			const result = await (
				query as { returning: () => { get: () => T | null } }
			)
				.returning()
				.get();
			logger.debug("Database updateAndReturn executed", { result: !!result });
			return result || null;
		} catch (error) {
			const dbError = new DatabaseError(
				"Failed to execute update query",
				error as Error,
			);
			logger.error("Database updateAndReturn failed", {
				updateQuery: String(query),
				error: dbError,
			});
			throw dbError;
		}
	}

	async delete(query: unknown): Promise<boolean> {
		try {
			await (query as { run: () => Promise<void> }).run();
			logger.debug("Database delete executed");
			return true;
		} catch (error) {
			const dbError = new DatabaseError(
				"Failed to execute delete query",
				error as Error,
			);
			logger.error("Database delete failed", {
				query: String(query),
				error: dbError,
			});
			throw dbError;
		}
	}

	async insertAndReturn<T>(query: unknown): Promise<T> {
		try {
			const result = await (query as { returning: () => { get: () => T } })
				.returning()
				.get();
			logger.debug("Database insertAndReturn executed", {
				id: (result as { id?: number })?.id,
			});
			return result;
		} catch (error) {
			const dbError = new DatabaseError(
				"Failed to execute insert query",
				error as Error,
			);
			logger.error("Database insertAndReturn failed", {
				query: String(query),
				error: dbError,
			});
			throw dbError;
		}
	}

	async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
		try {
			const result = await (
				this.db as {
					transaction: (cb: (tx: unknown) => Promise<T>) => Promise<T>;
				}
			).transaction(callback);
			logger.debug("Database transaction completed");
			return result;
		} catch (error) {
			const dbError = new DatabaseError(
				"Failed to execute transaction",
				error as Error,
			);
			logger.error("Database transaction failed", { error: dbError });
			throw dbError;
		}
	}
}

export function handleDatabaseError(error: unknown): ApiResponse {
	if (error instanceof DatabaseError) {
		logger.error("Database operation failed", {
			error: error.message,
			cause: error.cause,
		});
		return ResponseBuilder.internal("Database operation failed");
	}

	logger.error("Unexpected database error", { error });
	return ResponseBuilder.internal("Unexpected database error");
}
