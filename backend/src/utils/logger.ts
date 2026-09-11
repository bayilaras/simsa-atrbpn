import pino, { type LoggerOptions } from 'pino';
import { env } from '../config/env';
import { currentRequestId } from './request-context.js';

const isProduction = env.NODE_ENV === 'production';

/**
 * Structured Logger — replaces console.log/error/warn throughout the backend.
 *
 * - Production: JSON output at 'info' level (machine-parseable for log aggregators)
 * - Development: Pretty-printed with colors at 'debug' level
 *
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.info('Server started');
 *   logger.info({ port: 3001 }, 'Server started');
 *   logger.error({ err }, 'Failed to process request');
 *   logger.warn('Deprecation warning');
 *   logger.debug({ event: 'query_completed', durationMs: 18 }, 'Query completed');
 */
export const loggerPrivacyOptions: LoggerOptions = {
    mixin: () => {
        const requestId = currentRequestId();
        return requestId ? { requestId } : {};
    },
    // Local development logs require the same credential protection as deployed
    // logs. Request telemetry itself uses an allowlist and never passes bodies.
    redact: {
        paths: [
            'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
            'req.body', 'req.query', 'password', 'token', 'secret', 'accessToken', 'refreshToken',
            '*.password', '*.token', '*.secret', '*.accessToken', '*.refreshToken',
        ],
        censor: '[REDACTED]',
    },
};

export const logger = pino({
    ...loggerPrivacyOptions,
    level: isProduction ? 'info' : 'debug',
    ...(isProduction
        ? {
            // Production: JSON, no pretty-print, redact sensitive fields
            formatters: {
                level(label: string) {
                    return { level: label };
                },
            },
        }
        : {
            // Development: pretty-printed with colors
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:HH:MM:ss.l',
                    ignore: 'pid,hostname',
                    singleLine: false,
                },
            },
        }),
});

/**
 * Create a child logger with a fixed component name.
 * This makes it easy to filter logs by module.
 *
 * Usage:
 *   const log = createLogger('SuratMasukService');
 *   log.info('Surat masuk created');
 *   // Output: {"level":"info","component":"SuratMasukService","msg":"Surat masuk created"}
 */
export function createLogger(component: string) {
    return logger.child({ component });
}

export default logger;
