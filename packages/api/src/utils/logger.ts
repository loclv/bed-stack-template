export enum LogLevel {
	ERROR = "error",
	WARN = "warn",
	INFO = "info",
	DEBUG = "debug",
}

export interface LogEntry {
	level: LogLevel;
	message: string;
	timestamp: string;
	context?: Record<string, unknown>;
	error?: Error;
}

class Logger {
	private logLevel: LogLevel;

	constructor() {
		this.logLevel = (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO;
	}

	private shouldLog(level: LogLevel): boolean {
		const levels = [
			LogLevel.ERROR,
			LogLevel.WARN,
			LogLevel.INFO,
			LogLevel.DEBUG,
		];
		return levels.indexOf(level) <= levels.indexOf(this.logLevel);
	}

	private formatMessage(entry: LogEntry): string {
		const { level, message, timestamp, context, error } = entry;
		let logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;

		if (context) {
			logMessage += ` | Context: ${JSON.stringify(context)}`;
		}

		if (error) {
			logMessage += ` | Error: ${error.message}`;
			if (error.stack) {
				logMessage += `\nStack: ${error.stack}`;
			}
		}

		return logMessage;
	}

	private writeLog(entry: LogEntry): void {
		if (!this.shouldLog(entry.level)) return;

		const formattedMessage = this.formatMessage(entry);

		switch (entry.level) {
			case LogLevel.ERROR:
				console.error(formattedMessage);
				break;
			case LogLevel.WARN:
				console.warn(formattedMessage);
				break;
			case LogLevel.INFO:
				console.info(formattedMessage);
				break;
			case LogLevel.DEBUG:
				console.debug(formattedMessage);
				break;
		}
	}

	error(message: string, context?: Record<string, unknown>): void {
		const extracted =
			context?.error instanceof Error ? context.error : undefined;
		this.writeLog({
			level: LogLevel.ERROR,
			message,
			timestamp: new Date().toISOString(),
			context,
			error: extracted,
		});
	}

	warn(message: string, context?: Record<string, unknown>): void {
		this.writeLog({
			level: LogLevel.WARN,
			message,
			timestamp: new Date().toISOString(),
			context,
		});
	}

	info(message: string, context?: Record<string, unknown>): void {
		this.writeLog({
			level: LogLevel.INFO,
			message,
			timestamp: new Date().toISOString(),
			context,
		});
	}

	debug(message: string, context?: Record<string, unknown>): void {
		this.writeLog({
			level: LogLevel.DEBUG,
			message,
			timestamp: new Date().toISOString(),
			context,
		});
	}
}

export const logger = new Logger();
