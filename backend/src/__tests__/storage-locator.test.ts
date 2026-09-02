import { describe, expect, it } from 'vitest';
import {
    isVercelBlobLocator,
    normalizeStoredObjectLocator,
    parseGcsLocator,
    requireImmutableObjectGeneration,
    toGcsLocator,
} from '../storage/locator.js';

describe('object storage locators', () => {
    it('round-trips Unicode and reserved characters in a canonical GCS locator', () => {
        const locator = toGcsLocator(
            'simsa-private',
            'arsip 2026/Bukti #1-é.pdf',
        );

        expect(locator).toBe(
            'gs://simsa-private/arsip%202026/Bukti%20%231-%C3%A9.pdf',
        );
        expect(parseGcsLocator(locator)).toEqual({
            bucket: 'simsa-private',
            objectName: 'arsip 2026/Bukti #1-é.pdf',
        });
    });

    it.each([
        ['', 'object.pdf'],
        ['simsa-private', ''],
        ['simsa-private', '/absolute.pdf'],
        ['simsa-private', 'folder\\object.pdf'],
        ['simsa-private', '../object.pdf'],
        ['simsa-private', 'folder/../object.pdf'],
        ['simsa-private', 'folder/./object.pdf'],
        ['simsa-private', 'folder//object.pdf'],
        ['INVALID_BUCKET', 'object.pdf'],
        ['bucket/escape', 'object.pdf'],
    ])('refuses to create a non-canonical GCS locator', (bucket, objectName) => {
        expect(() => toGcsLocator(bucket, objectName)).toThrow(/canonical/);
    });

    it.each([
        'https://storage.googleapis.com/simsa-private/object.pdf',
        'gs://missing-object',
        'gs:///missing-bucket',
        'gs://simsa-private/',
        'gs://simsa-private/%E0%A4%A',
        'gs://simsa-private/folder/%2E%2E/object.pdf',
        'gs://simsa-private/folder/%2E/object.pdf',
        'gs://simsa-private/folder//object.pdf',
        'gs://simsa-private/folder%5Cobject.pdf',
        'gs://SIMSA-PRIVATE/folder/object.pdf',
        'gs://simsa-private/folder%2Fobject.pdf',
    ])('rejects malformed or non-canonical GCS input: %s', locator => {
        expect(() => parseGcsLocator(locator)).toThrow();
    });

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
        expect(isVercelBlobLocator('not-a-locator')).toBe(false);
    });

    it('normalizes canonical GCS and legacy private Blob locators for authorized reads', () => {
        expect(normalizeStoredObjectLocator(
            'gs://simsa-final-private/surat-masuk/user-1/final.pdf',
        )).toBe('gs://simsa-final-private/surat-masuk/user-1/final.pdf');
        expect(normalizeStoredObjectLocator(
            'blob:https://store-id.private.blob.vercel-storage.com/surat-masuk/final.pdf',
        )).toBe('https://store-id.private.blob.vercel-storage.com/surat-masuk/final.pdf');

        expect(normalizeStoredObjectLocator(
            'gs://simsa-final-private/surat-masuk/%2E%2E/escape.pdf',
        )).toBeNull();
        expect(normalizeStoredObjectLocator(
            'https://store-id.private.blob.vercel-storage.com/surat-masuk/final.pdf?token=secret',
        )).toBeNull();
        expect(normalizeStoredObjectLocator('https://attacker.example/final.pdf')).toBeNull();
    });

    it('requires generation only for canonical GCS locators', () => {
        expect(requireImmutableObjectGeneration(
            'gs://simsa-private/surat-masuk/record.pdf',
            '1735689600123456',
        )).toBe('1735689600123456');
        expect(() => requireImmutableObjectGeneration(
            'gs://simsa-private/surat-masuk/record.pdf',
            null,
        )).toThrow(/immutable object generation/i);
        expect(() => requireImmutableObjectGeneration(
            'gs://simsa-private/surat-masuk/record.pdf',
            '1e6',
        )).toThrow(/immutable object generation/i);

        const vercel = 'https://store-id.private.blob.vercel-storage.com/record.pdf';
        expect(requireImmutableObjectGeneration(vercel, null)).toBeNull();
        expect(() => requireImmutableObjectGeneration(vercel, '123'))
            .toThrow(/non-GCS.*generation/i);
    });
});
