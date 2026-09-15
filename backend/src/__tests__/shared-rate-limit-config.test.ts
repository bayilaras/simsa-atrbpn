import { describe, expect, it } from 'vitest';
import { createRateLimiterStore, usesSharedRateLimits } from '../config/rate-limits.js';
import { PostgresRateLimitStore } from '../services/postgres-rate-limit.store.js';

describe('shared rate limit runtime selection', () => {
    it.each([{ NODE_ENV: 'production' }, { VERCEL: '1' }, { K_SERVICE: 'simsa-api' }])(
        'requires a shared store in every deployed runtime', source => {
            expect(usesSharedRateLimits(source)).toBe(true);
            expect(createRateLimiterStore('auth', { ...source, BETTER_AUTH_SECRET: 'synthetic-test-secret-'.repeat(3) }))
                .toBeInstanceOf(PostgresRateLimitStore);
        },
    );
    it('keeps isolated tests/local development independent of a live database', () => {
        expect(createRateLimiterStore('auth', { NODE_ENV: 'test' })).toBeUndefined();
        expect(createRateLimiterStore('auth', { NODE_ENV: 'development' })).toBeUndefined();
    });
    it('uses a distinct namespace for each policy and rejects a short explicit hash key', () => {
        const source = { NODE_ENV: 'production', RATE_LIMIT_KEY_SECRET: 'synthetic-key-'.repeat(4) };
        expect(createRateLimiterStore('auth', source)?.prefix).not.toBe(createRateLimiterStore('import', source)?.prefix);
        expect(() => createRateLimiterStore('auth', { ...source, RATE_LIMIT_KEY_SECRET: 'short' })).toThrow(/stable secret/);
    });
    it('never falls back to an imported development secret or another auth provider', () => {
        expect(() => createRateLimiterStore('auth', { NODE_ENV: 'production', AUTH_PROVIDER: 'firebase' })).toThrow(/stable secret/);
        expect(() => createRateLimiterStore('auth', { NODE_ENV: 'production', AUTH_PROVIDER: 'firebase', BETTER_AUTH_SECRET: 'x'.repeat(48) })).toThrow(/stable secret/);
        expect(() => createRateLimiterStore('auth', { NODE_ENV: 'production', AUTH_PROVIDER: 'better-auth' })).toThrow(/stable secret/);
        expect(createRateLimiterStore('auth', { NODE_ENV: 'production', AUTH_PROVIDER: 'firebase', FIREBASE_SESSION_CSRF_SECRET: 'x'.repeat(48) })).toBeInstanceOf(PostgresRateLimitStore);
    });
});
