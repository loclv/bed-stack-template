/**
 * Structured JSON logger with correlation ID support.
 * Outputs one JSON object per line for log aggregation systems.
 */

export enum LogLevel {
	ERROR = 0,
	WARN = 1,
	INFO = 2,
	DEBUG = 3,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
	[LogLevel.ERROR]: "error",
	[LogLevel.WARN]: "warn",
	[LogLevel.INFO]: "info",
	[LogLevel.DEBUG]: "debug",
};

interface LogContext {
	[key: string]: unknown;
}

interface LogEntry {
	level: string;
	message: string;
	service: string;
	timestamp: string;
	traceId?: string;
	[key: string]: unknown;
}

/**
 * Parse log level string to enum value.
 */
function parseLogLevel(level: string): LogLevel {
	switch (level.toLowerCase()) {
		case "error":
			return LogLevel.ERROR;
		case "warn":
			return LogLevel.WARN;
		case "info":
			return LogLevel.INFO;
		case "debug":
			return LogLevel.DEBUG;
		default:
			return LogLevel.INFO;
	}
}

export class Logger {
	private level: LogLevel;
	private serviceName: string;

	constructor(serviceName: string, level?: string) {
		this.serviceName = serviceName;
		this.level = parseLogLevel(level || process.env.LOG_LEVEL || "info");
	}

	/**
	 * Write a structured JSON log entry to stdout/stderr.
	 */
	private log(level: LogLevel, message: string, context?: LogContext): void {
		if (level > this.level) return;

		const entry: LogEntry = {
			level: LOG_LEVEL_NAMES[level] || "info",
			message,
			service: this.serviceName,
			timestamp: new Date().toISOString(),
			...context,
		};

		// Extract error for stack trace
		if (context?.error instanceof Error) {
			entry.errorMessage = context.error.message;
			entry.errorStack = context.error.stack;
			delete entry.error;
		}

		const line = JSON.stringify(entry);

		if (level <= LogLevel.WARN) {
			process.stderr.write(`${line}\n`);
		} else {
			process.stdout.write(`${line}\n`);
		}
	}

	/**
	 * Log an error-level message.
	 */
	error(message: string, context?: LogContext): void {
		this.log(LogLevel.ERROR, message, context);
	}

	/**
	 * Log a warning-level message.
	 */
	warn(message: string, context?: LogContext): void {
		this.log(LogLevel.WARN, message, context);
	}

	/**
	 * Log an info-level message.
	 */
	info(message: string, context?: LogContext): void {
		this.log(LogLevel.INFO, message, context);
	}

	/**
	 * Log a debug-level message.
	 */
	debug(message: string, context?: LogContext): void {
		this.log(LogLevel.DEBUG, message, context);
	}

	/**
	 * Create a child logger with additional default context.
	 */
	child(defaultContext: LogContext): Logger {
		const child = new Logger(this.serviceName);
		child.level = this.level;
		const parentLog = this.log.bind(this);
		child.log = (level: LogLevel, message: string, context?: LogContext) => {
			parentLog(level, message, { ...defaultContext, ...context });
		};
		return child;
	}
}

/**
 * Create a logger instance for a specific service.
 */
export function createLogger(serviceName: string): Logger {
	return new Logger(serviceName);
}
