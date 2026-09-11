import { describe, expect, it } from 'vitest';
import { archiveUploadError } from './archive-upload';

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
