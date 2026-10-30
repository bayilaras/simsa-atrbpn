import { describe, expect, it } from 'vitest';
import {
    assertValidCloudPlatformEnvironment,
    buildCloudPlatformConfig,
} from '../config/cloud-platform.js';

const productionGcs = {
    NODE_ENV: 'production',
    OBJECT_STORAGE_PROVIDER: 'gcs',
    GOOGLE_CLOUD_PROJECT: 'simsa-production',
    GCS_BUCKET: 'simsa-final-records',
    GCS_UPLOAD_BUCKET: 'simsa-upload-quarantine',
} satisfies NodeJS.ProcessEnv;

describe('cloud platform configuration', () => {
    it('keeps local Better Auth and Vercel Blob as the defaults', () => {
        expect(buildCloudPlatformConfig({})).toMatchObject({
            platform: 'local',
            authProvider: 'better-auth',
            storageProvider: 'vercel-blob',
            projectId: '',
            gcsBucket: '',
            gcsUploadBucket: '',
            validationErrors: [],
        });
    });

    it('does not infer a provider from a Cloud Run service marker', () => {
        expect(buildCloudPlatformConfig({ NODE_ENV: 'production', K_SERVICE: 'simsa-api' })).toMatchObject({
            platform: 'local',
            authProvider: 'better-auth',
            storageProvider: 'vercel-blob',
            validationErrors: [],
        });
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

    it('honours explicit provider choices', () => {
        const config = buildCloudPlatformConfig({
            ...productionGcs,
            NODE_ENV: 'development',
            SIMSA_CLOUD_PLATFORM: ' LOCAL ',
            AUTH_PROVIDER: ' BETTER-AUTH ',
            OBJECT_STORAGE_PROVIDER: ' VERCEL-BLOB ',
        });

        expect(config).toMatchObject({
            platform: 'local',
            authProvider: 'better-auth',
            storageProvider: 'vercel-blob',
            validationErrors: [],
        });
    });

    it('keeps the explicit GCS profile fail-closed in production', () => {
        expect(buildCloudPlatformConfig(productionGcs)).toMatchObject({
            storageProvider: 'gcs',
            projectId: 'simsa-production',
            gcsBucket: 'simsa-final-records',
            gcsUploadBucket: 'simsa-upload-quarantine',
            validationErrors: [],
        });
    });

    it('reports invalid bucket values', () => {
        const config = buildCloudPlatformConfig({
            NODE_ENV: 'production',
            OBJECT_STORAGE_PROVIDER: 'gcs',
            GCS_BUCKET: 'invalid..bucket',
            GCS_UPLOAD_BUCKET: '192.168.1.1',
        });

        expect(config.validationErrors).toEqual(expect.arrayContaining([
            'GCS_BUCKET is not a valid bucket name',
            'GCS_UPLOAD_BUCKET is not a valid bucket name',
        ]));
    });

    it('rejects a downloaded ADC credential file in every deployed runtime', () => {
        const source = {
            ...productionGcs,
            GOOGLE_APPLICATION_CREDENTIALS: '/secrets/service-account.json',
        };

        expect(() => assertValidCloudPlatformEnvironment(source)).toThrow(
            /GOOGLE_APPLICATION_CREDENTIALS must not be set/,
        );
        expect(() => assertValidCloudPlatformEnvironment(source, {
            requireAuth: false,
            requireStorage: false,
        })).toThrow(/use attached ADC\/WIF/);
    });

    it('requires a dedicated GCS quarantine bucket', () => {
        const source = {
            ...productionGcs,
            GCS_UPLOAD_BUCKET: productionGcs.GCS_BUCKET,
        };
        expect(buildCloudPlatformConfig(source).validationErrors).toContain(
            'GCS_UPLOAD_BUCKET must be configured and differ from GCS_BUCKET',
        );
        expect(() => assertValidCloudPlatformEnvironment(source)).toThrow(
            /GCS_UPLOAD_BUCKET must be configured and differ from GCS_BUCKET/,
        );

        const omitted = { ...productionGcs };
        delete (omitted as Partial<typeof productionGcs>).GCS_UPLOAD_BUCKET;
        expect(() => assertValidCloudPlatformEnvironment(omitted)).toThrow(
            /GCS_UPLOAD_BUCKET must be configured and differ from GCS_BUCKET/,
        );
    });

    it('rejects cross-environment Google Cloud project authorities', () => {
        const source = {
            ...productionGcs,
            GCLOUD_PROJECT: 'simsa-staging',
        };

        expect(buildCloudPlatformConfig(source).validationErrors).toContain(
            'Cloud project authority variables must identify the same project',
        );
        expect(() => assertValidCloudPlatformEnvironment(source, {
            requireAuth: false,
            requireStorage: false,
        })).toThrow(/must identify the same project/);
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
