import { describe, expect, it } from 'vitest';
import { archiveUploadError, regulatorySourceUploadError } from './archive-upload';

describe('PDF upload browser policy', () => {
    it('accepts exactly 10 MiB with case-insensitive PDF extension', () => {
        expect(archiveUploadError({ name: 'arsip.PDF', type: 'application/pdf', size: 10_485_760 })).toBeNull();
    });
    it.each([
        { name: 'arsip.pdf', type: 'application/pdf', size: 10_485_761 },
        { name: 'arsip.exe', type: 'application/pdf', size: 10 },
        { name: 'arsip.pdf', type: 'image/png', size: 10 },
        { name: 'arsip.pdf', type: 'application/pdf', size: 0 },
    ])('rejects invalid selection before a request: %j', file => {
        expect(archiveUploadError(file)).toEqual(expect.any(String));
    });
});

describe('regulatory PDF source policy', () => {
    it.each([10_485_761, 52_428_800])('accepts a source PDF of %i bytes while the business cap stays 10 MiB', size => {
        const file = { name: 'peraturan.PDF', type: 'application/pdf', size };
        expect(regulatorySourceUploadError(file)).toBeNull();
        expect(archiveUploadError(file)).toContain('10 MiB');
    });

    it('rejects one byte above 50 MiB', () => {
        expect(regulatorySourceUploadError({ name: 'peraturan.pdf', type: 'application/pdf', size: 52_428_801 }))
            .toContain('50 MiB');
    });

    it.each([
        { name: 'peraturan.exe', type: 'application/pdf', size: 1 },
        { name: 'peraturan.pdf', type: 'image/png', size: 1 },
        { name: 'peraturan.pdf', type: 'application/pdf', size: 0 },
        { name: 'peraturan.pdf', type: 'application/pdf', size: 1.5 },
    ])('preserves PDF type and positive integer size requirements: %j', file => {
        expect(regulatorySourceUploadError(file)).toEqual(expect.any(String));
    });
});
