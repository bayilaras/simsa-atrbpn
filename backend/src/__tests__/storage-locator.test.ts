import { describe, expect, it } from 'vitest';
import {
    describeLocatorForLog,
    isVercelBlobLocator,
    normalizeStoredObjectLocator,
    requireImmutableObjectGeneration,
} from '../storage/locator.js';

describe('object storage locators', () => {
    it('recognises only authenticated-safe Vercel Blob HTTPS locator shapes', () => {
        expect(isVercelBlobLocator(
            'https://store-id.private.blob.vercel-storage.com/record.pdf',
        )).toBe(true);
        expect(isVercelBlobLocator(
            'blob:https://store-id.public.blob.vercel-storage.com/record.pdf',
        )).toBe(true);

        expect(isVercelBlobLocator('http://store-id.blob.vercel-storage.com/record.pdf')).toBe(false);
        expect(isVercelBlobLocator('https://blob.vercel-storage.com/record.pdf')).toBe(false);
        expect(isVercelBlobLocator(
            'https://store-id.blob.vercel-storage.com.evil.example/record.pdf',
        )).toBe(false);
        expect(isVercelBlobLocator(
            'https://user:password@store-id.blob.vercel-storage.com/record.pdf',
        )).toBe(false);
        expect(isVercelBlobLocator('gs://simsa-private/record.pdf')).toBe(false);
        expect(isVercelBlobLocator('not-a-locator')).toBe(false);
    });

    it('normalizes private Blob locators for authorized reads and refuses Cloud Storage', () => {
        expect(normalizeStoredObjectLocator(
            'blob:https://store-id.private.blob.vercel-storage.com/surat-masuk/final.pdf',
        )).toBe('https://store-id.private.blob.vercel-storage.com/surat-masuk/final.pdf');
        expect(normalizeStoredObjectLocator(
            'https://store-id.private.blob.vercel-storage.com/surat-masuk/final.pdf',
        )).toBe('https://store-id.private.blob.vercel-storage.com/surat-masuk/final.pdf');

        expect(normalizeStoredObjectLocator(
            'gs://simsa-final-private/surat-masuk/user-1/final.pdf',
        )).toBeNull();
        expect(normalizeStoredObjectLocator(
            'https://store-id.private.blob.vercel-storage.com/surat-masuk/final.pdf?token=secret',
        )).toBeNull();
        expect(normalizeStoredObjectLocator(
            'https://store-id.public.blob.vercel-storage.com/surat-masuk/final.pdf',
        )).toBeNull();
        expect(normalizeStoredObjectLocator('https://attacker.example/final.pdf')).toBeNull();
        expect(normalizeStoredObjectLocator(null)).toBeNull();
    });

    it('never binds an object generation to a Blob URL and fails closed on Cloud Storage', () => {
        const vercel = 'https://store-id.private.blob.vercel-storage.com/record.pdf';
        expect(requireImmutableObjectGeneration(vercel, null)).toBeNull();
        expect(requireImmutableObjectGeneration(vercel, undefined)).toBeNull();
        expect(() => requireImmutableObjectGeneration(vercel, '123'))
            .toThrow(/must not carry an object generation/i);
        expect(() => requireImmutableObjectGeneration(
            'gs://simsa-private/surat-masuk/record.pdf',
            '1735689600123456',
        )).toThrow(/Cloud Storage \(gs:\/\/\) locators are not supported/);
    });

    it('describes a locator for logs without the uploaded file name', () => {
        const suffix = 'oYnXSVczoLoBVtX8eKXbRvJ3dFHKyz';
        const blob = `https://store.private.blob.vercel-storage.com/surat-masuk/ND%20Rahasia%20Sengketa%2012-${suffix}.pdf`;
        const described = describeLocatorForLog(blob);

        expect(described).toEqual({
            host: 'store.private.blob.vercel-storage.com',
            folder: 'surat-masuk',
            suffix,
            sha256: expect.stringMatching(/^[0-9a-f]{16}$/),
        });
        expect(JSON.stringify(described)).not.toMatch(/Rahasia|Sengketa/);
        expect(describeLocatorForLog(blob)?.sha256).toBe(described?.sha256);

        expect(describeLocatorForLog('not a url')).toEqual({ sha256: expect.stringMatching(/^[0-9a-f]{16}$/) });
        expect(describeLocatorForLog(null)).toBeNull();
    });
});
