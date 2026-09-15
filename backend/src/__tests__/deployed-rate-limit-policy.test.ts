import express from 'express';
import request from 'supertest';
import { getIP } from '@better-auth/core/utils/ip';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/database', () => ({ db: {} }));
// This test inspects the application's options, so keep SDK construction out
// of the fixture. The SDK's real trusted-IP resolver is exercised below.
vi.mock('better-auth', () => ({ betterAuth: (options: unknown) => ({ options }) }));
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: () => ({}) }));
vi.mock('better-auth/api', () => ({
    createAuthMiddleware: (handler: unknown) => handler,
    APIError: class extends Error {},
}));
// Storage atomicity is covered by PostgreSQL suites. Here a fresh MemoryStore
// makes the deployed admission policy observable without a live database.
vi.mock('../config/rate-limits.js', async importOriginal => {
    const { MemoryStore } = await import('express-rate-limit');
    return {
        ...await importOriginal<typeof import('../config/rate-limits.js')>(),
        createRateLimiterStore: () => {
            const store = new MemoryStore();
            return Object.assign(store, {
                async decrementInWindow(key: string, resetTime: Date) {
                    const current = await store.get(key);
                    if (current?.resetTime.getTime() === resetTime.getTime()) await store.decrement(key);
                },
            });
        },
    };
});
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

function deployedDevelopment() {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('AUTH_PROVIDER', 'better-auth');
    vi.stubEnv('BETTER_AUTH_SECRET', 'synthetic-config-secret-at-least-32-characters');
    vi.stubEnv('BETTER_AUTH_URL', 'https://simsa.example.test');
    vi.stubEnv('FRONTEND_URL', 'https://simsa.example.test');
    vi.stubEnv('GOOGLE_OAUTH_ENABLED', 'false');
    vi.resetModules();
}

describe('deployed rate limit policy', () => {
    it('enforces five failed auth attempts even if a deployed runtime says development', async () => {
        deployedDevelopment();
        const { authLimiter } = await import('../middlewares/rate-limiter.middleware.js');
        const app = express();
        app.use('/api/auth', authLimiter);
        app.post('/api/auth/sign-in/email', (_req, res) => res.sendStatus(401));
        for (let i = 0; i < 5; i += 1) await request(app).post('/api/auth/sign-in/email').expect(401);
        await request(app).post('/api/auth/sign-in/email').expect(429);
    });

    it('enables Better Auth admission and uses only the application-normalized IP header', async () => {
        deployedDevelopment();
        const { auth } = await import('../config/auth.js');
        expect(auth.options.rateLimit?.enabled).toBe(true);
        expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
        expect(auth.options.advanced?.useSecureCookies).toBe(true);
        expect(getIP(new Headers({
            'x-simsa-client-ip': '192.0.2.10',
            'x-forwarded-for': '203.0.113.99, 198.51.100.1',
        }), auth.options)).toBe('192.0.2.10');
        expect(auth.options.advanced?.ipAddress?.ipv6Subnet).toBe(56);
    }, 30_000);
});
