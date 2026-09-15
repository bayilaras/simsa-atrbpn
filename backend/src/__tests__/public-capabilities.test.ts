import { describe, expect, it } from 'vitest';
import { getPublicCapabilities } from '../config/public-capabilities.js';

const storage = { NODE_ENV: 'test', BLOB_READ_WRITE_TOKEN: 'synthetic-test-token-only' };

describe('public runtime capabilities', () => {
    it('keeps metadata imports independent from the optional SRIKANDI connector', () => {
        expect(getPublicCapabilities({ SRIKANDI_ENABLED: 'false' }).capabilities.externalIntegrations).toBe(true);
        expect(getPublicCapabilities({ SIMSA_APP_MODE: 'metadata-demo' }).capabilities.externalIntegrations).toBe(false);
    });
    it('keeps full metadata available without pretending unconfigured storage works', () => {
        expect(getPublicCapabilities({ NODE_ENV: 'test' })).toMatchObject({
            mode: 'full', syntheticDataOnly: false,
            capabilities: { metadata: true, files: false, fileUploads: false, letterFileUploads: false },
            authentication: { googleSignIn: false },
        });
    });
    it('offers letter uploads independently while inspected archive uploads remain disabled', () => {
        expect(getPublicCapabilities(storage).capabilities).toMatchObject({ files: true, fileUploads: false, letterFileUploads: true });
        expect(getPublicCapabilities({ ...storage, MALWARE_SCANNER_MODE: 'clamav', CLAMAV_HOST: 'https://wrong.test' }).capabilities)
            .toMatchObject({ files: true, fileUploads: false, letterFileUploads: true });
    });
    it('offers uploads only with valid configured storage and scanner worker', () => {
        const config = { ...storage, MALWARE_SCANNER_MODE: 'clamav' };
        expect(getPublicCapabilities(config).capabilities.fileUploads).toBe(true);
        for (const override of [
            { MALWARE_SCAN_WORKER_ENABLED: 'false' }, { CLAMAV_HOST: 'https://wrong.test' },
            { BLOB_READ_WRITE_TOKEN: '' }, { BLOB_READ_WRITE_TOKEN: 'invalid' },
            { OBJECT_STORAGE_PROVIDER: 'typo' },
        ]) expect(getPublicCapabilities({ ...config, ...override }).capabilities.fileUploads).toBe(false);
    });
    it('keeps GCS letter uploads dependent on the scanner required for storage promotion', () => {
        const config = { NODE_ENV: 'test', SIMSA_CLOUD_PLATFORM: 'local', GOOGLE_CLOUD_PROJECT: 'simsa-test', OBJECT_STORAGE_PROVIDER: 'gcs', GCS_BUCKET: 'simsa-final', GCS_UPLOAD_BUCKET: 'simsa-quarantine' };
        const capabilities = getPublicCapabilities(config).capabilities;
        expect(capabilities.files).toBe(true);
        expect(capabilities).toMatchObject({ letterFileUploads: false, fileUploads: false });
        const enabled = getPublicCapabilities({ ...config, MALWARE_SCANNER_MODE: 'clamav' }).capabilities;
        expect(enabled.fileUploads).toBe(true);
        expect(enabled.letterFileUploads).toBe(true);
    });
    it('does not expose OAuth values and requires both Better Auth credentials', () => {
        const oauth = { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' };
        expect(getPublicCapabilities(oauth).authentication.googleSignIn).toBe(true);
        expect(getPublicCapabilities({ ...oauth, GOOGLE_CLIENT_SECRET: '' }).authentication.googleSignIn).toBe(false);
        expect(JSON.stringify(getPublicCapabilities(oauth))).not.toMatch(/test-client|test-secret/);
    });
    it('keeps demo storage and local social login disabled even with conflicting settings', () => {
        expect(getPublicCapabilities({ ...storage, SIMSA_APP_MODE: 'metadata-demo',
            MALWARE_SCANNER_MODE: 'clamav', GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'test',
        })).toMatchObject({ capabilities: { files: false, fileUploads: false, letterFileUploads: false }, authentication: { googleSignIn: false } });
    });
});
