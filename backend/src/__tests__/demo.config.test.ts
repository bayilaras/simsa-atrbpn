import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    getDemoListenHost,
    getPublicCapabilities,
    loadAppMode,
    validateDemoEnvironment,
} from '../config/demo.js';
import { validateRuntimeEnv } from '../config/env.js';
import { assertValidCloudPlatformEnvironment } from '../config/cloud-platform.js';
import { getObjectStorageConfigurationStatus } from '../config/blob-storage.js';
import { BlobStorageService } from '../services/blob-storage.service.js';
import { frontendSecurityDirectives } from '../config/frontend-security.js';

const localDemo = {
    NODE_ENV: 'test', SIMSA_APP_MODE: 'metadata-demo', APP_PROFILE: 'internal',
    SIMSA_DEMO_DATA_ACKNOWLEDGED: 'true', SIMSA_DEMO_DATABASE: 'simsa_demo_test',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/simsa_demo_test',
    OBJECT_STORAGE_PROVIDER: 'disabled', BETTER_AUTH_SECRET: 'test-only-secret-'.repeat(4),
    FRONTEND_URL: 'http://localhost:3000', MALWARE_SCANNER_MODE: 'disabled',
    MALWARE_SCAN_WORKER_ENABLED: 'false', SRIKANDI_ENABLED: 'false',
};
const gcpDemo = {
    ...localDemo, NODE_ENV: 'production', K_SERVICE: 'simsa-demo-api',
    SIMSA_CLOUD_PLATFORM: 'gcp', DATABASE_URL: '', DB_HOST: '127.0.0.1',
    DB_USER: 'simsa-api-runtime@simsa-demo-test.iam', DB_NAME: 'simsa_demo_test',
    DB_PASSWORD: '', AUTH_PROVIDER: 'firebase', FIREBASE_PROJECT_ID: 'simsa-demo-test',
    FIREBASE_SESSION_CSRF_SECRET: 'x'.repeat(48), FIREBASE_CHECK_REVOKED: 'true',
    FIREBASE_APP_CHECK_REQUIRED: 'true', FIREBASE_APP_CHECK_APP_IDS: '1:123456789012:web:abcdef123456',
    FRONTEND_URL: 'https://simsa-demo.example.test',
};

afterEach(() => vi.unstubAllEnvs());

describe('isolated metadata demo configuration', () => {
    it('keeps full mode by default and rejects typos', () => {
        expect(loadAppMode({})).toBe('full');
        expect(() => loadAppMode({ SIMSA_APP_MODE: 'demoo' })).toThrow();
        expect(getPublicCapabilities(localDemo)).toEqual({
            mode: 'metadata-demo', syntheticDataOnly: true,
            capabilities: { metadata: true, files: false, externalIntegrations: false },
        });
    });
    it('binds only a local Better Auth metadata demo to loopback', () => {
        expect(getDemoListenHost({ SIMSA_APP_MODE: 'metadata-demo' })).toBe('127.0.0.1');
        expect(getDemoListenHost({
            SIMSA_APP_MODE: 'metadata-demo',
            AUTH_PROVIDER: 'better-auth',
            SIMSA_DEMO_LOCAL_AUTH: 'true',
        })).toBe('127.0.0.1');

        expect(getDemoListenHost({ SIMSA_APP_MODE: 'full', AUTH_PROVIDER: 'better-auth' }))
            .toBeUndefined();
        expect(getDemoListenHost({ SIMSA_APP_MODE: 'metadata-demo', AUTH_PROVIDER: 'firebase' }))
            .toBeUndefined();
        expect(getDemoListenHost({
            SIMSA_APP_MODE: 'metadata-demo',
            AUTH_PROVIDER: 'firebase',
            NODE_ENV: 'production',
            K_SERVICE: 'simsa-demo',
        })).toBeUndefined();
    });
    it('validates a local fixture and a fully configured keyless GCP demo API', () => {
        expect(() => validateRuntimeEnv('api', localDemo)).not.toThrow();
        expect(() => validateRuntimeEnv('api', gcpDemo)).not.toThrow();
    });
    it.each(['malware-worker', 'srikandi-worker', 'storage-events', 'blob-reconciliation'])(
        'rejects a demo %s before doing work', runtime => {
            expect(() => validateDemoEnvironment(runtime, localDemo)).toThrow(/does not run/);
        },
    );
    it.each([
        { SIMSA_DEMO_DATA_ACKNOWLEDGED: '' }, { SIMSA_DEMO_DATABASE: 'simsa_production' },
        { DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/simsa' }, { DB_NAME: 'simsa' },
        { OBJECT_STORAGE_PROVIDER: 'gcs' }, { GCS_BUCKET: 'real-archive' },
        { BLOB_READ_WRITE_TOKEN: 'token-must-not-be-used' }, { SRIKANDI_ENABLED: 'true' },
        { MALWARE_SCANNER_MODE: 'clamav' }, { MALWARE_SCAN_WORKER_ENABLED: 'true' },
        { SMTP_HOST: 'mail.example.test' }, { SMTP_PASS: 'secret' }, { APP_PROFILE: 'integrated' },
    ])('rejects conflicting demo configuration %j', override => {
        expect(() => validateRuntimeEnv('api', { ...localDemo, ...override })).toThrow();
    });
    it.each([
        { AUTH_PROVIDER: 'better-auth' }, { FIREBASE_APP_CHECK_REQUIRED: 'false' },
        { FIREBASE_CHECK_REVOKED: 'false' }, { FIREBASE_APP_CHECK_APP_IDS: '' },
        { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' },
        { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' }, { FRONTEND_URL: 'http://demo.test' },
        { DATABASE_URL: localDemo.DATABASE_URL }, { DB_PASSWORD: 'password' },
    ])('preserves deployed Firebase and GCP protections %j', override => {
        expect(() => validateRuntimeEnv('api', { ...gcpDemo, ...override })).toThrow();
    });
    it('does not permit disabled storage in full mode even when a worker filters storage errors', () => {
        expect(() => assertValidCloudPlatformEnvironment({ OBJECT_STORAGE_PROVIDER: 'disabled' }, {
            requireAuth: false, requireStorage: false,
        })).toThrow(/only permitted/);
    });
    it('reports disabled storage truthfully', () => {
        expect(getObjectStorageConfigurationStatus(localDemo)).toMatchObject({
            provider: 'disabled', configured: false, required: false, ready: false,
            callbackConfigured: false, validationErrors: [],
        });
    });
    it('refuses facade operations even for locators from an existing provider', async () => {
        vi.stubEnv('SIMSA_APP_MODE', 'metadata-demo');
        const service = new BlobStorageService();
        const locator = 'https://fixture.private.blob.vercel-storage.com/surat-masuk/test.pdf';
        const upload = { fileName: 'test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('test') };
        for (const action of [
            () => service.uploadFile(upload), () => service.uploadUntrustedFile(upload),
            () => service.getFile(locator), () => service.downloadFile(locator),
            () => service.deleteFile(locator), () => service.deleteFileGeneration(locator, '1'),
            () => service.listFiles(),
        ]) expect(action).toThrow(/disabled in metadata demo/);
        await expect(service.copyFile({ sourceUrl: locator, fileName: 'test', mimeType: 'application/pdf', folder: 'test' }))
            .rejects.toThrow(/disabled in metadata demo/);
        await expect(service.probeConnectivity()).rejects.toThrow(/disabled in metadata demo/);
    });
});

describe('hosted Firebase frontend CSP', () => {
    it('leaves API-only and Better Auth policies unchanged', () => {
        expect(frontendSecurityDirectives({ AUTH_PROVIDER: 'firebase' })).toEqual({});
        expect(frontendSecurityDirectives({ SIMSA_FRONTEND_DIST: './public' })).toEqual({});
    });
    it('allows the exact Firebase and reCAPTCHA endpoints needed by the bundled client', () => {
        const directives = frontendSecurityDirectives({ ...gcpDemo, SIMSA_FRONTEND_DIST: './public' });
        expect(directives.frameSrc).toContain('https://simsa-demo-test.firebaseapp.com');
        expect(directives.connectSrc).toContain('https://content-firebaseappcheck.googleapis.com');
        expect(JSON.stringify(directives)).not.toMatch(/unsafe-eval|unsafe-inline|https:\/\/\*/);
    });
    it.each(['https://evil.test', 'good.test; script-src *', '*.test', 'good.test/path', 'good.test:443'])(
        'rejects an invalid auth domain %s', domain => {
            expect(() => frontendSecurityDirectives({ ...gcpDemo, SIMSA_FRONTEND_DIST: './public', FIREBASE_AUTH_DOMAIN: domain })).toThrow();
        },
    );
});
