import { describe, expect, it } from 'vitest';
import { ARCHIVE_UPLOAD_MAX_BYTES, assertPdfUpload } from '../config/archive-upload.js';

describe('PDF archive upload policy', () => {
    it('accepts exactly 10 MiB and rejects one byte more', () => {
        expect(ARCHIVE_UPLOAD_MAX_BYTES).toBe(10_485_760);
        expect(() => assertPdfUpload('ARSIP.PDF', 'application/pdf', 10_485_760, Buffer.from('%PDF-1.7'))).not.toThrow();
        expect(() => assertPdfUpload('arsip.pdf', 'application/pdf', 10_485_761, Buffer.from('%PDF-1.7'))).toThrow(expect.objectContaining({ statusCode: 413 }));
    });
    it.each([
        ['arsip.pdf.exe', 'application/pdf', 8, '%PDF-1.7'],
        ['arsip.pdf', 'image/png', 8, '%PDF-1.7'],
        ['arsip.pdf', 'application/pdf', 8, 'not PDF!'],
        ['arsip.pdf', 'application/pdf', 4, '%PDF'],
        ['arsip.pdf', 'application/pdf', 0, ''],
    ])('rejects invalid extension, MIME, header or empty file: %s/%s/%i', (name, type, size, bytes) => {
        expect(() => assertPdfUpload(name, type, size, Buffer.from(bytes))).toThrow(expect.objectContaining({ statusCode: 400 }));
    });
});
