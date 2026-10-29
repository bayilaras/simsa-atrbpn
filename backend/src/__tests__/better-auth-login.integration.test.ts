import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { hashCredentialPassword } from '../config/password-hashing.js';
import { applyMigrationTag } from './helpers/rangkaian-p5-pglite.js';
import { bootRangkaianDatabase } from './helpers/rangkaian-pglite.js';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));
vi.mock('../config/rate-limits.js', async importOriginal => ({
    ...await importOriginal<typeof import('../config/rate-limits.js')>(),
    createRateLimiterStore: () => undefined,
}));

const MIGRATION_0052 = '0052_better_auth_account_provider_identity';
const ORIGIN = 'https://simsa.example.test';
const PASSWORD = 'synthetic-password-0052';
const USER = {
    credential: '10000000-0000-4000-8000-000000000611',
    google: '10000000-0000-4000-8000-000000000612',
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
    vi.stubEnv('GOOGLE_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('GOOGLE_OAUTH_ENABLED', 'true');
    vi.resetModules();
    return (await import('../config/auth.js')).auth;
}

// Accounts written before 0052 (by 0015, admin provisioning or Better Auth
// 1.7.1) must keep signing in after the upgrade.
describe('Better Auth sign-in on an account table migrated by 0052', () => {
    let database: PGlite;
    let auth: Awaited<ReturnType<typeof configuredAuth>>;

    beforeAll(async () => {
        database = await bootRangkaianDatabase({ stopBefore: MIGRATION_0052 });
        const passwordHash = await hashCredentialPassword(PASSWORD);
        await database.query(`
            INSERT INTO users (id, email, name, email_verified) VALUES
                ($1, 'kredensial@example.test', 'Pengguna kredensial', false),
                ($2, 'google@example.test', 'Pengguna Google', true)
        `, [USER.credential, USER.google]);
        await database.query(`
            INSERT INTO accounts (user_id, issuer, account_id, provider_id, password) VALUES
                ($1::uuid, 'local:credential', $1::text, 'credential', $3),
                ($2::uuid, 'https://accounts.google.com', 'google-subject-lama', 'google', NULL)
        `, [USER.credential, USER.google, passwordHash]);
        await applyMigrationTag(database, MIGRATION_0052);

        holder.db = drizzle(database, { schema });
        auth = await configuredAuth();
        await auth.$context;
    }, 120_000);

    afterAll(async () => {
        vi.unstubAllEnvs();
        vi.resetModules();
        await database?.close();
    });

    it('passes the startup schema check', async () => {
        const context = await auth.$context;
        await expect(Promise.resolve(context.checkSchema?.())).resolves.toBeUndefined();
    });

    it('signs in a credential account provisioned before 0052 and returns its session', async () => {
        const signIn = await auth.handler(new Request(`${ORIGIN}/api/auth/sign-in/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
            body: JSON.stringify({ email: 'kredensial@example.test', password: PASSWORD }),
        }));
        expect(signIn.status).toBe(200);

        const session = await auth.handler(new Request(`${ORIGIN}/api/auth/get-session`, {
            headers: { Cookie: cookieHeader(signIn) },
        }));
        expect(session.status).toBe(200);
        expect(await session.json()).toMatchObject({ user: { id: USER.credential, email: 'kredensial@example.test' } });

        const wrongPassword = await auth.handler(new Request(`${ORIGIN}/api/auth/sign-in/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
            body: JSON.stringify({ email: 'kredensial@example.test', password: 'synthetic-wrong-password' }),
        }));
        expect(wrongPassword.status).toBe(401);
    });

    it('starts Google sign-in and stores its state on the migrated schema', async () => {
        const response = await auth.handler(new Request(`${ORIGIN}/api/auth/sign-in/social`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
            body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
        }));
        expect(response.status).toBe(200);
        const body = await response.json() as { url: string };
        expect(new URL(body.url).origin).toBe('https://accounts.google.com');
        const stored = await database.query<{ count: number }>('SELECT count(*)::int AS count FROM verifications');
        expect(stored.rows[0].count).toBeGreaterThan(0);
    });

    it('resolves a Google identity linked before 0052 to its owner', async () => {
        const context = await auth.$context;
        const owner = await context.internalAdapter.findAccountOwnerByKey({
            providerId: 'google',
            accountId: 'google-subject-lama',
        });
        expect(owner).toMatchObject({ kind: 'owned', user: { id: USER.google } });
    });

    it('links a new Google identity without issuer and keeps one owner per identity', async () => {
        const context = await auth.$context;
        await context.internalAdapter.linkAccount({
            userId: USER.credential,
            providerId: 'google',
            accountId: 'google-subject-baru',
        });
        const linked = await database.query<{ user_id: string; issuer: string | null }>(`
            SELECT user_id, issuer FROM accounts WHERE provider_id = 'google' AND account_id = 'google-subject-baru'
        `);
        expect(linked.rows).toEqual([{ user_id: USER.credential, issuer: null }]);

        await expect(context.internalAdapter.linkAccount({
            userId: USER.google,
            providerId: 'google',
            accountId: 'google-subject-baru',
        })).rejects.toThrow();
    });
});
