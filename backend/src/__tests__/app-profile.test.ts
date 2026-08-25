import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../app.js';
import {
    getPublicAppMetadata,
    loadAppProfile,
    validateAppProfileEnvironment,
} from '../config/app-profile.js';
import { env } from '../config/env.js';
import {
    assertValidSrikandiEnvironment,
    buildSrikandiConfig,
    srikandiConfig,
} from '../config/srikandi.js';

describe('backend application profile', () => {
    it('defaults to the lightweight internal profile', () => {
        expect(loadAppProfile({})).toBe('internal');
    });

    it('rejects unknown profiles instead of silently changing deployment behavior', () => {
        expect(() => loadAppProfile({ APP_PROFILE: 'public' })).toThrow(
            /APP_PROFILE must be one of: internal, integrated/,
        );
    });

    it('keeps SRIKANDI disabled and non-blocking for the internal profile', () => {
        const source = {
            APP_PROFILE: 'internal',
            SRIKANDI_ENABLED: 'false',
            // These unused settings must not turn a disabled integration into
            // an internal-profile startup dependency.
            SRIKANDI_TIMEOUT_MS: 'not-a-number',
            SRIKANDI_BASE_URL: 'not-a-url',
        };

        expect(buildSrikandiConfig(source).enabled).toBe(false);
        expect(() => validateAppProfileEnvironment('internal', source)).not.toThrow();
        expect(() => assertValidSrikandiEnvironment(source)).not.toThrow();
    });

    it('forbids accidental external delivery from the internal profile', () => {
        expect(() => validateAppProfileEnvironment('internal', {
            APP_PROFILE: 'internal',
            SRIKANDI_ENABLED: 'true',
        })).toThrow(/requires APP_PROFILE=integrated/);
    });

    it('keeps external integration optional in the integrated profile', () => {
        const source = {
            APP_PROFILE: 'integrated',
            SRIKANDI_ENABLED: 'false',
        };

        expect(() => validateAppProfileEnvironment('integrated', source)).not.toThrow();
        expect(() => assertValidSrikandiEnvironment(source)).not.toThrow();
    });

    it('permits enabled SRIKANDI only in the integrated profile with a complete contract', () => {
        const source = {
            APP_PROFILE: 'integrated',
            SRIKANDI_ENABLED: 'true',
            SRIKANDI_BASE_URL: 'https://srikandi.example.go.id',
            SRIKANDI_SYNC_PATH: '/official/v1/archive-events',
            SRIKANDI_API_TOKEN: 'unit-test-token',
            SRIKANDI_CONTRACT_VERSION: 'official-v1',
            SRIKANDI_ACK_FIELD: 'meta.ack',
            SRIKANDI_ACK_VALUE: 'ACCEPTED',
            SRIKANDI_REMOTE_ID_FIELD: 'data.id',
        };

        expect(() => validateAppProfileEnvironment('integrated', source)).not.toThrow();
        expect(() => assertValidSrikandiEnvironment(source)).not.toThrow();
    });

    it('publishes only bounded, non-secret profile metadata', () => {
        const metadata = getPublicAppMetadata('integrated', true);

        expect(metadata).toEqual({
            profile: 'integrated',
            externalIntegrations: { srikandi: { enabled: true } },
        });
        const serialized = JSON.stringify(metadata).toLowerCase();
        for (const forbidden of [
            'token',
            'credential',
            'baseurl',
            'endpoint',
            'validationerror',
            'database',
            'scanner',
        ]) {
            expect(serialized).not.toContain(forbidden);
        }
    });

    it.each(['/health', '/api/health'])('returns sanitized metadata from %s', async (path) => {
        const response = await request(app).get(path).expect(200);

        expect(response.body.application).toEqual(
            getPublicAppMetadata(env.APP_PROFILE, srikandiConfig.enabled),
        );
        expect(Object.keys(response.body.application).sort()).toEqual([
            'externalIntegrations',
            'profile',
        ]);
    });
});
