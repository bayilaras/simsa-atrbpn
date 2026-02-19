import pino from 'pino';
import { env } from '../config/env';

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
 *   logger.debug({ query }, 'SQL query executed');
 */
export const logger = pino({
    level: isProduction ? 'info' : 'debug',
    ...(isProduction
        ? {
            // Production: JSON, no pretty-print, redact sensitive fields
            formatters: {
                level(label: string) {
                    return { level: label };
                },
            },
            redact: {
                paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'token'],
                censor: '[REDACTED]',
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
