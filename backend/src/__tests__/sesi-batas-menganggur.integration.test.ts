import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { hashCredentialPassword } from '../config/password-hashing.js';
import { bootRangkaianDatabase } from './helpers/rangkaian-pglite.js';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));
vi.mock('../config/rate-limits.js', async importOriginal => ({
    ...await importOriginal<typeof import('../config/rate-limits.js')>(),
    createRateLimiterStore: () => undefined,
}));

const ORIGIN = 'https://simsa.example.test';
const PASSWORD = 'synthetic-idle-password-01';
const USER_ID = '10000000-0000-4000-8000-0000000009a1';
const EMAIL = 'menganggur@example.test';
const MINUTE = 60 * 1000;

async function configuredAuth() {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_PROFILE', 'internal');
    vi.stubEnv('AUTH_PROVIDER', 'better-auth');
    vi.stubEnv('SIMSA_CLOUD_PLATFORM', 'local');
    vi.stubEnv('BETTER_AUTH_URL', ORIGIN);
    vi.stubEnv('FRONTEND_URL', ORIGIN);
    vi.stubEnv('BETTER_AUTH_SECRET', 'synthetic-auth-secret-for-test-configuration');
    vi.stubEnv('GOOGLE_OAUTH_ENABLED', 'false');
    vi.resetModules();
    return (await import('../config/auth.js')).auth;
}

function sessionCookie(setCookies: string[]): string | undefined {
    return setCookies.find(cookie => /better-auth\.session_token=/.test(cookie));
}

// The server ends a session that nobody uses after 30 minutes, the same
// limit as the automatic logout in the browser, and keeps extending one in use.
describe('server-side idle limit of a session', () => {
    let database: PGlite;
    let auth: Awaited<ReturnType<typeof configuredAuth>>;
    let app: express.Express;
    let clientIp = 10;

    async function signIn(body: Record<string, unknown> = {}) {
        clientIp += 1;
        const response = await auth.handler(new Request(`${ORIGIN}/api/auth/sign-in/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'x-simsa-client-ip': `203.0.113.${clientIp}` },
            body: JSON.stringify({ email: EMAIL, password: PASSWORD, ...body }),
        }));
        expect(response.status).toBe(200);
        const setCookies = response.headers.getSetCookie();
        return { setCookies, cookie: setCookies.map(value => value.split(';')[0]).join('; ') };
    }

    async function storedExpiry(): Promise<Date[]> {
        const rows = await holder.db.select({ expiresAt: schema.sessions.expiresAt })
            .from(schema.sessions).where(eq(schema.sessions.userId, USER_ID));
        return rows.map((row: { expiresAt: Date }) => row.expiresAt);
    }

    async function setExpiry(msFromNow: number) {
        await holder.db.update(schema.sessions)
            .set({ expiresAt: new Date(Date.now() + msFromNow) })
            .where(eq(schema.sessions.userId, USER_ID));
    }

    function expectAboutThirtyMinutesAhead(date: Date) {
        const remaining = date.getTime() - Date.now();
        expect(remaining).toBeGreaterThan(29 * MINUTE);
        expect(remaining).toBeLessThanOrEqual(30 * MINUTE);
    }

    beforeAll(async () => {
        database = await bootRangkaianDatabase();
        await database.query(
            `INSERT INTO unit_kerja (id, name) VALUES ('sesditjen', 'Sekretariat Direktorat Jenderal') ON CONFLICT (id) DO NOTHING`,
        );
        await database.query(`
            INSERT INTO users (id, email, name, role, unit_kerja_id, is_active, email_verified)
            VALUES ($1, $2, 'Pengguna Menganggur', 'admin_unit', 'sesditjen', true, true)
        `, [USER_ID, EMAIL]);
        await database.query(`
            INSERT INTO accounts (user_id, issuer, account_id, provider_id, password)
            VALUES ($1::uuid, 'local:credential', $1::text, 'credential', $2)
        `, [USER_ID, await hashCredentialPassword(PASSWORD)]);

        holder.db = drizzle(database, { schema });
        auth = await configuredAuth();
        await auth.$context;

        const { authMiddleware } = await import('../middlewares/auth.middleware.js');
        app = express();
        app.get('/api/ping', authMiddleware, (req, res) => {
            res.json({ user: (req as express.Request & { user?: { id: string } }).user?.id });
        });
    }, 120_000);

    afterAll(async () => {
        vi.unstubAllEnvs();
        vi.resetModules();
        await database?.close();
    });

    it('issues a 30-minute session whose cookie lives exactly as long', async () => {
        expect(auth.options.session).toMatchObject({ expiresIn: 30 * 60, updateAge: 5 * 60 });
        // A cookie cache would keep accepting a session the server already ended.
        expect(auth.options.session?.cookieCache?.enabled).not.toBe(true);

        await database.query('DELETE FROM sessions WHERE user_id = $1', [USER_ID]);
        const { setCookies } = await signIn();
        expect(sessionCookie(setCookies)).toMatch(/Max-Age=1800/);
        const [expiresAt] = await storedExpiry();
        expectAboutThirtyMinutesAhead(expiresAt);
    });

    it('gives a sign-in without "remember me" the same idle limit', async () => {
        await database.query('DELETE FROM sessions WHERE user_id = $1', [USER_ID]);
        const { setCookies } = await signIn({ rememberMe: false });
        expect(sessionCookie(setCookies)).toMatch(/Max-Age=1800/);
        expect(setCookies.some(cookie => cookie.includes('dont_remember'))).toBe(false);
        const [expiresAt] = await storedExpiry();
        expectAboutThirtyMinutesAhead(expiresAt);
    });

    it('extends a session in use and renews its cookie on an ordinary API request', async () => {
        await database.query('DELETE FROM sessions WHERE user_id = $1', [USER_ID]);
        const { cookie } = await signIn();

        // Used again four minutes later: not yet due, nothing is rewritten.
        await setExpiry(26 * MINUTE);
        const early = await request(app).get('/api/ping').set('Cookie', cookie).expect(200);
        expect(early.body).toEqual({ user: USER_ID });
        expect(sessionCookie(([] as string[]).concat(early.headers['set-cookie'] ?? []))).toBeUndefined();

        // Used again ten minutes later: extended to 30 minutes from now, and
        // the browser receives a cookie that lives as long.
        await setExpiry(20 * MINUTE);
        const due = await request(app).get('/api/ping').set('Cookie', cookie).expect(200);
        expect(due.body).toEqual({ user: USER_ID });
        const renewed = sessionCookie(([] as string[]).concat(due.headers['set-cookie'] ?? []));
        expect(renewed).toMatch(/Max-Age=1800/);
        expect(renewed?.split(';')[0]).toBe(cookie.split('; ').find(part => part.includes('session_token')));
        const [expiresAt] = await storedExpiry();
        expectAboutThirtyMinutesAhead(expiresAt);
    });

    it('refuses a session left unused past the limit, deletes it and clears the cookie', async () => {
        await database.query('DELETE FROM sessions WHERE user_id = $1', [USER_ID]);
        const { cookie } = await signIn();
        await setExpiry(-1 * MINUTE);

        const response = await request(app).get('/api/ping').set('Cookie', cookie).expect(401);
        expect(sessionCookie(([] as string[]).concat(response.headers['set-cookie'] ?? []))).toMatch(/Max-Age=0/);
        expect(await storedExpiry()).toEqual([]);

        const session = await auth.handler(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { Cookie: cookie } }));
        expect(await session.json()).toBeNull();
    });
});
