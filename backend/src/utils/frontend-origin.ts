import { env } from '../config/env.js';

/** Public navigation links must never derive their authority from request headers. */
export function getFrontendOrigin(): string {
    let configured: URL;
    try {
        configured = new URL(env.FRONTEND_URL);
    } catch {
        throw new Error('FRONTEND_URL must be a valid absolute URL');
    }
    if (
        !['http:', 'https:'].includes(configured.protocol)
        || configured.username
        || configured.password
        || configured.search
        || configured.hash
        || configured.pathname !== '/'
    ) {
        throw new Error('FRONTEND_URL must be an HTTP(S) origin without credentials, path, query, or fragment');
    }
    // Match startup validation, and fail closed if a misconfigured route is
    // exercised without application startup (for example an isolated handler).
    const deployed = env.NODE_ENV === 'production' || Boolean(env.VERCEL_ENV) || Boolean(process.env.K_SERVICE);
    if (deployed && configured.protocol !== 'https:') {
        throw new Error('FRONTEND_URL must use HTTPS in a deployed runtime');
    }
    return configured.origin;
}
