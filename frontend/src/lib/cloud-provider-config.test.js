import { describe, expect, it } from 'vitest';
import { resolveCloudProviderConfig } from './cloud-provider-config';

describe('cloud provider configuration', () => {
    it('defaults to the production providers', () => {
        expect(resolveCloudProviderConfig({})).toEqual({
            authProvider: 'better-auth',
            storageProvider: 'vercel-blob',
        });
    });

    it('normalizes an explicit Better Auth provider', () => {
        expect(resolveCloudProviderConfig({ VITE_AUTH_PROVIDER: ' BETTER-AUTH ' })).toEqual({
            authProvider: 'better-auth',
            storageProvider: 'vercel-blob',
        });
    });

    it('accepts an explicit disabled storage provider for metadata-only deployments', () => {
        expect(resolveCloudProviderConfig({
            VITE_STORAGE_PROVIDER: ' DISABLED ',
        })).toEqual({
            authProvider: 'better-auth',
            storageProvider: 'disabled',
        });
    });

    it('fails closed on unknown or retired provider values', () => {
        expect(() => resolveCloudProviderConfig({ VITE_AUTH_PROVIDER: 'unknown' }))
            .toThrow(/VITE_AUTH_PROVIDER tidak valid/);
        expect(() => resolveCloudProviderConfig({ VITE_AUTH_PROVIDER: 'firebase' }))
            .toThrow(/VITE_AUTH_PROVIDER tidak valid/);
        expect(() => resolveCloudProviderConfig({ VITE_STORAGE_PROVIDER: 'public-bucket' }))
            .toThrow(/VITE_STORAGE_PROVIDER tidak valid/);
    });
});
