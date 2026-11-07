import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { hashCredentialPassword, verifyCredentialPassword } from '../config/password-hashing.js';
import { bootRangkaianDatabase } from './helpers/rangkaian-pglite.js';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));
vi.mock('../config/rate-limits.js', async importOriginal => ({
    ...await importOriginal<typeof import('../config/rate-limits.js')>(),
    createRateLimiterStore: () => undefined,
}));

const ORIGIN = 'https://simsa.example.test';
const CSRF = 'a'.repeat(64);
const PASSWORD = {
    superAdmin: 'synthetic-super-admin-password',
    unit: 'synthetic-unit-old-password',
    inactive: 'synthetic-inactive-old-password',
    upperCase: 'synthetic-upper-case-old-password',
    reset: 'synthetic-reset-password-01',
} as const;
// Every id has hex letters, so an upper-cased id differs from the stored one.
const USER = {
    superAdmin: '10000000-0000-4000-8000-0000000007a1',
    unit: '10000000-0000-4000-8000-0000000007a2',
    google: '10000000-0000-4000-8000-0000000007a3',
    pending: '10000000-0000-4000-8000-0000000007a4',
    inactive: '10000000-0000-4000-8000-0000000007a5',
    upperCase: '10000000-0000-4000-8000-0000000007a6',
    googleUpperCase: '10000000-0000-4000-8000-0000000007a7',
    missing: '10000000-0000-4000-8000-0000000007ff',
} as const;
const EMAIL = {
    superAdmin: 'super-admin@example.test',
    unit: 'admin-unit@example.test',
    google: 'google-saja@example.test',
    pending: 'menunggu@example.test',
    inactive: 'nonaktif@example.test',
    upperCase: 'huruf-besar@example.test',
    googleUpperCase: 'google-huruf-besar@example.test',
} as const;

function cookieHeader(response: Response): string {
    return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
}

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

// End-to-end Super Admin recovery: the real Better Auth instance signs in,
// the user-management router runs behind CSRF, authMiddleware and the role
// gate, and the service writes to a fully migrated database.
describe('Super Admin password reset', () => {
    let database: PGlite;
    let auth: Awaited<ReturnType<typeof configuredAuth>>;
    let app: express.Express;
    let superAdminCookie = '';
    let unitCookie = '';
    let clientIp = 10;

    // Better Auth allows three sign-ins per address per ten seconds.
    async function signIn(email: string, password: string) {
        clientIp += 1;
        return auth.handler(new Request(`${ORIGIN}/api/auth/sign-in/email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: ORIGIN,
                'x-simsa-client-ip': `203.0.113.${clientIp}`,
            },
            body: JSON.stringify({ email, password }),
        }));
    }

    async function currentSession(cookie: string) {
        const response = await auth.handler(new Request(`${ORIGIN}/api/auth/get-session`, {
            headers: { Cookie: cookie },
        }));
        return response.json() as Promise<{ user?: { id: string } } | null>;
    }

    function resetRequest(userId: string, cookie: string, body: unknown = { newPassword: PASSWORD.reset }) {
        return request(app)
            .post(`/api/users/${userId}/password`)
            .set('Cookie', `${cookie}; csrf-token=${CSRF}`)
            .set('X-CSRF-Token', CSRF)
            .send(body as object);
    }

    async function credentialRows(userId: string) {
        const result = await database.query<{ issuer: string | null; account_id: string; password: string | null }>(
            `SELECT issuer, account_id, password FROM accounts WHERE user_id = $1 AND provider_id = 'credential'`,
            [userId],
        );
        return result.rows;
    }

    beforeAll(async () => {
        database = await bootRangkaianDatabase();
        await database.query(
            `INSERT INTO unit_kerja (id, name) VALUES ('sesditjen', 'Sekretariat Direktorat Jenderal') ON CONFLICT (id) DO NOTHING`,
        );
        await database.query(`
            INSERT INTO users (id, email, name, role, unit_kerja_id, is_active, email_verified) VALUES
                ($1, $6, 'Super Admin', 'super_admin', NULL, true, true),
                ($2, $7, 'Admin Unit', 'admin_unit', 'sesditjen', true, true),
                ($3, $8, 'Pengguna Google', 'admin_unit', 'sesditjen', true, true),
                ($4, $9, 'Menunggu Persetujuan', 'user', NULL, true, true),
                ($5, $10, 'Pengguna Nonaktif', 'admin_unit', 'sesditjen', false, true),
                ($11, $13, 'Pengguna Huruf Besar', 'admin_unit', 'sesditjen', true, true),
                ($12, $14, 'Pengguna Google Huruf Besar', 'admin_unit', 'sesditjen', true, true)
        `, [USER.superAdmin, USER.unit, USER.google, USER.pending, USER.inactive,
            EMAIL.superAdmin, EMAIL.unit, EMAIL.google, EMAIL.pending, EMAIL.inactive,
            USER.upperCase, USER.googleUpperCase, EMAIL.upperCase, EMAIL.googleUpperCase]);
        await database.query(`
            INSERT INTO accounts (user_id, issuer, account_id, provider_id, password) VALUES
                ($1::uuid, 'local:credential', $1::text, 'credential', $5),
                ($2::uuid, 'local:credential', $2::text, 'credential', $6),
                ($3::uuid, 'local:credential', $3::text, 'credential', $7),
                ($4::uuid, 'local:credential', $4::text, 'credential', $8)
        `, [USER.superAdmin, USER.unit, USER.inactive, USER.upperCase,
            await hashCredentialPassword(PASSWORD.superAdmin),
            await hashCredentialPassword(PASSWORD.unit),
            await hashCredentialPassword(PASSWORD.inactive),
            await hashCredentialPassword(PASSWORD.upperCase)]);
        await database.query(`
            INSERT INTO accounts (user_id, account_id, provider_id) VALUES
                ($1::uuid, 'google-subject-reset', 'google'),
                ($2::uuid, 'google-subject-pending', 'google'),
                ($3::uuid, 'google-subject-upper-case', 'google')
        `, [USER.google, USER.pending, USER.googleUpperCase]);

        holder.db = drizzle(database, { schema });
        auth = await configuredAuth();
        await auth.$context;

        const [{ csrfProtection }, { default: userManagementRoutes }] = await Promise.all([
            import('../middlewares/csrf.middleware.js'),
            import('../routes/user-management.routes.js'),
        ]);
        app = express();
        app.use(cookieParser());
        app.use('/api', csrfProtection);
        app.use(express.json());
        app.use('/api/users', userManagementRoutes);
        app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
            res.status(error.statusCode ?? 500).json({ error: error.name, message: error.message });
        });

        const superAdmin = await signIn(EMAIL.superAdmin, PASSWORD.superAdmin);
        expect(superAdmin.status).toBe(200);
        superAdminCookie = cookieHeader(superAdmin);
        const unit = await signIn(EMAIL.unit, PASSWORD.unit);
        expect(unit.status).toBe(200);
        unitCookie = cookieHeader(unit);
    }, 120_000);

    afterAll(async () => {
        vi.unstubAllEnvs();
        vi.resetModules();
        await database?.close();
    });

    it('requires a session, the CSRF token and the Super Admin role', async () => {
        await request(app)
            .post(`/api/users/${USER.unit}/password`)
            .set('Cookie', `csrf-token=${CSRF}`)
            .set('X-CSRF-Token', CSRF)
            .send({ newPassword: PASSWORD.reset })
            .expect(401);

        await request(app)
            .post(`/api/users/${USER.unit}/password`)
            .set('Cookie', superAdminCookie)
            .send({ newPassword: PASSWORD.reset })
            .expect(403, /CSRF/);

        const unitAdmin = await resetRequest(USER.google, unitCookie).expect(403);
        expect(unitAdmin.body).toMatchObject({ message: 'Super admin access required' });

        expect(await credentialRows(USER.google)).toEqual([]);
    });

    it('applies the Better Auth password bounds without echoing the value', async () => {
        const tooShort = await resetRequest(USER.unit, superAdminCookie, { newPassword: 'pendek7' }).expect(400);
        expect(tooShort.body.message).toBe('Kata sandi minimal 8 karakter');
        expect(JSON.stringify(tooShort.body)).not.toContain('pendek7');

        const tooLong = 'p'.repeat(129);
        const long = await resetRequest(USER.unit, superAdminCookie, { newPassword: tooLong }).expect(400);
        expect(long.body.message).toBe('Kata sandi maksimal 128 karakter');
        expect(JSON.stringify(long.body)).not.toContain(tooLong);

        await resetRequest(USER.unit, superAdminCookie, {}).expect(400);
        await resetRequest('bukan-uuid', superAdminCookie).expect(400);

        // The old password still works: nothing was written.
        expect((await signIn(EMAIL.unit, PASSWORD.unit)).status).toBe(200);
    });

    it('refuses the caller’s own account, unknown users and pending identities', async () => {
        const self = await resetRequest(USER.superAdmin, superAdminCookie).expect(400);
        expect(self.body.error).toMatch(/Ubah Kata Sandi/);

        await resetRequest(USER.missing, superAdminCookie).expect(404);

        const pending = await resetRequest(USER.pending, superAdminCookie).expect(409);
        expect(pending.body.message).toMatch(/menunggu persetujuan/);
        expect(await credentialRows(USER.pending)).toEqual([]);

        expect((await currentSession(superAdminCookie))?.user?.id).toBe(USER.superAdmin);
    });

    it('replaces the credential, revokes every session and audits without the secret', async () => {
        const [before] = await credentialRows(USER.unit);
        expect((await currentSession(unitCookie))?.user?.id).toBe(USER.unit);

        const response = await resetRequest(USER.unit, superAdminCookie).expect(200);
        expect(response.body).toMatchObject({
            success: true,
            data: { userId: USER.unit, credentialCreated: false },
        });
        expect(response.body.data.revokedSessions).toBeGreaterThanOrEqual(1);
        const serialized = JSON.stringify(response.body);
        expect(serialized).not.toContain(PASSWORD.reset);

        const rows = await credentialRows(USER.unit);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ issuer: 'local:credential', account_id: USER.unit });
        expect(rows[0].password).not.toBe(before.password);
        expect(serialized).not.toContain(rows[0].password!);

        expect(await currentSession(unitCookie)).toBeNull();
        const remaining = await database.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM sessions WHERE user_id = $1', [USER.unit],
        );
        expect(remaining.rows[0].count).toBe(0);

        expect((await signIn(EMAIL.unit, PASSWORD.unit)).status).toBe(401);
        const fresh = await signIn(EMAIL.unit, PASSWORD.reset);
        expect(fresh.status).toBe(200);
        expect((await currentSession(cookieHeader(fresh)))?.user?.id).toBe(USER.unit);

        const audit = await database.query<{ user_id: string; action: string; entity_type: string; changes: any }>(
            `SELECT user_id, action, entity_type, changes FROM audit_log WHERE entity_id = $1`, [USER.unit],
        );
        expect(audit.rows).toHaveLength(1);
        expect(audit.rows[0]).toMatchObject({
            user_id: USER.superAdmin,
            action: 'update',
            entity_type: 'user',
            changes: { fields: ['password'], after: { password: 'diatur ulang', credentialAccount: 'diperbarui' } },
        });
        const auditText = JSON.stringify(audit.rows[0].changes);
        expect(auditText).not.toContain(PASSWORD.reset);
        expect(auditText).not.toContain(rows[0].password!);
    });

    it('adds a credential next to a Google-only identity', async () => {
        const response = await resetRequest(USER.google, superAdminCookie).expect(200);
        expect(response.body.data).toEqual({ userId: USER.google, credentialCreated: true, revokedSessions: 0 });

        expect(await credentialRows(USER.google)).toEqual([
            { issuer: 'local:credential', account_id: USER.google, password: expect.any(String) },
        ]);
        const google = await database.query<{ account_id: string }>(
            `SELECT account_id FROM accounts WHERE user_id = $1 AND provider_id = 'google'`, [USER.google],
        );
        expect(google.rows).toEqual([{ account_id: 'google-subject-reset' }]);

        const signedIn = await signIn(EMAIL.google, PASSWORD.reset);
        expect(signedIn.status).toBe(200);
        expect((await currentSession(cookieHeader(signedIn)))?.user?.id).toBe(USER.google);
    });

    it('resets an inactive account; the new password works only after reactivation', async () => {
        const [before] = await credentialRows(USER.inactive);
        await resetRequest(USER.inactive, superAdminCookie).expect(200);
        const [row] = await credentialRows(USER.inactive);
        expect(row.password).not.toBe(before.password);
        expect(await verifyCredentialPassword({ hash: row.password!, password: PASSWORD.reset })).toBe(true);

        expect((await signIn(EMAIL.inactive, PASSWORD.reset)).status).not.toBe(200);
        const sessions = await database.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM sessions WHERE user_id = $1', [USER.inactive],
        );
        expect(sessions.rows[0].count).toBe(0);

        await database.query('UPDATE users SET is_active = true WHERE id = $1', [USER.inactive]);
        expect((await signIn(EMAIL.inactive, PASSWORD.inactive)).status).toBe(401);
        expect((await signIn(EMAIL.inactive, PASSWORD.reset)).status).toBe(200);
    });

    // Postgres compares uuid columns regardless of case, but Better Auth
    // signs in with the credential whose account_id (text) equals the stored id.
    it('treats an upper-case id in the path as the stored account', async () => {
        expect(USER.superAdmin.toUpperCase()).not.toBe(USER.superAdmin);
        const self = await resetRequest(USER.superAdmin.toUpperCase(), superAdminCookie).expect(400);
        expect(self.body.error).toMatch(/Ubah Kata Sandi/);
        expect(await credentialRows(USER.superAdmin)).toHaveLength(1);
        expect((await currentSession(superAdminCookie))?.user?.id).toBe(USER.superAdmin);

        const response = await resetRequest(USER.upperCase.toUpperCase(), superAdminCookie).expect(200);
        expect(response.body.data).toMatchObject({ userId: USER.upperCase, credentialCreated: false });
        expect(await credentialRows(USER.upperCase)).toEqual([
            { issuer: 'local:credential', account_id: USER.upperCase, password: expect.any(String) },
        ]);
        expect((await signIn(EMAIL.upperCase, PASSWORD.upperCase)).status).toBe(401);
        expect((await signIn(EMAIL.upperCase, PASSWORD.reset)).status).toBe(200);

        const audit = await database.query<{ changes: any }>(
            'SELECT changes FROM audit_log WHERE entity_id = $1', [USER.upperCase],
        );
        expect(audit.rows).toHaveLength(1);
        expect(audit.rows[0].changes.after).toMatchObject({ credentialAccount: 'diperbarui' });
    });

    it('writes the stored id when the service itself gets an upper-case one', async () => {
        const { userManagementService, SELF_PASSWORD_RESET_MESSAGE } = await import('../services/user-management.service.js');
        const auditContext = { userId: USER.superAdmin, userEmail: EMAIL.superAdmin, ipAddress: '203.0.113.1' };

        await expect(userManagementService.resetPassword(USER.superAdmin.toUpperCase(), PASSWORD.reset, auditContext))
            .rejects.toThrow(SELF_PASSWORD_RESET_MESSAGE);
        expect((await currentSession(superAdminCookie))?.user?.id).toBe(USER.superAdmin);

        const result = await userManagementService.resetPassword(
            USER.googleUpperCase.toUpperCase(), PASSWORD.reset, auditContext,
        );
        expect(result).toEqual({ userId: USER.googleUpperCase, credentialCreated: true, revokedSessions: 0 });
        expect(await credentialRows(USER.googleUpperCase)).toEqual([
            { issuer: 'local:credential', account_id: USER.googleUpperCase, password: expect.any(String) },
        ]);
        expect((await signIn(EMAIL.googleUpperCase, PASSWORD.reset)).status).toBe(200);
    });
});
