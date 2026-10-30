import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertValidCloudPlatformEnvironment } from '../config/cloud-platform.js';
import { getObjectStorageConfigurationStatus } from '../config/blob-storage.js';
import { getPublicCapabilities } from '../config/public-capabilities.js';
import { loadMalwareScanConfig, validateMalwareScanConfig } from '../config/malware-scanner.js';
import { validateRuntimeEnv } from '../config/env.js';
import { BlobStorageService } from '../services/blob-storage.service.js';

const source = { NODE_ENV: 'production', SIMSA_APP_MODE: 'full', APP_PROFILE: 'internal',
    SIMSA_CLOUD_PLATFORM: 'local', AUTH_PROVIDER: 'better-auth', OBJECT_STORAGE_PROVIDER: 'disabled',
    DATABASE_URL: 'postgresql://db.example.test/simsa', BETTER_AUTH_SECRET: 'x'.repeat(32),
    BETTER_AUTH_URL: 'https://simsa.example.test', FRONTEND_URL: 'https://simsa.example.test',
    GOOGLE_OAUTH_ENABLED: 'true', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
    MALWARE_SCANNER_MODE: 'disabled', MALWARE_SCAN_WORKER_ENABLED: 'false' };

afterEach(() => vi.unstubAllEnvs());

describe('full internal operation without digital storage', () => {
    it('allows an operational database without synthetic-demo restrictions or storage credentials', () => {
        expect(() => assertValidCloudPlatformEnvironment(source)).not.toThrow();
        expect(() => validateRuntimeEnv('api', source)).not.toThrow();
        expect(getPublicCapabilities(source)).toMatchObject({ mode: 'full', syntheticDataOnly: false,
            capabilities: { metadata: true, files: false, fileUploads: false, externalIntegrations: true } });
    });
    it.each([{ APP_PROFILE: 'integrated' }, { SIMSA_CLOUD_PLATFORM: 'gcp' }, { K_SERVICE: 'simsa-api' }])(
        'retains integrated and GCP storage requirements: %j', override => {
            expect(() => assertValidCloudPlatformEnvironment({ ...source, ...override })).toThrow();
        },
    );
    it('does not permit disabled storage in integrated full mode even when a worker filters storage errors', () => {
        expect(() => assertValidCloudPlatformEnvironment({ APP_PROFILE: 'integrated', SIMSA_APP_MODE: 'full', OBJECT_STORAGE_PROVIDER: 'disabled' }, {
            requireAuth: false, requireStorage: false,
        })).toThrow(/only permitted/);
    });
    it.each(['metadata-demo', 'demoo'])('rejects the removed or unknown application mode %s', mode => {
        expect(() => validateRuntimeEnv('api', { ...source, SIMSA_APP_MODE: mode })).toThrow(/SIMSA_APP_MODE must be full/);
        expect(getPublicCapabilities({ ...source, SIMSA_APP_MODE: mode }).capabilities.files).toBe(false);
    });
    it('reports disabled storage truthfully', () => {
        expect(getObjectStorageConfigurationStatus(source)).toMatchObject({
            provider: 'disabled', configured: false, required: false, ready: false,
            callbackConfigured: false, validationErrors: [],
        });
    });
    it('refuses facade operations even for locators from an existing provider', async () => {
        vi.stubEnv('OBJECT_STORAGE_PROVIDER', 'disabled');
        const service = new BlobStorageService();
        const locator = 'https://fixture.private.blob.vercel-storage.com/surat-masuk/test.pdf';
        const upload = { fileName: 'test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('test') };
        for (const action of [
            () => service.uploadFile(upload), () => service.uploadUntrustedFile(upload),
            () => service.getFile(locator), () => service.downloadFile(locator),
            () => service.deleteFile(locator), () => service.deleteFileGeneration(locator),
            () => service.listFiles(),
        ]) expect(action).toThrow(/dinonaktifkan/);
        await expect(service.copyFile({ sourceUrl: locator, fileName: 'test', mimeType: 'application/pdf', folder: 'test' }))
            .rejects.toThrow(/dinonaktifkan/);
        await expect(service.probeConnectivity()).rejects.toThrow(/dinonaktifkan/);
    });
    it('does not permit a background scanner when file storage is intentionally disabled', () => {
        const active = { ...source, MALWARE_SCANNER_MODE: 'clamav', MALWARE_SCAN_WORKER_ENABLED: 'true',
            CLAMAV_HOST: 'clamav', CLAMAV_TRUSTED_NETWORK: 'true', BLOB_READ_WRITE_TOKEN: 'test-token-only' };
        expect(() => validateMalwareScanConfig(loadMalwareScanConfig(active), 'production', active))
            .toThrow(/disabled storage|storage is disabled/i);
    });
});
