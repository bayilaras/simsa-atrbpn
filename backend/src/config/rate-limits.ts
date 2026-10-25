import { PostgresRateLimitStore } from '../services/postgres-rate-limit.store.js';

export function usesSharedRateLimits(source: NodeJS.ProcessEnv = process.env): boolean {
    return source.NODE_ENV === 'production' || Boolean(source.VERCEL) || Boolean(source.K_SERVICE);
}

export function createRateLimiterStore(bucket: string, source: NodeJS.ProcessEnv = process.env) {
    if (!usesSharedRateLimits(source)) return undefined;
    const provider = source.AUTH_PROVIDER?.trim().toLowerCase() || 'better-auth';
    const secret = source.RATE_LIMIT_KEY_SECRET
        || (provider === 'firebase' ? source.FIREBASE_SESSION_CSRF_SECRET : source.BETTER_AUTH_SECRET)
        || '';
    if (secret !== secret.trim() || /[\r\n]/.test(secret)) {
        throw new Error('Shared rate limits require a stable secret without surrounding whitespace or line breaks.');
    }
    return new PostgresRateLimitStore(bucket, secret);
}
