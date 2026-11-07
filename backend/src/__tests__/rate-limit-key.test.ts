import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { MemoryStore, rateLimit } from 'express-rate-limit';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../config/auth', () => ({
    auth: { api: { getSession: vi.fn() } },
}));
vi.mock('../config/database', () => ({
    db: { select: vi.fn() },
}));
vi.mock('../db/schema', () => ({
    users: { id: 'id', email: 'email', name: 'name', role: 'role', unitKerjaId: 'unitKerjaId', isActive: 'isActive' },
}));

const { auth } = await import('../config/auth');
const { db } = await import('../config/database');
const {
    networkRateLimitKey, passwordCheckRateLimitKey, principalRateLimitKey, signInIdentifierKey, SESSION_COOKIE,
} = await import('../middlewares/rate-limit-key');
const { generalLimiter } = await import('../middlewares/rate-limiter.middleware');
const { authMiddleware } = await import('../middlewares/auth.middleware');
const { verifyRequestIdentity } = await import('../services/request-identity.service');
const { ServiceUnavailableError } = await import('../utils/errors');

const getSession = auth.api.getSession as unknown as Mock;
const OFFICE_IP = '198.51.100.7';

const sessions: Record<string, Record<string, unknown>> = {
    'token-staff-a': { id: 'staff-a', role: 'staff', unitKerjaId: 'unit-a', isActive: true },
    'token-staff-b': { id: 'staff-b', role: 'staff', unitKerjaId: 'unit-a', isActive: true },
    'token-pending': { id: 'pending-1', role: 'user', unitKerjaId: null, isActive: true },
};

function sessionFromCookie({ headers }: { headers: Record<string, string> }) {
    const token = /better-auth\.session_token=([^;]+)/.exec(headers.cookie ?? '')?.[1];
    const user = token ? sessions[token] : undefined;
    return Promise.resolve(user ? { user: { email: `${user.id}@example.go.id`, name: null, ...user } } : null);
}

function fakeRequest(overrides: Record<string, unknown> = {}): Request {
    return { ip: OFFICE_IP, headers: {}, ...overrides } as unknown as Request;
}

function sessionRequest(token: string, overrides: Record<string, unknown> = {}) {
    return fakeRequest({ headers: { cookie: `better-auth.session_token=${token}` }, ...overrides });
}

// Simulates distinct client addresses without relying on proxy headers.
function clientAddress(req: Request, _res: Response, next: NextFunction) {
    const ip = req.header('x-test-ip');
    if (ip) Object.defineProperty(req, 'ip', { value: ip, configurable: true });
    next();
}

function mockProvisionedRow(row: Record<string, unknown>) {
    (db.select as Mock).mockReturnValue({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([row]) }),
        }),
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockReset();
});

describe('networkRateLimitKey', () => {
    it('groups IPv6 clients per /56 and keeps IPv4-mapped clients on their IPv4 key', () => {
        const first = networkRateLimitKey(fakeRequest({ ip: '2001:db8:abcd:12ff::1' }));
        expect(first).toBe('ip:2001:db8:abcd:1200::/56');
        expect(networkRateLimitKey(fakeRequest({ ip: '2001:db8:abcd:1200::9' }))).toBe(first);
        expect(networkRateLimitKey(fakeRequest({ ip: '2001:db8:abcd:1300::1' }))).not.toBe(first);
        expect(networkRateLimitKey(fakeRequest({ ip: '::ffff:203.0.113.5' }))).toBe('ip:203.0.113.5');
        expect(networkRateLimitKey(fakeRequest({ ip: '203.0.113.5' }))).toBe('ip:203.0.113.5');
    });

    it.each([undefined, '', 'not-an-address'])('fails closed instead of sharing a bucket for client address %s', ip => {
        expect(() => networkRateLimitKey(fakeRequest({ ip }))).toThrow(ServiceUnavailableError);
    });

    it('returns 503 through a limiter when the client address is missing', async () => {
        const app = express();
        app.use((req, _res, next) => {
            Object.defineProperty(req, 'ip', { value: undefined, configurable: true });
            next();
        });
        app.use(rateLimit({ store: new MemoryStore(), windowMs: 60_000, max: 5, keyGenerator: principalRateLimitKey }));
        app.get('/ping', (_req, res) => res.sendStatus(200));
        app.use((error: { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
            res.sendStatus(error.statusCode ?? 500);
        });
        await request(app).get('/ping').expect(503);
    });
});

describe('principalRateLimitKey', () => {
    it('uses the authenticated user without another session lookup', async () => {
        const req = sessionRequest('token-staff-a', { user: { id: 'route-user' } });
        await expect(principalRateLimitKey(req)).resolves.toBe('user:route-user');
        expect(getSession).not.toHaveBeenCalled();
    });

    it('keys an active, provisioned session by its subject', async () => {
        getSession.mockImplementation(sessionFromCookie);
        await expect(principalRateLimitKey(sessionRequest('token-staff-a'))).resolves.toBe('user:staff-a');
        const secure = fakeRequest({ headers: { cookie: 'csrf-token=abc; __Secure-better-auth.session_token=token-staff-b' } });
        getSession.mockResolvedValueOnce({ user: sessions['token-staff-b'] });
        await expect(principalRateLimitKey(secure)).resolves.toBe('user:staff-b');
    });

    it.each([
        ['a pending sign-up', { role: 'user', unitKerjaId: null, isActive: true }],
        ['an account without a role', { role: undefined, unitKerjaId: null }],
        ['a staff account without a unit', { role: 'staff', unitKerjaId: null, isActive: true }],
        ['an admin_unit account with a blank unit', { role: 'admin_unit', unitKerjaId: '  ', isActive: true }],
        ['a deactivated account', { role: 'super_admin', unitKerjaId: null, isActive: false }],
    ])('keeps %s on the network quota', async (_label, fields) => {
        getSession.mockResolvedValueOnce({ user: { id: 'session-user', email: 'x@example.go.id', ...fields } });
        await expect(principalRateLimitKey(sessionRequest('any'))).resolves.toBe(`ip:${OFFICE_IP}`);
    });

    it('does not look up a session without a session cookie', async () => {
        await expect(principalRateLimitKey(fakeRequest())).resolves.toBe(`ip:${OFFICE_IP}`);
        await expect(principalRateLimitKey(fakeRequest({ headers: { cookie: 'csrf-token=abc; xbetter-auth.session_token=1' } })))
            .resolves.toBe(`ip:${OFFICE_IP}`);
        expect(getSession).not.toHaveBeenCalled();
    });

    it('falls back to the network key for an unverifiable cookie or a failed lookup', async () => {
        getSession.mockResolvedValueOnce(null);
        await expect(principalRateLimitKey(sessionRequest('forged'))).resolves.toBe(`ip:${OFFICE_IP}`);
        getSession.mockRejectedValueOnce(new Error('session store unavailable'));
        await expect(principalRateLimitKey(sessionRequest('token-staff-a'))).resolves.toBe(`ip:${OFFICE_IP}`);
    });

    it('recognizes plain, dashed and secure Better Auth session cookies only', () => {
        expect(SESSION_COOKIE.test('better-auth.session_token=a')).toBe(true);
        expect(SESSION_COOKIE.test('theme=dark; better-auth-session_token=a')).toBe(true);
        expect(SESSION_COOKIE.test('csrf-token=b;__Secure-better-auth.session_token=a')).toBe(true);
        expect(SESSION_COOKIE.test('better-auth.session_data=a')).toBe(false);
        expect(SESSION_COOKIE.test('other-better-auth.session_token=a')).toBe(false);
    });

    it('keeps independent quotas for two provisioned users behind one IP', async () => {
        getSession.mockImplementation(sessionFromCookie);
        const app = express();
        app.use(clientAddress);
        app.use(rateLimit({ store: new MemoryStore(), windowMs: 60_000, max: 2, keyGenerator: principalRateLimitKey }));
        app.get('/ping', (_req, res) => res.sendStatus(200));
        const as = (token?: string) => {
            const call = request(app).get('/ping').set('x-test-ip', OFFICE_IP);
            return token ? call.set('Cookie', `better-auth.session_token=${token}`) : call;
        };

        await as('token-staff-a').expect(200);
        await as('token-staff-a').expect(200);
        await as('token-staff-a').expect(429);
        await as('token-staff-b').expect(200);
        await as('token-staff-b').expect(200);
        // Pending sessions and anonymous requests from the office share the
        // network quota, which the provisioned users above did not consume.
        await as('token-pending').expect(200);
        await as().expect(200);
        await as().expect(429);
        await as('token-pending').expect(429);
    });
});

describe('passwordCheckRateLimitKey', () => {
    it('keys current-password checks by network and provisioned user', async () => {
        getSession.mockImplementation(sessionFromCookie);
        await expect(passwordCheckRateLimitKey(fakeRequest({ user: { id: 'staff-a' } })))
            .resolves.toBe(`ip:${OFFICE_IP}|user:staff-a`);
        await expect(passwordCheckRateLimitKey(sessionRequest('token-staff-a', { ip: '203.0.113.20' })))
            .resolves.toBe('ip:203.0.113.20|user:staff-a');
        // Sessions without a per-user quota stay on the network key.
        await expect(passwordCheckRateLimitKey(sessionRequest('token-pending'))).resolves.toBe(`ip:${OFFICE_IP}`);
        await expect(passwordCheckRateLimitKey(fakeRequest())).resolves.toBe(`ip:${OFFICE_IP}`);
    });

    it('fails closed without a client address', async () => {
        await expect(passwordCheckRateLimitKey(fakeRequest({ ip: undefined, user: { id: 'staff-a' } })))
            .rejects.toThrow(ServiceUnavailableError);
    });
});

describe('signInIdentifierKey', () => {
    const signIn = (body: unknown, ip = OFFICE_IP) => signInIdentifierKey(fakeRequest({ ip, body }));

    it('keys failed sign-ins by network and normalized email', () => {
        expect(signIn('{"email":"a@x.test","password":"p"}')).toBe(`ip:${OFFICE_IP}|acct:a@x.test`);
        expect(signIn('{ "email": "  A@X.Test\\t", "password": "p" }')).toBe(`ip:${OFFICE_IP}|acct:a@x.test`);
        expect(signIn('{"email":"a@x.test"}', '2001:db8:abcd:12ff::1')).toBe('ip:2001:db8:abcd:1200::/56|acct:a@x.test');
        expect(signIn(`{"email":"${'a'.repeat(400)}@x.test"}`)).toBe(`ip:${OFFICE_IP}|acct:${'a'.repeat(320)}`);
        // A body a hosting layer already parsed is keyed the same way.
        expect(signIn({ email: ' A@x.test ', password: 'p' })).toBe(`ip:${OFFICE_IP}|acct:a@x.test`);
    });

    it.each([
        ['no body', undefined],
        ['an empty body', ''],
        ['a parsed array', [{ email: 'a@x.test' }]],
        ['a parsed body without an email', { password: 'p' }],
        ['malformed JSON', '{"email":"a@x.test"'],
        ['JSON null', 'null'],
        ['a JSON array', '[{"email":"a@x.test"}]'],
        ['a non-string email', '{"email":["a@x.test"]}'],
        ['a missing email', '{"password":"p"}'],
        ['an oversized body', JSON.stringify({ email: 'a@x.test', padding: 'x'.repeat(17 * 1024) })],
    ])('puts %s in the network bucket without an account', (_label, body) => {
        expect(signIn(body)).toBe(`ip:${OFFICE_IP}|acct:`);
    });

    it('fails closed without a client address', () => {
        expect(() => signInIdentifierKey(fakeRequest({ ip: undefined, body: '{"email":"a@x.test"}' })))
            .toThrow(ServiceUnavailableError);
    });
});

describe('request identity memoization', () => {
    function appWithAuth() {
        const app = express();
        app.use('/api', generalLimiter);
        app.get('/api/ping', authMiddleware, (req, res) => res.json({ user: (req as Request & { user?: { id: string } }).user?.id }));
        return app;
    }

    it('resolves the session once for generalLimiter and authMiddleware', async () => {
        getSession.mockImplementation(sessionFromCookie);
        mockProvisionedRow({ id: 'staff-a', email: 'staff-a@example.go.id', name: null, role: 'staff', unitKerjaId: 'unit-a', isActive: true });

        const response = await request(appWithAuth()).get('/api/ping')
            .set('Cookie', 'better-auth.session_token=token-staff-a').expect(200);
        expect(response.body).toEqual({ user: 'staff-a' });
        expect(getSession).toHaveBeenCalledTimes(1);
        // authMiddleware still reads the account from the database.
        expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('does not cache a rejected session lookup', async () => {
        getSession.mockRejectedValueOnce(new Error('session store unavailable'))
            .mockImplementation(sessionFromCookie);
        mockProvisionedRow({ id: 'staff-a', email: 'staff-a@example.go.id', name: null, role: 'staff', unitKerjaId: 'unit-a', isActive: true });

        await request(appWithAuth()).get('/api/ping')
            .set('Cookie', 'better-auth.session_token=token-staff-a').expect(200);
        expect(getSession).toHaveBeenCalledTimes(2);

        const req = sessionRequest('token-staff-a');
        getSession.mockRejectedValueOnce(new Error('session store unavailable'));
        await expect(verifyRequestIdentity(req)).rejects.toThrow('session store unavailable');
        await expect(verifyRequestIdentity(req)).resolves.toMatchObject({ subject: 'staff-a', role: 'staff', unitKerjaId: 'unit-a', isActive: true });
        await expect(verifyRequestIdentity(req)).resolves.toMatchObject({ subject: 'staff-a' });
        expect(getSession).toHaveBeenCalledTimes(4);
    });

    it('keeps lookups of different requests separate', async () => {
        getSession.mockImplementation(sessionFromCookie);
        const first = sessionRequest('token-staff-a');
        const second = sessionRequest('token-staff-b');
        expect(verifyRequestIdentity(first)).toBe(verifyRequestIdentity(first));
        await expect(verifyRequestIdentity(first)).resolves.toMatchObject({ subject: 'staff-a' });
        await expect(verifyRequestIdentity(second)).resolves.toMatchObject({ subject: 'staff-b' });
        expect(getSession).toHaveBeenCalledTimes(2);
    });
});
