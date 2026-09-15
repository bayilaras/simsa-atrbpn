import type { Request, RequestHandler } from 'express';
import { rateLimit, type RateLimitInfo } from 'express-rate-limit';
import { waitUntil } from '@vercel/functions';
import type { PostgresRateLimitStore } from '../services/postgres-rate-limit.store.js';
import { logger } from '../utils/logger.js';
import { ServiceUnavailableError } from '../utils/errors.js';

function reportRefundFailure() {
    try { logger.warn({ event: 'auth_rate_limit_refund_failed' }, 'Authentication quota refund did not complete'); }
    catch { /* Keep the request counted if even telemetry is unavailable. */ }
}

/** Count failed attempts; success or downstream admission rejection refunds only its own window. */
export function createAuthAttemptLimiter({ store, shared, maximum }: {
    store?: PostgresRateLimitStore; shared: boolean; maximum: number;
}) {
    const limiter = rateLimit({
        store, passOnStoreError: false, windowMs: 15 * 60 * 1000, max: maximum,
        requestPropertyName: 'authRateLimit',
        message: { error: 'Too Many Attempts', message: 'Too many login attempts from this IP, please try again after 15 minutes' },
        standardHeaders: true, legacyHeaders: false,
        skip: req => shared && (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/sign-out'),
        skipSuccessfulRequests: !shared,
        handler: async (req, res, next, options) => {
            try {
                if (shared) {
                    const info = (req as Request & { authRateLimit?: RateLimitInfo }).authRateLimit;
                    // A saturated PostgreSQL integer may not represent a new
                    // reservation. Keep that counter closed rather than refund
                    // a hit this request did not add.
                    if (!store || !info?.resetTime || info.used >= 2_147_483_647) {
                        throw new ServiceUnavailableError();
                    }
                    const key = info.key;
                    const resetTime = new Date(info.resetTime.getTime());
                    // This request never reached authentication. Return only
                    // its reservation, even when admitted successes finish at
                    // the same time. Wait before sending 429 so serverless
                    // suspension cannot leave a false failed-attempt count.
                    const refund = store.decrementInWindow(key, resetTime);
                    if (process.env.VERCEL === '1') {
                        // A disconnected caller can end the request context
                        // before the database completes this awaited refund.
                        try { waitUntil(refund.catch(() => {})); } catch { reportRefundFailure(); }
                    }
                    await refund;
                }
                if (!res.writableEnded) res.status(options.statusCode).send(options.message);
            } catch (error) {
                // express-rate-limit does not await a custom handler promise.
                // Forward explicitly and retain the count if the refund failed.
                next(error);
            }
        },
    });
    const wrapper: RequestHandler = (req, res, next) => limiter(req, res, error => {
        if (error) return next(error);
        const info = (req as Request & { authRateLimit?: RateLimitInfo }).authRateLimit;
        if (shared && store && info?.resetTime) {
            // Copy before downstream middleware can overwrite request metadata.
            const key = info.key;
            const resetTime = new Date(info.resetTime.getTime());
            const work = new Promise<boolean>(resolve => {
                const finish = () => { res.off('close', close); resolve(true); };
                const close = () => { res.off('finish', finish); resolve(false); };
                res.once('finish', finish);
                res.once('close', close);
            }).then(async finished => {
                // Better Auth's shorter burst limiter may reject with 429
                // before checking credentials. It must keep its own quota,
                // without turning the rejection into a 15-minute login failure.
                if (finished && ((res.statusCode >= 200 && res.statusCode < 400) || res.statusCode === 429)) {
                    await store.decrementInWindow(key, resetTime);
                }
            }).catch(reportRefundFailure);
            // Register while the originating request context is still active;
            // Vercel must keep the refund alive after the response is committed.
            if (process.env.VERCEL === '1') {
                try { waitUntil(work); } catch { reportRefundFailure(); }
            }
        }
        next();
    });
    return Object.assign(wrapper, { resetKey: limiter.resetKey, getKey: limiter.getKey });
}
