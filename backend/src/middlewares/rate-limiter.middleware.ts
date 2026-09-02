import * as rateLimitModule from 'express-rate-limit';
const rateLimit = (rateLimitModule as any).default || rateLimitModule;
import { env } from '../config/env';
import type { AuthRequest } from './auth.middleware';

/**
 * Rate Limiter Configuration
 * Protects against brute force attacks and abuse
 * Rate limiting is relaxed in development/test to avoid blocking automated tests.
 */
const isDev = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

// General API rate limiter - 100 requests per 15 minutes
export const generalLimiter = rateLimit({
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
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isDev ? 50 : 5, // 50 in dev (testable); 5 per window in production
    message: {
        error: 'Too Many Attempts',
        message: 'Too many login attempts from this IP, please try again after 15 minutes',
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Don't count successful logins
});

// Rate limiter for signup - 3 attempts per hour
export const signupLimiter = rateLimit({
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
