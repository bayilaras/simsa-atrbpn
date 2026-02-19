import { Request, Response, NextFunction } from 'express';

/**
 * Input Sanitization Middleware
 *
 * Strips HTML tags and encodes dangerous characters from all string
 * values in req.body to prevent stored XSS attacks.
 *
 * Skipped fields: extractedText (OCR output may contain formatting)
 */

const SKIP_FIELDS = new Set(['extractedText', 'password', 'currentPassword', 'newPassword']);

/**
 * Encode HTML entities to prevent XSS
 */
function encodeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

/**
 * Strip HTML tags from a string
 */
function stripTags(str: string): string {
    return str.replace(/<[^>]*>/g, '');
}

/**
 * Recursively sanitize all string values in an object
 */
function sanitizeValue(value: any, key?: string): any {
    // Skip whitelisted fields
    if (key && SKIP_FIELDS.has(key)) {
        return value;
    }

    if (typeof value === 'string') {
        // Strip HTML tags first, then encode remaining entities
        let sanitized = stripTags(value);
        // Trim excessive whitespace
        sanitized = sanitized.replace(/\s+/g, ' ').trim();
        return sanitized;
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item));
    }

    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        const sanitized: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
            sanitized[k] = sanitizeValue(v, k);
        }
        return sanitized;
    }

    return value;
}

/**
 * Express middleware to sanitize request body
 */
export function sanitizeInput(req: Request, res: Response, next: NextFunction): void {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeValue(req.body);
    }
    next();
}
