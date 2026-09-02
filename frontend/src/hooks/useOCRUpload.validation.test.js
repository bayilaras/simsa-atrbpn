import { describe, expect, it } from 'vitest';
import { validateNewBulkFiles } from './useOCRUpload';

function file(size, type = 'application/pdf') {
    return { size, type };
}

describe('bulk upload browser limits', () => {
    it('allows exactly 100 MB and rejects a larger aggregate selection', () => {
        const exact = validateNewBulkFiles(
            [file(50 * 1024 * 1024)],
            [file(50 * 1024 * 1024)],
        );
        expect(exact.error).toBeNull();

        const over = validateNewBulkFiles(
            [file(50 * 1024 * 1024), file(1)],
            [file(50 * 1024 * 1024)],
        );
        expect(over).toEqual({
            files: [],
            error: 'Ukuran total satu batch tidak boleh melebihi 100 MB',
        });
    });

    it('rejects an oversized file and warns when non-PDF files are ignored', () => {
        expect(validateNewBulkFiles([], [file(50 * 1024 * 1024 + 1)])).toEqual({
            files: [],
            error: 'Ukuran satu file tidak boleh melebihi 50 MB',
        });

        const pdf = file(1024);
        const mixed = validateNewBulkFiles([], [pdf, file(100, 'image/png')]);
        expect(mixed.files).toEqual([pdf]);
        expect(mixed.error).toMatch(/bukan PDF/);
    });
});
