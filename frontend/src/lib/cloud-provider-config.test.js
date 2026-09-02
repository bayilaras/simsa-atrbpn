import { describe, expect, it } from 'vitest';
import { resolveCloudProviderConfig } from './cloud-provider-config';

describe('cloud provider configuration', () => {
    it('keeps the legacy providers as rollback-safe defaults', () => {
        expect(resolveCloudProviderConfig({})).toEqual({
            authProvider: 'better-auth',
            storageProvider: 'vercel-blob',
        });
    });

    it('enables Firebase Auth and GCS independently', () => {
        expect(resolveCloudProviderConfig({
            VITE_AUTH_PROVIDER: ' FIREBASE ',
            VITE_STORAGE_PROVIDER: 'gcs',
        })).toEqual({
            authProvider: 'firebase',
            storageProvider: 'gcs',
        });
    });

    it('fails closed on unknown provider values', () => {
        expect(() => resolveCloudProviderConfig({ VITE_AUTH_PROVIDER: 'unknown' }))
            .toThrow(/VITE_AUTH_PROVIDER tidak valid/);
        expect(() => resolveCloudProviderConfig({ VITE_STORAGE_PROVIDER: 'public-bucket' }))
            .toThrow(/VITE_STORAGE_PROVIDER tidak valid/);
    });
});
