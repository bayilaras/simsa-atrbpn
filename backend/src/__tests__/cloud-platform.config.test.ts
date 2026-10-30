import { describe, expect, it } from 'vitest';
import {
    assertValidCloudPlatformEnvironment,
    buildCloudPlatformConfig,
} from '../config/cloud-platform.js';

describe('cloud platform configuration', () => {
    it('keeps local Better Auth and Vercel Blob as the defaults', () => {
        expect(buildCloudPlatformConfig({})).toEqual({
            platform: 'local',
            authProvider: 'better-auth',
            storageProvider: 'vercel-blob',
            validationErrors: [],
        });
    });

    it('does not infer a provider from a Cloud Run service marker', () => {
        expect(buildCloudPlatformConfig({ NODE_ENV: 'production', K_SERVICE: 'simsa-api' })).toEqual({
            platform: 'local',
            authProvider: 'better-auth',
            storageProvider: 'vercel-blob',
            validationErrors: [],
        });
    });

    it('honours explicit provider choices', () => {
        expect(buildCloudPlatformConfig({
            NODE_ENV: 'development',
            SIMSA_CLOUD_PLATFORM: ' LOCAL ',
            AUTH_PROVIDER: ' BETTER-AUTH ',
            OBJECT_STORAGE_PROVIDER: ' VERCEL-BLOB ',
        })).toEqual({
            platform: 'local',
            authProvider: 'better-auth',
            storageProvider: 'vercel-blob',
            validationErrors: [],
        });
        expect(buildCloudPlatformConfig({ OBJECT_STORAGE_PROVIDER: 'disabled' }).storageProvider).toBe('disabled');
    });

    it('rejects the removed GCP platform value', () => {
        const source = { SIMSA_CLOUD_PLATFORM: 'gcp' };
        expect(buildCloudPlatformConfig(source)).toMatchObject({ platform: 'local' });
        expect(() => assertValidCloudPlatformEnvironment(source, {
            requireAuth: false,
            requireStorage: false,
        })).toThrow(/SIMSA_CLOUD_PLATFORM must be one of: local/);
    });

    it('rejects the removed Firebase auth provider unless auth is out of scope', () => {
        const source = { AUTH_PROVIDER: 'firebase', FIREBASE_PROJECT_ID: 'simsa-production' };
        expect(buildCloudPlatformConfig(source)).toMatchObject({ authProvider: 'better-auth' });
        expect(() => assertValidCloudPlatformEnvironment(source)).toThrow(/AUTH_PROVIDER must be one of: better-auth/);
        expect(() => assertValidCloudPlatformEnvironment(source, {
            requireAuth: false,
            requireStorage: false,
        })).not.toThrow();
    });

    it('rejects the removed Cloud Storage provider unless storage is out of scope', () => {
        const source = { OBJECT_STORAGE_PROVIDER: 'gcs', GCS_BUCKET: 'simsa-final-records' };
        expect(buildCloudPlatformConfig(source)).toMatchObject({ storageProvider: 'vercel-blob' });
        expect(() => assertValidCloudPlatformEnvironment(source))
            .toThrow(/OBJECT_STORAGE_PROVIDER must be one of: vercel-blob, disabled/);
        expect(() => assertValidCloudPlatformEnvironment(source, {
            requireAuth: false,
            requireStorage: false,
        })).not.toThrow();
    });

    it('can validate a local worker without unrelated auth and storage authorities', () => {
        const config = assertValidCloudPlatformEnvironment({
            NODE_ENV: 'production',
            SIMSA_CLOUD_PLATFORM: 'local',
            AUTH_PROVIDER: 'firebase',
            OBJECT_STORAGE_PROVIDER: 'gcs',
        }, { requireAuth: false, requireStorage: false });

        expect(config.validationErrors.length).toBeGreaterThan(0);
    });
});
