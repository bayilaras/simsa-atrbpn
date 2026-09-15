import { describe, expect, it, vi } from 'vitest';
import { initializeSimsaVercelHandler } from '../../lib/vercel-runtime.mjs';
import { cloudMetadataEnvironment } from '../../../scripts/cloud-metadata-config.mjs';

const productionKey = 'synthetic-production-key-'.repeat(2);
const previewKey = 'synthetic-preview-key-'.repeat(2);
const fixture = (metadata: boolean, overrides: Record<string, string> = {}): Record<string, string> => ({
    ...(metadata ? cloudMetadataEnvironment : {}),
    VERCEL: '1', VERCEL_ENV: 'preview', SIMSA_PREVIEW_ENABLED: 'true',
    SIMSA_VERCEL_METADATA_ENABLED: metadata ? 'true' : 'false',
    PREVIEW_DATABASE_URL: 'postgresql://simsa_api:synthetic@ep-preview.region.aws.neon.tech/neondb?sslmode=verify-full',
    PREVIEW_BETTER_AUTH_SECRET: 'synthetic-preview-auth-secret-'.repeat(2),
    PREVIEW_BETTER_AUTH_URL: 'https://preview.example.test', PREVIEW_FRONTEND_URL: 'https://preview.example.test',
    PREVIEW_BLOB_READ_WRITE_TOKEN: 'synthetic-preview-blob-token',
    PREVIEW_GOOGLE_CLIENT_ID: 'synthetic-google-client', PREVIEW_GOOGLE_CLIENT_SECRET: 'synthetic-google-secret',
    PREVIEW_VERCEL_BLOB_CALLBACK_URL: 'https://callback.preview.example.test',
    RATE_LIMIT_KEY_SECRET: productionKey, ...overrides,
});

describe.each([false, true])('Preview rate limit key isolation (metadata=%s)', metadata => {
    it('removes inherited keys before app import when no separate Preview key was configured', async () => {
        const environment = fixture(metadata);
        const loadApp = vi.fn(async () => {
            expect(environment.RATE_LIMIT_KEY_SECRET || '').toBe('');
            expect(environment.BETTER_AUTH_SECRET).toBe(environment.PREVIEW_BETTER_AUTH_SECRET);
            return { default: () => {} };
        });
        await initializeSimsaVercelHandler({ environment, loadApp });
        expect(loadApp).toHaveBeenCalledOnce();
    });
    it('selects only an independently provisioned Preview rate limit key', async () => {
        const environment = fixture(metadata, { PREVIEW_RATE_LIMIT_KEY_SECRET: previewKey });
        const loadApp = vi.fn(async () => {
            expect(environment.RATE_LIMIT_KEY_SECRET).toBe(previewKey);
            return { default: () => {} };
        });
        await initializeSimsaVercelHandler({ environment, loadApp });
        expect(loadApp).toHaveBeenCalledOnce();
    });
    it.each(['short', ' '.repeat(40), productionKey])('rejects a malformed or copied key before app import', async key => {
        const environment = fixture(metadata, { PREVIEW_RATE_LIMIT_KEY_SECRET: key });
        const loadApp = vi.fn();
        await initializeSimsaVercelHandler({ environment, loadApp });
        expect(loadApp).not.toHaveBeenCalled();
    });
});
