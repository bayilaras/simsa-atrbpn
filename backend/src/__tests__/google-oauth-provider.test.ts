import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseUserInput, parseUserOutput } from 'better-auth/db';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import * as schema from '../db/schema';

vi.mock('../config/database', () => ({ db: {} }));
// Provider registration tests do not run a PostgreSQL store; separate suites
// exercise shared admission, outages and concurrency against the real schema.
vi.mock('../config/rate-limits.js', async importOriginal => ({
    ...await importOriginal<typeof import('../config/rate-limits.js')>(),
    createRateLimiterStore: () => undefined,
}));

async function configuredAuth(flag: string) {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_PROFILE', 'internal');
    vi.stubEnv('AUTH_PROVIDER', 'better-auth');
    vi.stubEnv('SIMSA_CLOUD_PLATFORM', 'local');
    vi.stubEnv('BETTER_AUTH_URL', 'https://simsa.example.test');
    vi.stubEnv('FRONTEND_URL', 'https://simsa.example.test');
    vi.stubEnv('BETTER_AUTH_SECRET', 'synthetic-auth-secret-for-test-configuration');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('GOOGLE_OAUTH_ENABLED', flag);
    vi.resetModules();
    return (await import('../config/auth.js')).auth;
}

afterAll(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('Better Auth password-only provider registration', () => {
    let passwordOnly: Awaited<ReturnType<typeof configuredAuth>>;
    let withGoogle: Awaited<ReturnType<typeof configuredAuth>>;
    // Loading Better Auth's full adapter graph is setup work, not a request
    // deadline. Assertions exercise its real configuration and HTTP handler.
    beforeAll(async () => {
        passwordOnly = await configuredAuth('false');
        withGoogle = await configuredAuth('true');
        await passwordOnly.$context;
        await withGoogle.$context;
        await passwordOnly.handler(new Request('https://simsa.example.test/api/auth/ok'));
    }, 60_000);

    it('removes Google from the actual auth configuration while retaining secured credential login', async () => {
        const auth = passwordOnly;
        expect(auth.options.socialProviders).not.toHaveProperty('google');
        expect(auth.options.emailAndPassword).toMatchObject({ enabled: true, disableSignUp: true });
        expect(auth.options.advanced).toMatchObject({ useSecureCookies: true, disableCSRFCheck: false });
        const response = await auth.handler(new Request('https://simsa.example.test/api/auth/sign-in/social', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://simsa.example.test' },
            body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
        }));
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: 'PROVIDER_NOT_FOUND' });
    });

    it('retains invitation-only Google and disables public credential signup when opted in', async () => {
        const auth = withGoogle;
        expect(auth.options.socialProviders?.google).toMatchObject({
            clientId: 'synthetic-client', disableImplicitSignUp: true, disableSignUp: true,
        });
        expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
    });

    it('returns the current deactivation state through the real database adapter and session serializer', async () => {
        const databaseUser = {
            id: 'synthetic-disabled-user', email: 'disabled@example.test', name: 'Disabled user',
            emailVerified: true, createdAt: new Date('2026-09-14'), updatedAt: new Date('2026-09-14'),
            role: 'admin_unit', unitKerjaId: 'unit-a', isActive: false,
        };
        for (const auth of [passwordOnly, withGoogle]) {
            const fakeDb = {
                _: { fullSchema: schema },
                select: () => ({ from: () => ({ where: async () => [databaseUser] }) }),
            };
            const adapter = drizzleAdapter(fakeDb, { provider: 'pg', usePlural: true, schema })(auth.options);
            const adaptedUser = await adapter.findOne({
                model: 'user', where: [{ field: 'id', value: databaseUser.id }],
            });
            expect(parseUserOutput(auth.options, adaptedUser as typeof databaseUser)).toMatchObject({
                id: databaseUser.id, role: 'admin_unit', unitKerjaId: 'unit-a', isActive: false,
            });
        }
    });

    it('never accepts role, unit, or reactivation from session user input', () => {
        for (const auth of [passwordOnly, withGoogle]) {
            for (const input of [{ role: 'super_admin' }, { unitKerjaId: 'other-unit' }, { isActive: true }]) {
                try {
                    const parsed = parseUserInput(auth.options, input, 'update');
                    expect(parsed).not.toHaveProperty(Object.keys(input)[0]);
                } catch (error) {
                    expect(error).toMatchObject({ body: { code: 'FIELD_NOT_ALLOWED' } });
                }
            }
        }
    });

    it('rejects public account creation in password-only production before any database call', async () => {
        const response = await passwordOnly.handler(new Request('https://simsa.example.test/api/auth/sign-up/email', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://simsa.example.test' },
            body: JSON.stringify({ name: 'Synthetic operator', email: 'operator@example.test', password: 'synthetic-password-only' }),
        }));
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' });
    });
});
