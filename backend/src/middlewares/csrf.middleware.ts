import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * CSRF Protection Middleware — Double-Submit Cookie Pattern
 *
 * How it works:
 * 1. On every response, server sets a `csrf-token` cookie with a random token
 * 2. For state-changing requests (POST/PUT/PATCH/DELETE), client must send the
 *    same token value in the `X-CSRF-Token` header
 * 3. Since an attacker cannot read cross-origin cookies, they cannot reproduce
 *    the header value, blocking CSRF attacks
 *
 * Skipped for:
 * - GET, HEAD, OPTIONS requests (safe methods)
 * - Better Auth routes (has own CSRF protection)
 * - Multipart/form-data with file uploads (token checked via cookie only)
 */

const CSRF_COOKIE_NAME = 'csrf-token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// Generate a cryptographically random token
function generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Middleware that sets a CSRF cookie on every response.
 * Must be applied early in the middleware chain.
 */
export function csrfCookieSetter(req: Request, res: Response, next: NextFunction): void {
    // Only set cookie if it doesn't already exist
    if (!req.cookies?.[CSRF_COOKIE_NAME]) {
        const token = generateToken();
        res.cookie(CSRF_COOKIE_NAME, token, {
            httpOnly: false,   // Must be readable by JavaScript
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
            partitioned: process.env.NODE_ENV === 'production', // Required for cross-domain cookies
            path: '/',
            maxAge: 8 * 60 * 60 * 1000, // 8 hours — tighter security for CSRF tokens
        } as any);
    }
    next();
}

/**
 * Middleware that validates CSRF token on state-changing requests.
 * The token in the X-CSRF-Token header must match the csrf-token cookie.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
    // Skip safe methods
    if (SAFE_METHODS.includes(req.method)) {
        return next();
    }

    // Skip Better Auth routes (handled internally by Better Auth)
    // Middleware is mounted at /api, so path is relative to /api
    if (req.path.startsWith('/auth')) {
        return next();
    }

    // Skip dev routes in development mode (dev-login, etc.)
    if (req.path.startsWith('/dev') && process.env.NODE_ENV !== 'production') {
        return next();
    }

    // Skip client-upload route — @vercel/blob/client's upload() makes its own POST
    // request without the X-CSRF-Token header. This route is already protected by
    // authMiddleware and rate limiting.
    if (req.path.startsWith('/client-upload')) {
        return next();
    }

    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
    const headerToken = req.headers[CSRF_HEADER_NAME] as string;

    if (!cookieToken || !headerToken) {
        res.status(403).json({
            error: 'CSRF Validation Failed',
            message: 'Missing CSRF token. Please refresh the page and try again.',
        });
        return;
    }

    // Timing-safe comparison to prevent timing attacks
    if (cookieToken.length !== headerToken.length) {
        res.status(403).json({
            error: 'CSRF Validation Failed',
            message: 'Invalid CSRF token. Please refresh the page and try again.',
        });
        return;
    }

    const valid = crypto.timingSafeEqual(
        Buffer.from(cookieToken),
        Buffer.from(headerToken)
    );

    if (!valid) {
        res.status(403).json({
            error: 'CSRF Validation Failed',
            message: 'Invalid CSRF token. Please refresh the page and try again.',
        });
        return;
    }

    next();
}
