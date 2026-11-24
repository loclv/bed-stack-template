/**
 * Graceful shutdown handler for SIGTERM/SIGINT.
 * Stops accepting new requests, drains in-flight, disconnects deps.
 */

import { createLogger } from "./logger";

const logger = createLogger("shutdown");

type ShutdownHook = () => Promise<void>;

const hooks: ShutdownHook[] = [];
let shutdownInProgress = false;

/**
 * Register a cleanup function to run during graceful shutdown.
 * Hooks run in reverse registration order (LIFO).
 */
export function onShutdown(hook: ShutdownHook): void {
	hooks.push(hook);
}

/**
 * Execute all shutdown hooks and exit the process.
 */
async function executeShutdown(signal: string): Promise<void> {
	if (shutdownInProgress) return;
	shutdownInProgress = true;

	logger.info(`Received ${signal}. Starting graceful shutdown...`, { signal });

	// Run hooks in reverse order (last registered = first cleaned up)
	for (let i = hooks.length - 1; i >= 0; i--) {
		try {
			await hooks[i]?.();
		} catch (err) {
			logger.error("Shutdown hook failed", { error: err as Error, index: i });
		}
	}

	logger.info("Graceful shutdown complete. Exiting.");
	process.exit(0);
}

/**
 * Install SIGTERM and SIGINT handlers for graceful shutdown.
 * Call this once at service startup.
 */
export function installShutdownHandlers(): void {
	process.on("SIGTERM", () => executeShutdown("SIGTERM"));
	process.on("SIGINT", () => executeShutdown("SIGINT"));
	logger.info("Shutdown handlers installed (SIGTERM, SIGINT)");
}
