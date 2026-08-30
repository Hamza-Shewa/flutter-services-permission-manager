/**
 * Structured logging utility for consistent debug output
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
    level: LogLevel;
    message: string;
    context?: Record<string, unknown>;
    timestamp: string;
}

const LOG_PREFIX = '[PermissionManager]';

let debugEnabled = false;

export function enableDebug(): void {
    debugEnabled = true;
}

export function disableDebug(): void {
    debugEnabled = false;
}

function formatEntry(entry: LogEntry): string {
    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    return `${LOG_PREFIX} [${entry.level.toUpperCase()}] ${entry.message}${contextStr}`;
}

function createEntry(level: LogLevel, message: string, context?: Record<string, unknown>): LogEntry {
    return {
        level,
        message,
        context,
        timestamp: new Date().toISOString()
    };
}

export const logger = {
    debug(message: string, context?: Record<string, unknown>): void {
        if (debugEnabled) {
            console.log(formatEntry(createEntry('debug', message, context)));
        }
    },

    info(message: string, context?: Record<string, unknown>): void {
        console.log(formatEntry(createEntry('info', message, context)));
    },

    warn(message: string, context?: Record<string, unknown>): void {
        console.warn(formatEntry(createEntry('warn', message, context)));
    },

    error(message: string, error?: Error, context?: Record<string, unknown>): void {
        const errorContext = error
            ? { ...context, errorMessage: error.message, errorStack: error.stack }
            : context;
        console.error(formatEntry(createEntry('error', message, errorContext)));
    }
};
