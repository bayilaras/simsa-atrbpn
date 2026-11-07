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
// Session verification is covered by rate-limit-key.test.ts. Each synthetic
// session token here names one provisioned user behind the same office IP.
vi.mock('../services/request-identity.service.js', () => ({
    verifyRequestIdentity: async (req: { headers: { cookie?: string } }) => {
        const subject = /better-auth\.session_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
        return subject ? { subject, role: 'staff', unitKerjaId: 'unit-a', isActive: true } : null;
    },
}));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

const asUser = (call: request.Test, user?: string) => user ? call.set('Cookie', `better-auth.session_token=${user}`) : call;

async function repeat(times: number, send: () => request.Test, status: number) {
    for (let i = 0; i < times; i += 1) await send().expect(status);
}

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

    it('keeps a separate general quota for each provisioned user behind one office IP', async () => {
        deployedDevelopment();
        const { generalLimiter, GENERAL_RATE_LIMIT_MAX } = await import('../middlewares/rate-limiter.middleware.js');
        expect(GENERAL_RATE_LIMIT_MAX).toBe(500);
        const app = express();
        app.use('/api', generalLimiter);
        app.get('/api/ping', (_req, res) => res.sendStatus(200));
        const server = app.listen(0);
        try {
            const ping = (user?: string) => asUser(request(server).get('/api/ping'), user);
            for (let sent = 0; sent < GENERAL_RATE_LIMIT_MAX; sent += 50) {
                await Promise.all(Array.from({ length: 50 }, () => ping('staff-a').expect(200)));
            }
            const limited = await ping('staff-a').expect(429);
            expect(limited.body).toEqual({
                error: 'Too Many Requests',
                message: 'Terlalu banyak permintaan. Coba lagi setelah 15 menit.',
            });
            const colleague = await ping('staff-b').expect(200);
            expect(colleague.headers['ratelimit-remaining']).toBe(String(GENERAL_RATE_LIMIT_MAX - 1));
            const anonymous = await ping().expect(200);
            expect(anonymous.headers['ratelimit-remaining']).toBe(String(GENERAL_RATE_LIMIT_MAX - 1));
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    }, 30_000);

    it('keeps sensitive and export quotas per user behind one office IP', async () => {
        deployedDevelopment();
        const { sensitiveLimiter, exportLimiter } = await import('../middlewares/rate-limiter.middleware.js');
        const app = express();
        app.post('/api/users', sensitiveLimiter, (_req, res) => res.sendStatus(200));
        app.get('/api/export/arsip', exportLimiter, (_req, res) => res.sendStatus(200));
        const sensitive = (user?: string) => asUser(request(app).post('/api/users'), user);
        const exported = (user?: string) => asUser(request(app).get('/api/export/arsip'), user);

        await repeat(20, () => sensitive('staff-a'), 200);
        const limited = await sensitive('staff-a').expect(429);
        expect(limited.body.message).toBe('Terlalu banyak operasi sensitif. Coba lagi setelah 15 menit.');
        await sensitive('staff-b').expect(200);
        await sensitive().expect(200);

        await repeat(5, () => exported('staff-a'), 200);
        const exportLimited = await exported('staff-a').expect(429);
        expect(exportLimited.body.message).toBe('Terlalu banyak permintaan export. Coba lagi setelah 1 menit.');
        await exported('staff-b').expect(200);
        await exported().expect(200);
    });

    it('does not count attachment reads against the per-user upload quota', async () => {
        deployedDevelopment();
        const { uploadLimiter } = await import('../middlewares/rate-limiter.middleware.js');
        const app = express();
        app.use('/api/upload', uploadLimiter);
        app.get('/api/upload/:suratType/:suratId', (_req, res) => res.json({ data: [] }));
        app.post('/api/upload/:suratType/:suratId', (_req, res) => res.sendStatus(201));
        const path = '/api/upload/arsip/00000000-0000-4000-8000-000000000001';

        // One retention review page lists attachments for every selected archive.
        const reads = await Promise.all(Array.from({ length: 12 }, () => asUser(request(app).get(path), 'staff-a')));
        expect(reads.map(response => response.status)).toEqual(Array(12).fill(200));
        await asUser(request(app).head(path), 'staff-a').expect(200);

        await repeat(10, () => asUser(request(app).post(path), 'staff-a'), 201);
        const limited = await asUser(request(app).post(path), 'staff-a').expect(429);
        expect(limited.body.message).toBe('Terlalu banyak upload. Coba lagi setelah 1 menit.');
        await asUser(request(app).get(path), 'staff-a').expect(200);
        await asUser(request(app).post(path), 'staff-b').expect(201);
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
