import { describe, expect, it } from 'vitest';
import { validateRuntimeEnv } from '../config/env.js';
import { getPublicCapabilities } from '../config/public-capabilities.js';
import { buildGoogleOAuthConfig } from '../config/google-oauth.js';

const deployedInternal = {
    NODE_ENV: 'production', APP_PROFILE: 'internal', AUTH_PROVIDER: 'better-auth',
    DATABASE_URL: 'postgresql://database.example.test/simsa',
    BETTER_AUTH_SECRET: 'synthetic-secret-for-configuration-tests-only',
    BETTER_AUTH_URL: 'https://simsa.example.test', FRONTEND_URL: 'https://simsa.example.test',
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_synthetic_configuration_test',
    VERCEL_BLOB_CALLBACK_URL: 'https://simsa.example.test',
    MALWARE_SCANNER_MODE: 'disabled', MALWARE_SCAN_WORKER_ENABLED: 'false', SRIKANDI_ENABLED: 'false',
};
const credentials = { GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret' };

describe('explicit internal password-only Google OAuth configuration', () => {
    it('preserves mandatory Google credentials by default in production', () => {
        expect(() => validateRuntimeEnv('api', deployedInternal)).toThrow(/Google OAuth credentials/);
        expect(() => validateRuntimeEnv('api', { ...deployedInternal, ...credentials })).not.toThrow();
    });

    it('accepts explicit password-only login for a deployed internal API', () => {
        const source = { ...deployedInternal, GOOGLE_OAUTH_ENABLED: 'false' };
        expect(() => validateRuntimeEnv('api', source)).not.toThrow();
        expect(getPublicCapabilities(source)).toMatchObject({ mode: 'full', syntheticDataOnly: false,
            authentication: { provider: 'better-auth', googleSignIn: false } });
    });

    it('does not advertise disabled Google even when a complete old credential pair remains', () => {
        const source = { ...deployedInternal, ...credentials, GOOGLE_OAUTH_ENABLED: 'false' };
        expect(() => validateRuntimeEnv('api', source)).not.toThrow();
        expect(getPublicCapabilities(source).authentication.googleSignIn).toBe(false);
        expect(JSON.stringify(getPublicCapabilities(source))).not.toMatch(/synthetic-client|synthetic-secret/);
    });

    it.each(['off', '0', 'disabled', 'tru'])('rejects a mistyped opt-out %s', (flag) => {
        const source = { ...deployedInternal, ...credentials, GOOGLE_OAUTH_ENABLED: flag };
        expect(() => validateRuntimeEnv('api', source)).toThrow(/GOOGLE_OAUTH_ENABLED/);
        expect(getPublicCapabilities(source).authentication.googleSignIn).toBe(false);
    });

    it.each(['true', 'false'])('rejects incomplete credentials even with GOOGLE_OAUTH_ENABLED=%s', (flag) => {
        for (const pair of [{ GOOGLE_CLIENT_ID: 'synthetic-client' }, { GOOGLE_CLIENT_SECRET: 'synthetic-secret' }]) {
            expect(() => validateRuntimeEnv('api', { ...deployedInternal, ...pair, GOOGLE_OAUTH_ENABLED: flag }))
                .toThrow(/GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET.*together/);
        }
    });

    it('does not allow the internal opt-out to alter the integrated profile', () => {
        expect(() => validateRuntimeEnv('api', { ...deployedInternal, ...credentials,
            APP_PROFILE: 'integrated', GOOGLE_OAUTH_ENABLED: 'false' })).toThrow(/GOOGLE_OAUTH_ENABLED=false.*internal/);
    });

    it.each([
        { AUTH_PROVIDER: 'firebase' },
        { SIMSA_CLOUD_PLATFORM: 'gcp' },
        { SIMSA_CLOUD_PLATFORM: 'gcp', AUTH_PROVIDER: 'better-auth' },
    ])('keeps the opt-out outside Firebase/GCP semantics (%j)', (target) => {
        expect(buildGoogleOAuthConfig({ ...deployedInternal, ...target, GOOGLE_OAUTH_ENABLED: 'false' }).validationErrors)
            .toContain('GOOGLE_OAUTH_ENABLED=false requires the internal profile with Better Auth on a non-GCP platform');
    });

    it('keeps Firebase Google capability controlled by Firebase rather than Better Auth credentials', () => {
        const source = { AUTH_PROVIDER: 'firebase', FIREBASE_PROJECT_ID: 'synthetic-project', NODE_ENV: 'test' };
        expect(buildGoogleOAuthConfig(source).validationErrors).toEqual([]);
        expect(getPublicCapabilities(source).authentication).toEqual({ provider: 'firebase', googleSignIn: true, pendingGoogleSignup: false });
    });
});
