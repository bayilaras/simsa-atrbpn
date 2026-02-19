import { Response } from 'express';

/**
 * Standard API Response Helpers
 *
 * Envelope pattern:
 *   Success: { success: true, data, message?, pagination? }
 *   Error:   { success: false, error, message?, details? }
 *
 * Usage in routes:
 *   import { sendSuccess, sendCreated, sendPaginated, sendError, sendNotFound } from '../utils/response';
 *
 *   // Instead of: res.json({ success: true, data: result })
 *   sendSuccess(res, result);
 *
 *   // Instead of: res.status(201).json({ success: true, data: result })
 *   sendCreated(res, result);
 *
 *   // Instead of: res.status(404).json({ error: 'Not found' })
 *   sendNotFound(res, 'Surat masuk');
 */

/** Standard success response — 200 OK */
export function sendSuccess<T>(res: Response, data: T, message?: string) {
    const body: Record<string, unknown> = { success: true, data };
    if (message) body.message = message;
    return res.json(body);
}

/** Created response — 201 Created */
export function sendCreated<T>(res: Response, data: T, message?: string) {
    const body: Record<string, unknown> = { success: true, data };
    if (message) body.message = message;
    return res.status(201).json(body);
}

/** Paginated success response — 200 OK */
export function sendPaginated<T>(
    res: Response,
    data: T[],
    pagination: { page: number; limit: number; total: number; totalPages: number },
) {
    return res.json({ success: true, data, pagination });
}

/** Error response with a specific HTTP status */
export function sendError(
    res: Response,
    statusCode: number,
    error: string,
    details?: unknown,
) {
    const body: Record<string, unknown> = { success: false, error };
    if (details) body.details = details;
    return res.status(statusCode).json(body);
}

/** 400 Bad Request */
export function sendBadRequest(res: Response, message: string, details?: unknown) {
    return sendError(res, 400, message, details);
}

/** 404 Not Found — resource-aware message */
export function sendNotFound(res: Response, resourceName = 'Resource') {
    return sendError(res, 404, `${resourceName} tidak ditemukan`);
}

/** 409 Conflict */
export function sendConflict(res: Response, message: string) {
    return sendError(res, 409, message);
}

/** 422 Validation Error with field-level details */
export function sendValidationError(
    res: Response,
    details: Array<{ field: string; message: string }>,
) {
    return sendError(res, 400, 'Validasi gagal', details);
}
