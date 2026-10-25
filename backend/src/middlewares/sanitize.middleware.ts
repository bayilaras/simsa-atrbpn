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

/** Bidang catatan/instruksi: tag tetap dibuang, baris baru dipertahankan (§5). */
export const MULTILINE_FIELDS: ReadonlySet<string> = new Set([
    'instruction', 'instruksi', 'catatan', 'catatanPenyelesaian', 'alasan', 'keterangan',
]);

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

/** Rapikan spasi per baris, pertahankan baris baru, maksimal satu baris kosong berturut-turut. */
function normalizeMultiline(value: string): string {
    return value
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Normalisasi bidang satu baris yang dipakai sanitizer JSON: buang tag, rapatkan
 * spasi, trim. Diekspor agar pembanding nilai lama (guard rangkaian, F-I1) memakai
 * normalisasi yang sama dengan jalur tulis.
 */
export function sanitizeSatuBaris(value: string): string {
    return stripTags(value).replace(/\s+/g, ' ').trim();
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
        // Strip HTML tags first; multi-line fields keep their line breaks (§5).
        return key && MULTILINE_FIELDS.has(key)
            ? normalizeMultiline(stripTags(value))
            : sanitizeSatuBaris(value);
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
