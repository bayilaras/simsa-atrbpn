import { AppError, CatalogNotReadyError } from './errors.js';

const codes: Record<number, string> = {
    400: 'VALIDATION_ERROR', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
    404: 'NOT_FOUND', 409: 'CONFLICT', 410: 'GONE', 413: 'PAYLOAD_TOO_LARGE',
    429: 'RATE_LIMITED', 500: 'INTERNAL_ERROR', 501: 'NOT_IMPLEMENTED',
    502: 'UPSTREAM_UNAVAILABLE', 503: 'SERVICE_UNAVAILABLE', 504: 'UPSTREAM_TIMEOUT',
};

export function publicErrorStatus(error: unknown): number {
    return error instanceof AppError && error.isOperational
        && Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode : 500;
}

/** Only explicitly classified client errors may carry a domain message. */
export function publicErrorResponse(error: unknown, requestId?: string) {
    const status = publicErrorStatus(error);
    if (error instanceof CatalogNotReadyError && status === 503) {
        return {
            success: false as const,
            error: error.name,
            message: error.message,
            code: 'CATALOG_NOT_READY',
            ...(requestId ? { requestId } : {}),
        };
    }
    const clientError = error instanceof AppError && status < 500;
    return {
        success: false as const,
        error: clientError ? error.name : status === 503 ? 'Service Unavailable' : 'Internal Server Error',
        message: clientError ? error.message : status === 503
            ? 'Layanan sementara tidak tersedia. Silakan coba lagi.'
            : status === 501 ? 'Fitur ini belum tersedia.' : 'Terjadi kesalahan pada server.',
        code: codes[status] || (status < 500 ? 'REQUEST_REJECTED' : 'INTERNAL_ERROR'),
        ...(requestId ? { requestId } : {}),
    };
}
