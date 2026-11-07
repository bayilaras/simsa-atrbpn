import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import type { MemoryStore } from 'express-rate-limit';
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
const stores = vi.hoisted(() => new Map<string, MemoryStore>());
vi.mock('../config/rate-limits.js', async importOriginal => {
    const { MemoryStore } = await import('express-rate-limit');
    return {
        ...await importOriginal<typeof import('../config/rate-limits.js')>(),
        createRateLimiterStore: (bucket: string) => {
            const store = new MemoryStore();
            stores.set(bucket, store);
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

const OFFICE_IP = '198.51.100.7';
const OTHER_IP = '203.0.113.20';
const OFFICE_NETWORK = `ip:${OFFICE_IP}`;
const ACCOUNT_MESSAGE = 'Terlalu banyak percobaan masuk yang gagal. Coba lagi setelah 15 menit.';

// Stands in for Better Auth: 'benar' is the correct password of every account.
const signInOutcome: express.RequestHandler = (req, res) => {
    const { password } = JSON.parse(typeof req.body === 'string' && req.body ? req.body : '{}');
    res.sendStatus(password === 'benar' ? 200 : 401);
};

/** The deployed auth limiter chain in front of a stand-in auth handler. */
async function authApp(signIn: express.RequestHandler = signInOutcome) {
    deployedDevelopment();
    const limits = await import('../middlewares/rate-limiter.middleware.js');
    const reached = vi.fn();
    const app = express();
    // Simulates distinct client networks without relying on proxy headers.
    app.use((req, _res, next) => {
        Object.defineProperty(req, 'ip', { value: req.header('x-test-ip') ?? OFFICE_IP, configurable: true });
        next();
    });
    app.use('/api/auth', limits.authLimiter);
    app.post('/api/auth/sign-in/email', signIn);
    app.post('/api/auth/change-password', (req, res) => res.sendStatus(req.header('x-test-result') === 'ok' ? 200 : 400));
    app.all('/api/auth/*splat', (_req, res) => { reached(); res.sendStatus(200); });
    app.use((error: { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(error.status ?? 500).json({ type: error.type });
    });
    const signInAs = (email: string, password = 'salah', ip = OFFICE_IP) => request(app).post('/api/auth/sign-in/email')
        .set('x-test-ip', ip).set('Content-Type', 'application/json').send(JSON.stringify({ email, password }));
    return { app, limits, reached, signInAs };
}

/** Wait for the refunds the limiters handed to waitUntil. */
async function settleRefunds() {
    const { waitUntil } = await import('@vercel/functions');
    await Promise.all(vi.mocked(waitUntil).mock.calls.map(([work]) => work));
}

async function hits(bucket: string, key: string) {
    return (await stores.get(bucket)!.get(key))?.totalHits ?? 0;
}

/** Sends the path exactly as given; HTTP clients would resolve dot segments first. */
async function rawPost(app: express.Express, path: string, body: string) {
    const server = app.listen(0);
    try {
        await new Promise(resolve => server.once('listening', resolve));
        const { port } = server.address() as AddressInfo;
        return await new Promise<number>((resolve, reject) => {
            const call = http.request({
                host: '127.0.0.1', port, method: 'POST', path,
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            }, response => {
                response.resume();
                response.on('end', () => resolve(response.statusCode ?? 0));
            });
            call.on('error', reject);
            call.end(body);
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

describe('deployed rate limit policy', { timeout: 30_000 }, () => {
    it('enforces five failed auth attempts even if a deployed runtime says development', async () => {
        deployedDevelopment();
        const { authLimiter } = await import('../middlewares/rate-limiter.middleware.js');
        const app = express();
        app.use('/api/auth', authLimiter);
        app.post('/api/auth/sign-in/email', (_req, res) => res.sendStatus(401));
        for (let i = 0; i < 5; i += 1) await request(app).post('/api/auth/sign-in/email').expect(401);
        await request(app).post('/api/auth/sign-in/email').expect(429);
    });

    it('limits failed sign-ins per account so colleagues on the same network can still sign in', async () => {
        const { signInAs } = await authApp();
        await repeat(5, () => signInAs('a@x.test'), 401);
        const locked = await signInAs('a@x.test').expect(429);
        expect(locked.body).toEqual({ error: 'Too Many Attempts', message: ACCOUNT_MESSAGE });
        // The account waits for its window on this network, even with the right password.
        await signInAs('a@x.test', 'benar').expect(429);
        await signInAs('b@x.test').expect(401);
        await signInAs('b@x.test', 'benar').expect(200);
        await signInAs('a@x.test', 'benar', OTHER_IP).expect(200);
    });

    it('counts differently written forms of one email as the same account', async () => {
        const { signInAs } = await authApp();
        await repeat(3, () => signInAs('a@x.test'), 401);
        await repeat(2, () => signInAs(' A@X.test '), 401);
        await signInAs('a@x.test').expect(429);
        await signInAs('A@x.TEST').expect(429);
    });

    it('keeps a ceiling of 30 failed attempts per network across accounts', async () => {
        const { signInAs } = await authApp();
        for (let i = 0; i < 30; i += 1) await signInAs(`staf${i}@x.test`).expect(401);
        const limited = await signInAs('baru@x.test').expect(429);
        expect(limited.body).toEqual({
            error: 'Too Many Attempts',
            message: 'Terlalu banyak percobaan yang gagal dari jaringan ini. Coba lagi setelah 15 menit.',
        });
        await signInAs('baru@x.test', 'salah', OTHER_IP).expect(401);
    });

    it('refunds a successful sign-in in both windows and clears that account', async () => {
        const { signInAs, limits } = await authApp();
        const account = `${OFFICE_NETWORK}|acct:a@x.test`;
        await repeat(4, () => signInAs('a@x.test'), 401);
        await signInAs('a@x.test', 'benar').expect(200);
        await settleRefunds();
        expect(await hits('auth', OFFICE_NETWORK)).toBe(4);
        expect(await stores.get('auth-account')!.get(account)).toBeUndefined();

        await repeat(5, () => signInAs('a@x.test'), 401);
        await signInAs('a@x.test').expect(429);
        await settleRefunds();
        // The account gate's own rejection is not another network failure.
        expect(await hits('auth', OFFICE_NETWORK)).toBe(9);
        expect(await hits('auth-account', account)).toBe(5);

        // A colleague's success refunds only their own attempt.
        await signInAs('b@x.test', 'benar').expect(200);
        await settleRefunds();
        expect(await hits('auth', OFFICE_NETWORK)).toBe(9);
        expect(await hits('auth-account', account)).toBe(5);

        await limits.authAccountLimiter.resetKey(account);
        await signInAs('a@x.test').expect(401);
    });

    it('passes the exact JSON sign-in body to the auth handler', async () => {
        const received: unknown[] = [];
        const { app } = await authApp((req, res) => { received.push(req.body); res.sendStatus(401); });
        const raw = '{ "email" : "A@x.test",\n  "password": "kata \\u0073andi é☃", "extra": [1, {"a": null}] }';
        await request(app).post('/api/auth/sign-in/email')
            .set('Content-Type', 'application/json; charset=utf-8').send(raw).expect(401);
        expect(received).toEqual([raw]);
    });

    it.each([
        '/api/auth/sign-in/%2e/email',
        '/api/auth/sign-in/%2E/email',
        '/api/auth/sign-in/./email',
        '/api/auth/x/../sign-in/email',
        '/api/auth/x/%2e%2e/sign-in/email',
        '/api/auth/sign-in\\email',
    ])('serves only the canonical form of auth path %s', async path => {
        const { app, reached } = await authApp();
        const body = JSON.stringify({ email: 'a@x.test', password: 'salah' });
        expect(await rawPost(app, path, body)).toBe(404);
        expect(reached).not.toHaveBeenCalled();
        expect(await rawPost(app, '/api/auth/sign-in/email', body)).toBe(401);
    });

    it.each([
        ['application/x-www-form-urlencoded', 'email=a%40x.test&password=salah'],
        ['application/json-seq', '{"email":"a@x.test","password":"salah"}'],
        ['text/plain', '{"email":"a@x.test","password":"salah"}'],
    ])('refuses a %s sign-in body', async (type, body) => {
        const { app, reached } = await authApp();
        const refused = await request(app).post('/api/auth/sign-in/email').set('Content-Type', type).send(body).expect(415);
        expect(refused.body).toEqual({ error: 'Unsupported Media Type', message: 'Gunakan application/json.' });
        expect(reached).not.toHaveBeenCalled();
    });

    it('refuses an oversized sign-in body before the auth handler', async () => {
        const { app } = await authApp();
        const body = JSON.stringify({ email: 'a@x.test', password: 'x'.repeat(17 * 1024) });
        const refused = await request(app).post('/api/auth/sign-in/email').set('Content-Type', 'application/json').send(body).expect(413);
        expect(refused.body).toEqual({ type: 'entity.too.large' });
    });

    it('limits failed current-password checks per signed-in user', async () => {
        const { app } = await authApp();
        const changePassword = (user: string, result = 'salah', path = '/api/auth/change-password') =>
            asUser(request(app).post(path).set('x-test-result', result), user);
        await repeat(5, () => changePassword('staff-a'), 400);
        const limited = await changePassword('staff-a').expect(429);
        expect(limited.body.message).toBe('Terlalu banyak percobaan kata sandi yang gagal. Coba lagi setelah 15 menit.');
        await changePassword('staff-a', 'ok', '/api/auth/Change-Password/').expect(429);
        await changePassword('staff-b').expect(400);
        await changePassword('staff-b', 'ok').expect(200);
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
        expect(auth.options.disabledPaths).toEqual(['/verify-password']);
        expect(auth.options.rateLimit?.customRules).toEqual({
            '/sign-in/email': { window: 10, max: 10 },
            '/sign-in/social': { window: 10, max: 10 },
        });
    }, 30_000);
});
