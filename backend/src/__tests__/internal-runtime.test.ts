import { describe, expect, it } from 'vitest';
import { internalRuntimeConfig, validateInternalBuild } from '../config/internal-runtime.js';
import { frontendSecurityDirectives } from '../config/frontend-security.js';

const local = {
    SIMSA_INTERNAL_LOCAL: 'true', SIMSA_INTERNAL_PORT: '3000',
    NODE_ENV: 'development', APP_PROFILE: 'internal', SIMSA_CLOUD_PLATFORM: 'local',
    AUTH_PROVIDER: 'better-auth', DATABASE_URL: 'postgresql://user:private@127.0.0.1:55432/simsa_local',
    FRONTEND_URL: 'http://localhost:3000', BETTER_AUTH_URL: 'http://localhost:3000',
    ADDITIONAL_TRUSTED_ORIGINS: 'http://127.0.0.1:3000',
};

describe('internal Windows runtime boundary', () => {
    it('binds full internal mode only to IPv4 loopback', () => {
        expect(internalRuntimeConfig(local)).toEqual({ host: '127.0.0.1', port: 3000 });
    });
    it.each([
        { SIMSA_INTERNAL_LOCAL: '' }, { NODE_ENV: 'production' }, { VERCEL: '1' },
        { K_SERVICE: 'cloud' }, { APP_PROFILE: 'integrated' }, { SIMSA_APP_MODE: 'metadata-demo' },
        { COOKIE_DOMAIN: '.example.com' },
        { SIMSA_CLOUD_PLATFORM: 'gcp' }, { AUTH_PROVIDER: 'firebase' },
        { SIMSA_INTERNAL_PORT: '0' }, { SIMSA_INTERNAL_PORT: '3000oops' },
        { FRONTEND_URL: 'http://192.168.1.2:3000' }, { FRONTEND_URL: 'http://localhost:3001' },
        { BETTER_AUTH_URL: 'http://user:secret@localhost:3000' },
        { ADDITIONAL_TRUSTED_ORIGINS: 'https://example.com' },
        { DATABASE_URL: 'postgresql://user:private@remote.example/simsa' },
        { DATABASE_URL: 'postgresql://user:private@127.0.0.1:5432/simsa_local' },
        { DATABASE_URL: 'postgresql://user:private@127.0.0.1:55432/other_database' },
        { DATABASE_URL: 'postgresql://user:private@127.0.0.1/db?host=remote.example' },
        { DATABASE_URL: 'invalid-private-credential' },
    ])('rejects unsafe or mismatched configuration %j', (override) => {
        expect(() => internalRuntimeConfig({ ...local, ...override })).toThrow();
    });
    it('does not expose credentials in validation errors', () => {
        try { internalRuntimeConfig({ ...local, DATABASE_URL: 'invalid-private-credential' }); }
        catch (error) { expect(String(error)).not.toContain('private-credential'); }
    });
    it('accepts only a matching compiled full frontend', () => {
        const manifest = { schemaVersion: 1, mode: 'full', syntheticDataOnly: false, api: 'same-origin', authProvider: 'better-auth' };
        expect(() => validateInternalBuild(manifest)).not.toThrow();
        for (const changed of [{ mode: 'metadata-demo' }, { api: 'https://remote.example' }, { authProvider: 'firebase' }, { schemaVersion: 2 }, { syntheticDataOnly: true }]) {
            expect(() => validateInternalBuild({ ...manifest, ...changed })).toThrow();
        }
        expect(() => validateInternalBuild(null)).toThrow();
    });
    it('allows local HTTP assets only behind the complete local runtime guard', () => {
        expect(frontendSecurityDirectives({ ...local, SIMSA_FRONTEND_DIST: '/compiled' })).toEqual({ upgradeInsecureRequests: null });
        expect(frontendSecurityDirectives({ ...local, SIMSA_INTERNAL_LOCAL: '', SIMSA_FRONTEND_DIST: '/compiled' })).toEqual({});
        expect(() => frontendSecurityDirectives({ ...local, NODE_ENV: 'production', SIMSA_FRONTEND_DIST: '/compiled' })).toThrow();
    });
});
