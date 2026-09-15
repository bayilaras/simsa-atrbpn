import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env';
import type { AuthRequest } from './auth.middleware';
import { createRateLimiterStore, usesSharedRateLimits } from '../config/rate-limits.js';
import { createAuthAttemptLimiter } from './auth-attempt-limiter.middleware.js';

const shared = usesSharedRateLimits();

/**
 * Rate Limiter Configuration
 * Protects against brute force attacks and abuse
 * Rate limiting is relaxed in development/test to avoid blocking automated tests.
 */
const isDev = !shared && (env.NODE_ENV === 'development' || env.NODE_ENV === 'test');

// Every deployed instance uses the same database-backed policy counters.
export const generalLimiter = rateLimit({
    store: createRateLimiterStore('general'),
    passOnStoreError: false,
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isDev ? 1000 : 500, // Reasonable in dev; 500 per window in production
    message: {
        error: 'Too Many Requests',
        message: 'Too many requests from this IP, please try again after 15 minutes',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Strict rate limiter for authentication endpoints - 5 attempts per 15 minutes
export const authLimiter = createAuthAttemptLimiter({
    store: createRateLimiterStore('auth'),
    shared,
    maximum: isDev ? 50 : 5,
});

// Rate limiter for signup - 3 attempts per hour
export const signupLimiter = rateLimit({
    store: createRateLimiterStore('signup'),
    passOnStoreError: false,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: isDev ? 50 : 3, // 50 in dev (testable); 3 per hour in production
    message: {
        error: 'Too Many Signups',
        message: 'Too many signup attempts from this IP, please try again after an hour',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter for sensitive operations (e.g., delete, export) - 20 per 15 minutes
export const sensitiveLimiter = rateLimit({
    store: createRateLimiterStore('sensitive'),
    passOnStoreError: false,
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: {
        error: 'Too Many Requests',
        message: 'Too many sensitive operations from this IP, please try again later',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Export rate limiter - 5 exports per minute (prevents data dumping)
export const exportLimiter = rateLimit({
    store: createRateLimiterStore('export'),
    passOnStoreError: false,
    windowMs: 60 * 1000, // 1 minute
    max: 5,
    message: {
        error: 'Too Many Exports',
        message: 'Terlalu banyak permintaan export. Coba lagi setelah 1 menit.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Upload rate limiter - 10 uploads per minute (prevents disk abuse)
export const uploadLimiter = rateLimit({
    store: createRateLimiterStore('upload'),
    passOnStoreError: false,
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: {
        error: 'Too Many Uploads',
        message: 'Terlalu banyak upload. Coba lagi setelah 1 menit.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

export const OCR_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const OCR_RATE_LIMIT_MAX = 3;

// OCR rate limiter - 3 requests per minute (CPU-intensive operation). The
// route authenticates before this middleware, so quota is isolated per user
// rather than shared by every workstation behind the same office NAT.
export const ocrLimiter = rateLimit({
    store: createRateLimiterStore('ocr'),
    passOnStoreError: false,
    windowMs: OCR_RATE_LIMIT_WINDOW_MS,
    max: OCR_RATE_LIMIT_MAX,
    keyGenerator: (req: AuthRequest) => req.user?.id || 'unauthenticated',
    message: {
        error: 'Too Many OCR Requests',
        message: 'Terlalu banyak permintaan OCR. Coba lagi setelah 1 menit.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Keep each bounded Sheets phase at three requests/minute, with independent
// counters so discovery and preview cannot consume the write quota.
function createImportPhaseLimiter(bucket: string, phase: string) { return rateLimit({
    store: createRateLimiterStore(bucket),
    passOnStoreError: false,
    windowMs: 60_000,
    max: 3,
    keyGenerator: (req: AuthRequest) => req.user?.id || 'unauthenticated',
    handler: (req, res) => {
        const resetTime = (req as AuthRequest & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
        const retryAfterSeconds = Math.max(1, Math.ceil(((resetTime?.getTime() ?? Date.now() + 60_000) - Date.now()) / 1000));
        res.setHeader('Retry-After', retryAfterSeconds);
        res.status(429).json({ error: 'Too Many Requests', code: 'RATE_LIMITED', retryAfterSeconds,
            message: `Terlalu banyak permintaan ${phase}. Coba lagi setelah ${retryAfterSeconds} detik.` });
    },
    standardHeaders: true,
    legacyHeaders: false,
}); }

export const importLimiter = createImportPhaseLimiter('import', 'impor');
export const importDiscoveryLimiter = createImportPhaseLimiter('import-discovery', 'daftar sheet');
export const importPreviewLimiter = createImportPhaseLimiter('import-preview', 'pratinjau');
