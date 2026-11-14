import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
const USER = {
    active: '10000000-0000-4000-8000-0000000009b1',
    inactive: '10000000-0000-4000-8000-0000000009b2',
} as const;
const EMAIL = { active: 'pencatat@example.test', inactive: 'dinonaktifkan@example.test' } as const;
const PASSWORD = { active: 'synthetic-audit-password-01', inactive: 'synthetic-audit-password-02' } as const;
const NEW_PASSWORD = 'kuda-laut-biru-2026';

interface AuditRow {
    user_id: string | null;
    user_email: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    changes: any;
    ip_address: string | null;
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

function cookieHeader(response: Response): string {
    return response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
}

// Sign-ins, failed email sign-ins, sign-outs and own password changes reach
// the Audit Log without a password, token or session id.
describe('authentication events in the Audit Log', () => {
    let database: PGlite;
    let auth: Awaited<ReturnType<typeof configuredAuth>>;
    let clientIp = 10;

    function post(path: string, body: unknown, cookie?: string) {
        clientIp += 1;
        return auth.handler(new Request(`${ORIGIN}/api/auth${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: ORIGIN,
                'x-simsa-client-ip': `203.0.113.${clientIp}`,
                ...(cookie ? { Cookie: cookie } : {}),
            },
            body: JSON.stringify(body),
        }));
    }

    const signIn = (email: string, password: string, extra: Record<string, unknown> = {}) =>
        post('/sign-in/email', { email, password, ...extra });

    async function auditRows(): Promise<AuditRow[]> {
        const result = await database.query<AuditRow>(
            'SELECT user_id, user_email, action, entity_type, entity_id, changes, ip_address FROM audit_log ORDER BY created_at, id',
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
                ($1, $3, 'Petugas Pencatat', 'admin_unit', 'sesditjen', true, true),
                ($2, $4, 'Petugas Lama', 'admin_unit', 'sesditjen', false, true)
        `, [USER.active, USER.inactive, EMAIL.active, EMAIL.inactive]);
        await database.query(`
            INSERT INTO accounts (user_id, issuer, account_id, provider_id, password) VALUES
                ($1::uuid, 'local:credential', $1::text, 'credential', $3),
                ($2::uuid, 'local:credential', $2::text, 'credential', $4)
        `, [USER.active, USER.inactive,
            await hashCredentialPassword(PASSWORD.active), await hashCredentialPassword(PASSWORD.inactive)]);

        holder.db = drizzle(database, { schema });
        auth = await configuredAuth();
        await auth.$context;
    }, 120_000);

    beforeEach(async () => {
        await database.query('DELETE FROM audit_log');
    });

    afterAll(async () => {
        vi.unstubAllEnvs();
        vi.resetModules();
        await database?.close();
    });

    it('records a successful email sign-in with the address it came from', async () => {
        const response = await signIn(EMAIL.active, PASSWORD.active);
        expect(response.status).toBe(200);

        const rows = await auditRows();
        expect(rows).toEqual([{
            user_id: USER.active,
            user_email: EMAIL.active,
            action: 'sign_in',
            entity_type: 'user',
            entity_id: USER.active,
            changes: { after: { metode: 'email' } },
            ip_address: `203.0.113.${clientIp}`,
        }]);
        const token = cookieHeader(response).split('=')[1];
        expect(JSON.stringify(rows)).not.toContain(token.split('.')[0]);
        expect(JSON.stringify(rows)).not.toContain(PASSWORD.active);
    });

    it('records failed email sign-ins with the attempted address only', async () => {
        expect((await signIn(EMAIL.active, 'synthetic-wrong-password')).status).toBe(401);
        expect((await signIn('Tidak.Dikenal@Example.Test', 'synthetic-wrong-password')).status).toBe(401);
        expect((await signIn(EMAIL.inactive, PASSWORD.inactive)).status).toBe(401);
        // A password typed into the email field is never stored.
        expect((await signIn('synthetic-secret-in-email-field', 'x')).status).toBe(400);

        const rows = await auditRows();
        expect(rows.map(row => [row.action, row.user_id, row.user_email, row.entity_id, row.changes.after.alasan])).toEqual([
            ['sign_in_failed', null, EMAIL.active, null, 'Email atau kata sandi salah'],
            ['sign_in_failed', null, 'tidak.dikenal@example.test', null, 'Email atau kata sandi salah'],
            ['sign_in_failed', null, EMAIL.inactive, null, 'Akun tidak aktif atau sesi tidak dapat dibuat'],
            ['sign_in_failed', null, null, null, 'Format email tidak valid'],
        ]);
        expect(rows.every(row => row.ip_address?.startsWith('203.0.113.'))).toBe(true);
        const stored = JSON.stringify(rows);
        expect(stored).not.toContain('synthetic-wrong-password');
        expect(stored).not.toContain('synthetic-secret-in-email-field');
        expect(stored).not.toContain(PASSWORD.inactive);
    });

    it('records a sign-out by the user who left', async () => {
        const cookie = cookieHeader(await signIn(EMAIL.active, PASSWORD.active));
        await database.query('DELETE FROM audit_log');

        expect((await post('/sign-out', {}, cookie)).status).toBe(200);
        // Without a session nobody is recorded as having signed out.
        expect((await post('/sign-out', {}, cookie)).status).toBe(200);

        expect(await auditRows()).toEqual([{
            user_id: USER.active,
            user_email: EMAIL.active,
            action: 'sign_out',
            entity_type: 'user',
            entity_id: USER.active,
            changes: null,
            ip_address: expect.stringMatching(/^203\.0\.113\./),
        }]);
    });

    it('records a change of one’s own password, not a refused one, and never the passwords', async () => {
        const cookie = cookieHeader(await signIn(EMAIL.active, PASSWORD.active));
        await database.query('DELETE FROM audit_log');

        const refused = await post('/change-password', {
            currentPassword: 'synthetic-wrong-password', newPassword: NEW_PASSWORD, revokeOtherSessions: true,
        }, cookie);
        expect(refused.status).toBe(400);
        expect(await auditRows()).toEqual([]);

        const changed = await post('/change-password', {
            currentPassword: PASSWORD.active, newPassword: NEW_PASSWORD, revokeOtherSessions: true,
        }, cookie);
        expect(changed.status).toBe(200);

        const rows = await auditRows();
        expect(rows).toEqual([{
            user_id: USER.active,
            user_email: EMAIL.active,
            action: 'change_password',
            entity_type: 'user',
            entity_id: USER.active,
            changes: { fields: ['password'], after: { password: 'diganti' } },
            ip_address: expect.stringMatching(/^203\.0\.113\./),
        }]);
        const stored = JSON.stringify(rows);
        expect(stored).not.toContain(PASSWORD.active);
        expect(stored).not.toContain(NEW_PASSWORD);

        // Restore the original password for the other cases.
        const again = await post('/change-password', {
            currentPassword: NEW_PASSWORD, newPassword: PASSWORD.active, revokeOtherSessions: true,
        }, cookieHeader(changed));
        expect(again.status).toBe(200);
    });

    it('does not record ordinary session reads', async () => {
        const cookie = cookieHeader(await signIn(EMAIL.active, PASSWORD.active));
        await database.query('DELETE FROM audit_log');
        const session = await auth.handler(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { Cookie: cookie } }));
        expect(session.status).toBe(200);
        await auth.api.getSession({ headers: new Headers({ Cookie: cookie }) });
        expect(await auditRows()).toEqual([]);
    });
});
