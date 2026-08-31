import { describe, expect, it } from 'vitest';
import {
    assertValidCloudPlatformEnvironment,
    buildCloudPlatformConfig,
} from '../config/cloud-platform.js';

const productionGcp = {
    NODE_ENV: 'production',
    K_SERVICE: 'simsa-api',
    GOOGLE_CLOUD_PROJECT: 'simsa-production',
    FIREBASE_APP_CHECK_APP_IDS: '1:123456789012:web:abcdef123456',
    FIREBASE_SESSION_CSRF_SECRET: 's'.repeat(32),
    GCS_BUCKET: 'simsa-final-records',
    GCS_UPLOAD_BUCKET: 'simsa-upload-quarantine',
} satisfies NodeJS.ProcessEnv;

describe('cloud platform configuration', () => {
    it('keeps local Better Auth and Vercel Blob as the non-Cloud-Run defaults', () => {
        expect(buildCloudPlatformConfig({})).toMatchObject({
            platform: 'local',
            authProvider: 'better-auth',
            storageProvider: 'vercel-blob',
            projectId: '',
            firebaseProjectId: '',
            firebaseSessionCookieName: '__session',
            firebaseSessionMaxAgeMs: 24 * 60 * 60 * 1000,
            firebaseCheckRevoked: false,
            firebaseAppCheckRequired: false,
            firebaseAppCheckAppIds: [],
            gcsBucket: '',
            gcsUploadBucket: '',
            validationErrors: [],
        });
    });

    it('infers the fail-closed Firebase and GCS profile on production Cloud Run', () => {
        expect(buildCloudPlatformConfig(productionGcp)).toMatchObject({
            platform: 'gcp',
            authProvider: 'firebase',
            storageProvider: 'gcs',
            projectId: 'simsa-production',
            firebaseProjectId: 'simsa-production',
            firebaseCheckRevoked: true,
            firebaseAppCheckRequired: true,
            firebaseAppCheckAppIds: ['1:123456789012:web:abcdef123456'],
            gcsBucket: 'simsa-final-records',
            gcsUploadBucket: 'simsa-upload-quarantine',
            validationErrors: [],
        });
    });

    it('honours explicit provider choices and bounded session duration', () => {
        const config = buildCloudPlatformConfig({
            ...productionGcp,
            NODE_ENV: 'development',
            K_SERVICE: '',
            SIMSA_CLOUD_PLATFORM: ' LOCAL ',
            AUTH_PROVIDER: ' BETTER-AUTH ',
            OBJECT_STORAGE_PROVIDER: ' VERCEL-BLOB ',
            FIREBASE_SESSION_MAX_AGE_HOURS: '48',
            FIREBASE_CHECK_REVOKED: ' FALSE ',
            FIREBASE_APP_CHECK_REQUIRED: 'false',
        });

        expect(config).toMatchObject({
            platform: 'local',
            authProvider: 'better-auth',
            storageProvider: 'vercel-blob',
            firebaseSessionMaxAgeMs: 48 * 60 * 60 * 1000,
            firebaseCheckRevoked: false,
            firebaseAppCheckRequired: false,
            validationErrors: [],
        });
    });

    it('reports missing GCP authorities and invalid bucket or duration values', () => {
        const config = buildCloudPlatformConfig({
            NODE_ENV: 'production',
            K_SERVICE: 'simsa-api',
            GCS_BUCKET: 'invalid..bucket',
            GCS_UPLOAD_BUCKET: '192.168.1.1',
            FIREBASE_SESSION_MAX_AGE_HOURS: '337',
        });

        expect(config.firebaseSessionMaxAgeMs).toBe(24 * 60 * 60 * 1000);
        expect(config.validationErrors).toEqual(expect.arrayContaining([
            'GOOGLE_CLOUD_PROJECT (or FIREBASE_PROJECT_ID) is required on GCP',
            'FIREBASE_PROJECT_ID is required when AUTH_PROVIDER=firebase',
            'FIREBASE_SESSION_CSRF_SECRET must be at least 32 characters in a deployed runtime',
            'FIREBASE_APP_CHECK_APP_IDS is required in a deployed Firebase runtime',
            'GCS_BUCKET is not a valid bucket name',
            'GCS_UPLOAD_BUCKET is not a valid bucket name',
            'FIREBASE_SESSION_MAX_AGE_HOURS must be between 1 and 336 hours',
        ]));
    });

    it('does not silently disable security checks for misspelled booleans', () => {
        const source = {
            ...productionGcp,
            FIREBASE_CHECK_REVOKED: 'ture',
            FIREBASE_APP_CHECK_REQUIRED: 'yes',
        };
        const config = buildCloudPlatformConfig(source);

        expect(config.firebaseCheckRevoked).toBe(true);
        expect(config.firebaseAppCheckRequired).toBe(true);
        expect(config.validationErrors).toEqual(expect.arrayContaining([
            'FIREBASE_CHECK_REVOKED must be true or false',
            'FIREBASE_APP_CHECK_REQUIRED must be true or false',
        ]));
        expect(() => assertValidCloudPlatformEnvironment(source)).toThrow(
            /FIREBASE_CHECK_REVOKED must be true or false/,
        );
    });

    it('rejects malformed or duplicate Firebase App Check app allowlists', () => {
        const malformed = buildCloudPlatformConfig({
            ...productionGcp,
            FIREBASE_APP_CHECK_APP_IDS: 'not-an-app-id',
        });
        expect(malformed.validationErrors).toContain(
            'FIREBASE_APP_CHECK_APP_IDS must contain canonical Firebase Web App IDs',
        );

        const duplicate = productionGcp.FIREBASE_APP_CHECK_APP_IDS;
        expect(buildCloudPlatformConfig({
            ...productionGcp,
            FIREBASE_APP_CHECK_APP_IDS: `${duplicate},${duplicate}`,
        }).validationErrors).toContain(
            'FIREBASE_APP_CHECK_APP_IDS must not contain duplicate app IDs',
        );
    });

    it.each([
        ['production', { ...productionGcp, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }],
        ['Cloud Run', { ...productionGcp, NODE_ENV: 'development', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }],
        ['Vercel', {
            ...productionGcp,
            NODE_ENV: 'development',
            K_SERVICE: '',
            VERCEL: '1',
            FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        }],
    ])('rejects the Firebase Auth emulator in a deployed %s runtime', (_runtime, source) => {
        expect(() => assertValidCloudPlatformEnvironment(source)).toThrow(
            /FIREBASE_AUTH_EMULATOR_HOST must not be set/,
        );
        expect(() => assertValidCloudPlatformEnvironment(source, {
            requireAuth: false,
            requireStorage: false,
        })).toThrow(/FIREBASE_AUTH_EMULATOR_HOST must not be set/);
    });

    it('rejects a downloaded ADC credential file in every deployed runtime', () => {
        const source = {
            ...productionGcp,
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
            ...productionGcp,
            GCS_UPLOAD_BUCKET: productionGcp.GCS_BUCKET,
        };
        expect(buildCloudPlatformConfig(source).validationErrors).toContain(
            'GCS_UPLOAD_BUCKET must be configured and differ from GCS_BUCKET',
        );
        expect(() => assertValidCloudPlatformEnvironment(source)).toThrow(
            /GCS_UPLOAD_BUCKET must be configured and differ from GCS_BUCKET/,
        );

        const omitted = { ...productionGcp };
        delete (omitted as Partial<typeof productionGcp>).GCS_UPLOAD_BUCKET;
        expect(() => assertValidCloudPlatformEnvironment(omitted)).toThrow(
            /GCS_UPLOAD_BUCKET must be configured and differ from GCS_BUCKET/,
        );
    });

    it('rejects cross-environment Firebase and Google Cloud project authorities', () => {
        const source = {
            ...productionGcp,
            FIREBASE_PROJECT_ID: 'simsa-preview',
            GCLOUD_PROJECT: 'simsa-staging',
        };

        expect(buildCloudPlatformConfig(source).validationErrors).toContain(
            'Cloud project authority variables must identify the same project',
        );
        expect(() => assertValidCloudPlatformEnvironment(source)).toThrow(
            /must identify the same project/,
        );
        expect(() => assertValidCloudPlatformEnvironment(source, {
            requireAuth: false,
            requireStorage: false,
        })).toThrow(/must identify the same project/);
    });

    it('treats Cloud Run as a hardened Firebase runtime even when NODE_ENV is stale', () => {
        const source = {
            NODE_ENV: 'development',
            K_SERVICE: 'simsa-api',
            GOOGLE_CLOUD_PROJECT: 'simsa-production',
            FIREBASE_SESSION_CSRF_SECRET: 'short',
            FIREBASE_CHECK_REVOKED: 'false',
            FIREBASE_APP_CHECK_REQUIRED: 'false',
            GCS_BUCKET: 'simsa-final-records',
            GCS_UPLOAD_BUCKET: 'simsa-upload-quarantine',
        };

        expect(buildCloudPlatformConfig(source)).toMatchObject({
            platform: 'gcp',
            authProvider: 'firebase',
            storageProvider: 'gcs',
            firebaseCheckRevoked: false,
            firebaseAppCheckRequired: false,
        });
        expect(() => assertValidCloudPlatformEnvironment(source)).toThrow(
            /FIREBASE_SESSION_CSRF_SECRET must be at least 32 characters in a deployed runtime/,
        );
        expect(buildCloudPlatformConfig(source).validationErrors).toEqual(expect.arrayContaining([
            'FIREBASE_CHECK_REVOKED must remain true in a deployed Firebase runtime',
            'FIREBASE_APP_CHECK_REQUIRED must remain true in a deployed Firebase runtime',
        ]));
    });

    it('rejects legacy provider drift inside a Cloud Run service', () => {
        const source = {
            ...productionGcp,
            SIMSA_CLOUD_PLATFORM: 'local',
            AUTH_PROVIDER: 'better-auth',
            OBJECT_STORAGE_PROVIDER: 'vercel-blob',
        };

        expect(buildCloudPlatformConfig(source).validationErrors).toEqual(expect.arrayContaining([
            'Cloud Run requires SIMSA_CLOUD_PLATFORM=gcp',
        ]));
        expect(() => assertValidCloudPlatformEnvironment(source)).toThrow(
            /Cloud Run requires SIMSA_CLOUD_PLATFORM=gcp/,
        );
    });

    it('keeps Firebase and GCS inseparable from the explicit GCP platform', () => {
        const source = {
            ...productionGcp,
            K_SERVICE: '',
            SIMSA_CLOUD_PLATFORM: 'gcp',
            AUTH_PROVIDER: 'better-auth',
            OBJECT_STORAGE_PROVIDER: 'vercel-blob',
        };

        expect(buildCloudPlatformConfig(source).validationErrors).toEqual(expect.arrayContaining([
            'The GCP platform requires AUTH_PROVIDER=firebase',
            'The GCP platform requires OBJECT_STORAGE_PROVIDER=gcs',
        ]));
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
