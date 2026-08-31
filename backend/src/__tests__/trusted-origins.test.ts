import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The allow-list is a security boundary: CORS and the Better Auth origin guard
 * both defer to it, so widening it here widens both at once.
 */
async function loadWith(overrides: Record<string, string>) {
    vi.resetModules();
    for (const [key, value] of Object.entries(overrides)) {
        vi.stubEnv(key, value);
    }
    return await import('../config/trusted-origins');
}

describe('trusted origins', () => {
    beforeEach(() => {
        // env.ts refuses to load in production without these
        vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-for-unit-tests');
        vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/test');
        vi.stubEnv('FRONTEND_URL', 'https://simsa-frontend.vercel.app');
        vi.stubEnv('ADDITIONAL_TRUSTED_ORIGINS', '');
        vi.stubEnv('VERCEL_ENV', '');
        vi.stubEnv('NODE_ENV', 'production');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('accepts the configured frontend', async () => {
        const { isTrustedOrigin } = await loadWith({});
        expect(isTrustedOrigin('https://simsa-frontend.vercel.app')).toBe(true);
    });

    it('tolerates a trailing slash in FRONTEND_URL', async () => {
        const { isTrustedOrigin } = await loadWith({ FRONTEND_URL: 'https://simsa-frontend.vercel.app/' });
        expect(isTrustedOrigin('https://simsa-frontend.vercel.app')).toBe(true);
    });

    it('rejects an unrelated origin', async () => {
        const { isTrustedOrigin } = await loadWith({});
        expect(isTrustedOrigin('https://evil.example')).toBe(false);
    });

    it('rejects a look-alike suffix of the allowed host', async () => {
        const { isTrustedOrigin } = await loadWith({});
        expect(isTrustedOrigin('https://simsa-frontend.vercel.app.evil.example')).toBe(false);
    });

    it('rejects a missing or malformed origin', async () => {
        const { isTrustedOrigin } = await loadWith({});
        expect(isTrustedOrigin(undefined)).toBe(false);
        expect(isTrustedOrigin('')).toBe(false);
        expect(isTrustedOrigin('not-a-url')).toBe(false);
    });

    it('accepts extra origins listed in ADDITIONAL_TRUSTED_ORIGINS', async () => {
        const { isTrustedOrigin } = await loadWith({
            ADDITIONAL_TRUSTED_ORIGINS: 'https://simsa.atrbpn.go.id, https://staging.simsa.go.id',
        });
        expect(isTrustedOrigin('https://simsa.atrbpn.go.id')).toBe(true);
        expect(isTrustedOrigin('https://staging.simsa.go.id')).toBe(true);
        expect(isTrustedOrigin('https://evil.example')).toBe(false);
    });

    it('does NOT trust preview URLs in production', async () => {
        const { isTrustedOrigin } = await loadWith({ VERCEL_ENV: 'production' });
        expect(isTrustedOrigin('https://simsa-frontend-git-branch-acme.vercel.app')).toBe(false);
    });

    it('requires every Vercel Preview alias to be configured explicitly', async () => {
        const approvedPreview = 'https://simsa-frontend-git-approved-acme.vercel.app';
        const { isTrustedOrigin } = await loadWith({
            VERCEL_ENV: 'preview',
            ADDITIONAL_TRUSTED_ORIGINS: approvedPreview,
        });

        expect(isTrustedOrigin(approvedPreview)).toBe(true);
        expect(isTrustedOrigin('https://simsa-frontend-git-attacker-acme.vercel.app')).toBe(false);
        expect(isTrustedOrigin('https://unrelated-project.vercel.app')).toBe(false);
    });

    it('does not trust localhost on Cloud Run when NODE_ENV is stale', async () => {
        const { isTrustedOrigin } = await loadWith({
            NODE_ENV: 'development',
            K_SERVICE: 'simsa-api',
        });

        expect(isTrustedOrigin('http://localhost:3000')).toBe(false);
        expect(isTrustedOrigin('http://localhost:3001')).toBe(false);
        expect(isTrustedOrigin('http://localhost:5173')).toBe(false);
    });
});
