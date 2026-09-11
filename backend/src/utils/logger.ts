import pino, { type LoggerOptions } from 'pino';
import { env } from '../config/env';
import { currentRequestId } from './request-context.js';

const isProduction = env.NODE_ENV === 'production';

const SAFE_ERROR_TYPES = new Set([
    'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AggregateError', 'AbortError',
    'AppError', 'ValidationError', 'NotFoundError', 'UnauthorizedError', 'ForbiddenError', 'ConflictError',
    'GoneError', 'PayloadTooLargeError', 'RateLimitError', 'ServiceUnavailableError', 'DatabaseError',
    'DrizzleQueryError', 'ZodError', 'MulterError', 'AxiosError', 'ApiError',
    'BitstreamInspectionError', 'MalwareScannerError',
]);
const SAFE_ERROR_CODES = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
    'ENETUNREACH', 'EHOSTUNREACH', 'EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EMFILE', 'ENFILE',
    'EEXIST', 'EBUSY', 'ABORT_ERR', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_DESTROYED',
    'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    // Common PostgreSQL SQLSTATE values; do not accept arbitrary five-character strings.
    '08000', '08001', '08003', '08004', '08006', '08P01', '22001', '22003', '22007', '22P02',
    '23502', '23503', '23505', '23514', '40001', '40P01', '42501', '42601', '42703', '42P01',
    '53300', '53400', '55P03', '57014', '57P01', '57P02', '57P03', '58030', 'XX000',
    'BASELINE_INVALID', 'LIMITS_INVALID', 'BYTE_LIMIT_EXCEEDED', 'READ_TIMEOUT', 'OBJECT_UNAVAILABLE',
    'connection_failed', 'timeout', 'stream_error', 'size_limit', 'scanner_error', 'protocol_error',
    'EXPORT_LIMIT_EXCEEDED', 'EXPORT_RESULT_CHANGED',
]);

function safeErrorType(value: unknown): string {
    return typeof value === 'string' && SAFE_ERROR_TYPES.has(value) ? value : 'Error';
}

function safeErrorCode(value: unknown): string | number | undefined {
    if (typeof value === 'string' && SAFE_ERROR_CODES.has(value)) return value;
    if (typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599) return value;
    return undefined;
}

function errorField(value: unknown, key: string): unknown {
    if (typeof value !== 'object' || value === null) return undefined;
    try { return (value as Record<string, unknown>)[key]; } catch { return undefined; }
}

function serializeOperationalError(value: unknown) {
    const type = safeErrorType(errorField(value, 'name'));
    let current = value;
    // Drizzle/provider wrappers may keep a useful code in cause. Never copy its
    // message, stack, query parameters, request/response, or provider config.
    for (let depth = 0; depth < 3 && current; depth++) {
        const code = safeErrorCode(errorField(current, 'code'));
        if (code !== undefined) return { type, code };
        current = errorField(current, 'cause');
    }
    return { type };
}

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
    serializers: {
        err: serializeOperationalError,
        error: serializeOperationalError,
        errorType: safeErrorType,
        errorCode: value => safeErrorCode(value) ?? 'UNKNOWN',
    },
    hooks: {
        logMethod(args, method) {
            // Pino otherwise copies error.message into msg before serializers
            // run for log.error(error) and log.error({ err: error }).
            if (args[1] === undefined && (args[0] instanceof Error
                || errorField(args[0], 'err') !== undefined || errorField(args[0], 'error') !== undefined)) {
                return method.call(this, args[0], 'Operation failed');
            }
            return method.apply(this, args);
        },
    },
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
            'errorMessage', '*.errorMessage', 'message', 'stack', 'cause',
        ],
        censor: '[REDACTED]',
    },
};

// Boundary: structured err/error and the listed fields are protected. Explicit
// message strings (msg), arbitrary other fields, and console output still need
// safe event text at their call sites; this is not a general-purpose DLP filter.

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
