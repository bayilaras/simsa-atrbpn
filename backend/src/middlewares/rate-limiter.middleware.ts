import express, { type Request, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env';
import type { AuthRequest } from './auth.middleware';
import { createRateLimiterStore, usesSharedRateLimits } from '../config/rate-limits.js';
import { createAuthAttemptLimiter } from './auth-attempt-limiter.middleware.js';
import {
    networkRateLimitKey, passwordCheckRateLimitKey, principalRateLimitKey, signInIdentifierKey,
} from './rate-limit-key.js';

const shared = usesSharedRateLimits();

/**
 * Rate Limiter Configuration
 * Protects against brute force attacks and abuse
 * Rate limiting is relaxed in development/test to avoid blocking automated tests.
 */
const isDev = !shared && (env.NODE_ENV === 'development' || env.NODE_ENV === 'test');

export const GENERAL_RATE_LIMIT_MAX = isDev ? 1000 : 500;

// Every deployed instance uses the same database-backed policy counters.
// Each provisioned user has a separate quota, so colleagues behind one office NAT
// do not use up each other's; requests without such a session share the
// network quota.
export const generalLimiter = rateLimit({
    store: createRateLimiterStore('general'),
    passOnStoreError: false,
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: GENERAL_RATE_LIMIT_MAX,
    keyGenerator: principalRateLimitKey,
    message: {
        error: 'Too Many Requests',
        message: 'Terlalu banyak permintaan. Coba lagi setelah 15 menit.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Failed authentication attempts per 15 minutes. Each account has its own
// small budget per network, so one person's typos do not lock colleagues
// behind the same office NAT out; the network ceiling bounds the total.
export const AUTH_FAILED_ATTEMPTS_PER_ACCOUNT = 5;
export const AUTH_FAILED_ATTEMPTS_PER_NETWORK = isDev ? 50 : 30;

// Better Auth routes on the normalized URL (dot segments and backslashes
// resolved). Only paths already in that form are served, so the gates below
// see the same path Better Auth acts on.
const canonicalAuthPath: RequestHandler = (req, res, next) => {
    const requested = req.originalUrl.split('?')[0];
    let canonical: string | undefined;
    try { canonical = new URL(req.originalUrl, 'http://simsa.invalid').pathname; } catch { /* rejected below */ }
    if (canonical !== requested) {
        res.status(404).json({ success: false, error: 'Not Found' });
        return;
    }
    next();
};

const authNetworkLimiter = createAuthAttemptLimiter({
    store: createRateLimiterStore('auth'),
    shared,
    maximum: AUTH_FAILED_ATTEMPTS_PER_NETWORK,
    keyGenerator: networkRateLimitKey,
    message: 'Terlalu banyak percobaan yang gagal dari jaringan ini. Coba lagi setelah 15 menit.',
});

// Failed email sign-ins per network and account. A successful sign-in clears
// that account's earlier failures.
export const authAccountLimiter = createAuthAttemptLimiter({
    store: createRateLimiterStore('auth-account'),
    shared,
    maximum: AUTH_FAILED_ATTEMPTS_PER_ACCOUNT,
    keyGenerator: signInIdentifierKey,
    requestPropertyName: 'authAccountRateLimit',
    resetOnSuccess: true,
});

// Failed current-password checks per network and signed-in user (per network
// without a provisioned session). A successful change proves the current
// password and clears that key's earlier failures.
const passwordCheckLimiter = createAuthAttemptLimiter({
    store: createRateLimiterStore('auth-password'),
    shared,
    maximum: AUTH_FAILED_ATTEMPTS_PER_ACCOUNT,
    keyGenerator: passwordCheckRateLimitKey,
    requestPropertyName: 'authPasswordRateLimit',
    message: 'Terlalu banyak percobaan kata sandi yang gagal. Coba lagi setelah 15 menit.',
    resetOnSuccess: true,
});

// Trailing slashes and letter case never reach a different Better Auth route.
const isPostTo = (req: Request, path: string) =>
    req.method === 'POST' && req.path.replace(/\/+$/, '').toLowerCase() === path;

const readSignInBody = express.text({ type: () => true, limit: '16kb' });

// The account is read from the JSON body before Better Auth runs. When the
// backend reads the request stream itself, the body is buffered as text (at
// most 16 KiB) and Better Auth receives exactly that string. When a hosting
// layer has already parsed the JSON, the limiter and Better Auth both read
// that parsed object. Only JSON is accepted, so either way they read the same
// account; a request without a body goes through unchanged.
const signInAccountGate: RequestHandler = (req, res, next) => {
    if (!isPostTo(req, '/sign-in/email')) return next();
    const declaresBody = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length']) > 0;
    if (!declaresBody) return authAccountLimiter(req, res, next);
    if (!req.is('application/json')) {
        res.status(415).json({ error: 'Unsupported Media Type', message: 'Gunakan application/json.' });
        return;
    }
    readSignInBody(req, res, error => (error ? next(error) : authAccountLimiter(req, res, next)));
};

const changePasswordGate: RequestHandler = (req, res, next) =>
    isPostTo(req, '/change-password') ? passwordCheckLimiter(req, res, next) : next();

// The network limiter wraps the account and password gates, so it also sees
// (and refunds) their 429 responses, with shared and local counters alike.
export const authLimiter: RequestHandler[] = [canonicalAuthPath, authNetworkLimiter, signInAccountGate, changePasswordGate];

// Rate limiter for sensitive operations (e.g., delete, export) - 20 per 15 minutes
// per user (network quota without a provisioned session).
export const sensitiveLimiter = rateLimit({
    store: createRateLimiterStore('sensitive'),
    passOnStoreError: false,
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    keyGenerator: principalRateLimitKey,
    message: {
        error: 'Too Many Requests',
        message: 'Terlalu banyak operasi sensitif. Coba lagi setelah 15 menit.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Export rate limiter - 5 exports per minute per user (prevents data dumping)
export const exportLimiter = rateLimit({
    store: createRateLimiterStore('export'),
    passOnStoreError: false,
    windowMs: 60 * 1000, // 1 minute
    max: 5,
    keyGenerator: principalRateLimitKey,
    message: {
        error: 'Too Many Exports',
        message: 'Terlalu banyak permintaan export. Coba lagi setelah 1 menit.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Upload rate limiter - 10 uploads per minute per user (prevents disk abuse).
// Reading attachment lists is not an upload; a page may load one list per
// archive in parallel, and generalLimiter still bounds those reads.
export const uploadLimiter = rateLimit({
    store: createRateLimiterStore('upload'),
    passOnStoreError: false,
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    keyGenerator: principalRateLimitKey,
    skip: req => req.method === 'GET' || req.method === 'HEAD',
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

export const LACAK_RATE_LIMIT_MAX = 90;

// Lacak Surat dipanggil saat mengetik (debounce 300 ms di klien). Kuota per
// pengguna terautentikasi, tidak per IP, agar satu kantor di balik NAT tidak
// saling menghabiskan. generalLimiter tetap berlaku (tidak di-skip).
export const lacakLimiter = rateLimit({
    store: createRateLimiterStore('lacak'),
    passOnStoreError: false,
    windowMs: 60 * 1000,
    max: LACAK_RATE_LIMIT_MAX,
    keyGenerator: (req: AuthRequest) => req.user?.id || 'unauthenticated',
    message: {
        error: 'Too Many Requests',
        message: 'Terlalu banyak pencarian. Coba lagi setelah 1 menit.',
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
