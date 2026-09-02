import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateRuntimeEnv } from '../config/env.js';

const database = { DATABASE_URL: 'postgresql://db.example.test/simsa' };

describe('runtime-specific environment validation', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('can import shared config in production without an API auth secret', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('BETTER_AUTH_SECRET', '');
        vi.resetModules();

        const sharedConfig = await import('../config/env.js');

        expect(sharedConfig.env.BETTER_AUTH_SECRET).toBe(
            'dev-only-insecure-secret-do-not-use-in-production',
        );
    });

    it('validates a malware worker without API OAuth or auth secrets', () => {
        expect(() => validateRuntimeEnv('malware-worker', {
            ...database,
            NODE_ENV: 'production',
            APP_PROFILE: 'internal',
            MALWARE_SCANNER_MODE: 'clamav',
            MALWARE_SCAN_WORKER_ENABLED: 'true',
            MALWARE_SCAN_WORKER_RUNTIME: 'external',
            CLAMAV_HOST: 'clamav',
            CLAMAV_TRUSTED_NETWORK: 'true',
            BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_worker_test_value',
        })).not.toThrow();
    });

    it('validates a GCP API that monitors an external malware worker without direct clamd credentials', () => {
        expect(() => validateRuntimeEnv('api', {
            NODE_ENV: 'production',
            APP_PROFILE: 'internal',
            DB_HOST: '127.0.0.1',
            DB_USER: 'simsa-api-runtime@simsa-preview-000.iam',
            DB_NAME: 'simsa',
            DB_PASSWORD: '',
            DB_SSL: 'false',
            SIMSA_CLOUD_PLATFORM: 'gcp',
            AUTH_PROVIDER: 'firebase',
            OBJECT_STORAGE_PROVIDER: 'gcs',
            GOOGLE_CLOUD_PROJECT: 'simsa-preview-000',
            FIREBASE_PROJECT_ID: 'simsa-preview-000',
            FIREBASE_SESSION_CSRF_SECRET: 'x'.repeat(32),
            FIREBASE_APP_CHECK_APP_IDS: '1:123456789012:web:abcdef123456',
            FRONTEND_URL: 'https://simsa-preview-000.web.app',
            GCS_UPLOAD_BUCKET: 'simsa-preview-000-upload',
            GCS_BUCKET: 'simsa-preview-000-final',
            MALWARE_SCANNER_MODE: 'clamav',
            MALWARE_SCAN_WORKER_ENABLED: 'true',
            MALWARE_SCAN_WORKER_RUNTIME: 'external',
            SRIKANDI_ENABLED: 'false',
        })).not.toThrow();
    });

    it('requires the exact final-bucket retention policy on a production GCS scanner', () => {
        const gcsWorker = {
            NODE_ENV: 'production',
            APP_PROFILE: 'internal',
            SIMSA_CLOUD_PLATFORM: 'gcp',
            OBJECT_STORAGE_PROVIDER: 'gcs',
            GOOGLE_CLOUD_PROJECT: 'simsa-preview-000',
            CLOUD_SQL_UNIX_SOCKET: '/cloudsql/simsa-preview-000:asia-southeast2:simsa-postgres',
            DB_USER: 'simsa-malware-worker@simsa-preview-000.iam',
            DB_NAME: 'simsa',
            DB_PASSWORD: '',
            DB_SSL: 'false',
            GCS_UPLOAD_BUCKET: 'simsa-preview-000-upload',
            GCS_BUCKET: 'simsa-preview-000-final',
            MALWARE_SCANNER_MODE: 'clamav',
            MALWARE_SCAN_WORKER_ENABLED: 'true',
            MALWARE_SCAN_WORKER_RUNTIME: 'external',
            CLAMAV_HOST: 'clamav',
            CLAMAV_TRUSTED_NETWORK: 'true',
        };

        expect(() => validateRuntimeEnv('malware-worker', gcsWorker))
            .toThrow(/FINAL_RETENTION_SECONDS is required/);
        expect(() => validateRuntimeEnv('malware-worker', {
            ...gcsWorker,
            FINAL_RETENTION_SECONDS: '2592000',
            FINAL_ORPHAN_RETENTION_MARGIN_SECONDS: '3600',
        })).not.toThrow();
    });

    it('validates a SRIKANDI worker without Blob, malware, OAuth, or API auth settings', () => {
        expect(() => validateRuntimeEnv('srikandi-worker', {
            ...database,
            NODE_ENV: 'production',
            APP_PROFILE: 'integrated',
            SRIKANDI_ENABLED: 'true',
            SRIKANDI_BASE_URL: 'https://srikandi.example.go.id',
            SRIKANDI_SYNC_PATH: '/official/v1/events',
            SRIKANDI_API_TOKEN: 'official-test-token',
            SRIKANDI_CONTRACT_VERSION: 'official-v1',
            SRIKANDI_ACK_FIELD: 'meta.ack',
            SRIKANDI_ACK_VALUE: 'ACCEPTED',
            SRIKANDI_REMOTE_ID_FIELD: 'data.id',
        })).not.toThrow();
    });

    it('rejects an Auth Emulator leak before validating any deployed worker', () => {
        expect(() => validateRuntimeEnv('srikandi-worker', {
            ...database,
            NODE_ENV: 'production',
            FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        })).toThrow(/FIREBASE_AUTH_EMULATOR_HOST must not be set/);
    });

    it('keeps each worker fail-closed for its own dependencies', () => {
        expect(() => validateRuntimeEnv('malware-worker', {
            ...database,
            NODE_ENV: 'production',
            MALWARE_SCANNER_MODE: 'clamav',
            MALWARE_SCAN_WORKER_ENABLED: 'true',
            MALWARE_SCAN_WORKER_RUNTIME: 'external',
            CLAMAV_HOST: 'clamav',
            CLAMAV_TRUSTED_NETWORK: 'true',
        })).toThrow(/BLOB_READ_WRITE_TOKEN/);

        expect(() => validateRuntimeEnv('srikandi-worker', {
            ...database,
            APP_PROFILE: 'integrated',
            SRIKANDI_ENABLED: 'false',
        })).toThrow(/SRIKANDI worker requires/);
    });

    it('retains the full production API requirements', () => {
        expect(() => validateRuntimeEnv('api', {
            ...database,
            NODE_ENV: 'production',
            APP_PROFILE: 'internal',
            BETTER_AUTH_SECRET: 'x'.repeat(32),
            BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_api_test_value',
        })).toThrow(/Google OAuth/);
    });

    it('rejects an unsafe frontend origin used by approval links', () => {
        expect(() => validateRuntimeEnv('api', {
            ...database,
            BETTER_AUTH_SECRET: 'x'.repeat(32),
            FRONTEND_URL: 'javascript:alert(1)',
        })).toThrow(/FRONTEND_URL/);
    });

    it('rejects non-canonical or insecure additional browser trust origins', () => {
        const deployedGcpApi = {
            NODE_ENV: 'development',
            K_SERVICE: 'simsa-api',
            APP_PROFILE: 'internal',
            DB_HOST: '127.0.0.1',
            DB_USER: 'simsa-api-runtime@simsa-preview-000.iam',
            DB_NAME: 'simsa',
            DB_PASSWORD: '',
            SIMSA_CLOUD_PLATFORM: 'gcp',
            AUTH_PROVIDER: 'firebase',
            OBJECT_STORAGE_PROVIDER: 'gcs',
            GOOGLE_CLOUD_PROJECT: 'simsa-preview-000',
            FIREBASE_PROJECT_ID: 'simsa-preview-000',
            FIREBASE_SESSION_CSRF_SECRET: 'x'.repeat(32),
            FIREBASE_APP_CHECK_APP_IDS: '1:123456789012:web:abcdef123456',
            FRONTEND_URL: 'https://simsa-preview-000.web.app',
            GCS_UPLOAD_BUCKET: 'simsa-preview-000-upload',
            GCS_BUCKET: 'simsa-preview-000-final',
            MALWARE_SCANNER_MODE: 'clamav',
            MALWARE_SCAN_WORKER_ENABLED: 'true',
            MALWARE_SCAN_WORKER_RUNTIME: 'external',
            SRIKANDI_ENABLED: 'false',
        };

        expect(() => validateRuntimeEnv('api', {
            ...deployedGcpApi,
            ADDITIONAL_TRUSTED_ORIGINS: 'http://preview.example.test',
        })).toThrow(/deployed origins must use HTTPS/);
        expect(() => validateRuntimeEnv('api', {
            ...deployedGcpApi,
            ADDITIONAL_TRUSTED_ORIGINS: 'https://preview.example.test/path',
        })).toThrow(/canonical HTTP\(S\) origins only/);
        expect(() => validateRuntimeEnv('api', {
            ...deployedGcpApi,
            ADDITIONAL_TRUSTED_ORIGINS: 'https://preview.example.test,https://preview.example.test',
        })).toThrow(/must not contain duplicate origins/);
        expect(() => validateRuntimeEnv('api', {
            ...deployedGcpApi,
            ADDITIONAL_TRUSTED_ORIGINS: 'https://preview.example.test,https://preview-alt.example.test',
        })).not.toThrow();
    });

    it('applies production malware posture on Cloud Run even with a stale NODE_ENV', () => {
        expect(() => validateRuntimeEnv('api', {
            NODE_ENV: 'development',
            K_SERVICE: 'simsa-api',
            APP_PROFILE: 'integrated',
            DB_HOST: '127.0.0.1',
            DB_USER: 'simsa-api-runtime@simsa-preview-000.iam',
            DB_NAME: 'simsa',
            DB_PASSWORD: '',
            DB_SSL: 'false',
            SIMSA_CLOUD_PLATFORM: 'gcp',
            AUTH_PROVIDER: 'firebase',
            OBJECT_STORAGE_PROVIDER: 'gcs',
            GOOGLE_CLOUD_PROJECT: 'simsa-preview-000',
            FIREBASE_PROJECT_ID: 'simsa-preview-000',
            FIREBASE_SESSION_CSRF_SECRET: 'x'.repeat(32),
            FIREBASE_APP_CHECK_APP_IDS: '1:123456789012:web:abcdef123456',
            FRONTEND_URL: 'https://simsa-preview-000.web.app',
            GCS_UPLOAD_BUCKET: 'simsa-preview-000-upload',
            GCS_BUCKET: 'simsa-preview-000-final',
            MALWARE_SCANNER_MODE: 'disabled',
            MALWARE_SCAN_WORKER_ENABLED: 'false',
            SRIKANDI_ENABLED: 'false',
        })).toThrow(/required outside the internal quarantine-only profile/);
    });

    it('pins GCP runtime database access to this project Auth Proxy and IAM principal', () => {
        const deployedGcpApi = {
            NODE_ENV: 'production',
            K_SERVICE: 'simsa-api',
            APP_PROFILE: 'internal',
            DB_HOST: '127.0.0.1',
            DB_USER: 'simsa-api-runtime@simsa-preview-000.iam',
            DB_NAME: 'simsa',
            DB_PASSWORD: '',
            DB_SSL: 'false',
            SIMSA_CLOUD_PLATFORM: 'gcp',
            AUTH_PROVIDER: 'firebase',
            OBJECT_STORAGE_PROVIDER: 'gcs',
            GOOGLE_CLOUD_PROJECT: 'simsa-preview-000',
            FIREBASE_PROJECT_ID: 'simsa-preview-000',
            FIREBASE_SESSION_CSRF_SECRET: 'x'.repeat(32),
            FIREBASE_APP_CHECK_APP_IDS: '1:123456789012:web:abcdef123456',
            FRONTEND_URL: 'https://simsa-preview-000.web.app',
            GCS_UPLOAD_BUCKET: 'simsa-preview-000-upload',
            GCS_BUCKET: 'simsa-preview-000-final',
            MALWARE_SCANNER_MODE: 'clamav',
            MALWARE_SCAN_WORKER_ENABLED: 'true',
            MALWARE_SCAN_WORKER_RUNTIME: 'external',
            SRIKANDI_ENABLED: 'false',
        };

        expect(() => validateRuntimeEnv('api', {
            ...deployedGcpApi,
            DATABASE_URL: 'postgresql://other.example.test/simsa',
        })).toThrow(/must use the local Cloud SQL Auth Proxy/);
        expect(() => validateRuntimeEnv('api', {
            ...deployedGcpApi,
            DB_USER: 'simsa-api-runtime@simsa-production-000.iam',
        })).toThrow(/environment service-account IAM database principal/);
        expect(() => validateRuntimeEnv('api', {
            ...deployedGcpApi,
            DB_HOST: '',
            CLOUD_SQL_UNIX_SOCKET: '/cloudsql/simsa-production-000:asia-southeast2:simsa-postgres',
        })).toThrow(/must belong to this environment project/);
        expect(() => validateRuntimeEnv('api', {
            ...deployedGcpApi,
            DB_PASSWORD: 'static-password',
        })).toThrow(/DB_PASSWORD must be empty/);
    });

    it('requires a reachable Blob callback origin outside Vercel and on Preview', () => {
        const productionApi = {
            ...database,
            NODE_ENV: 'production',
            APP_PROFILE: 'internal',
            BETTER_AUTH_SECRET: 'x'.repeat(32),
            BETTER_AUTH_URL: 'https://simsa.example.go.id',
            FRONTEND_URL: 'https://simsa.example.go.id',
            GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
            GOOGLE_CLIENT_SECRET: 'oauth-test-secret',
            BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_api_test_value',
            MALWARE_SCANNER_MODE: 'disabled',
            SRIKANDI_ENABLED: 'false',
        };

        expect(() => validateRuntimeEnv('api', productionApi))
            .toThrow(/VERCEL_BLOB_CALLBACK_URL/);
        expect(() => validateRuntimeEnv('api', {
            ...productionApi,
            VERCEL_BLOB_CALLBACK_URL: 'https://api.example.go.id',
        })).not.toThrow();
        expect(() => validateRuntimeEnv('api', {
            ...productionApi,
            VERCEL: '1',
            VERCEL_ENV: 'production',
        })).not.toThrow();
        expect(() => validateRuntimeEnv('api', {
            ...productionApi,
            VERCEL: '1',
            VERCEL_ENV: 'preview',
        })).toThrow(/Deployment Protection/);
        expect(() => validateRuntimeEnv('api', {
            ...productionApi,
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            VERCEL_BLOB_CALLBACK_URL: 'https://simsa-backend-git-feature-bayilaras-projects.vercel.app',
        })).toThrow(/unprotected custom HTTPS origin/);
        expect(() => validateRuntimeEnv('api', {
            ...productionApi,
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            VERCEL_BLOB_CALLBACK_URL: 'https://callback-preview.example.go.id',
        })).not.toThrow();
    });
});
