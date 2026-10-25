import { describe, expect, it } from 'vitest';
import { validateNewBulkFiles } from './useOCRUpload';

function file(size, type = 'application/pdf') {
    return { size, type, name: type === 'application/pdf' ? 'archive.pdf' : 'image.png' };
}

describe('bulk upload browser limits', () => {
    it('allows exactly 100 MB and rejects a larger aggregate selection', () => {
        const exact = validateNewBulkFiles(
            Array.from({ length: 9 }, () => file(10 * 1024 * 1024)),
            [file(10 * 1024 * 1024)],
        );
        expect(exact.error).toBeNull();

        const over = validateNewBulkFiles(
            [...Array.from({ length: 9 }, () => file(10 * 1024 * 1024)), file(1)],
            [file(10 * 1024 * 1024)],
        );
        expect(over).toEqual({
            files: [],
            error: 'Ukuran total satu batch tidak boleh melebihi 100 MB',
        });
    });

    it('rejects an oversized file and warns when non-PDF files are ignored', () => {
        expect(validateNewBulkFiles([], [file(10 * 1024 * 1024 + 1)])).toEqual({
            files: [],
            error: 'Ukuran satu file tidak boleh melebihi 10 MiB',
        });

        const pdf = file(1024);
        const mixed = validateNewBulkFiles([], [pdf, file(100, 'image/png')]);
        expect(mixed.files).toEqual([pdf]);
        expect(mixed.error).toMatch(/bukan PDF/);
    });

    it('rejects an empty file or a misleading extension before upload', () => {
        expect(validateNewBulkFiles([], [file(0)]).files).toEqual([]);
        expect(validateNewBulkFiles([], [{ ...file(10), name: 'document.exe' }]).files).toEqual([]);
    });
});
