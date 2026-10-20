import { describe, expect, it } from 'vitest';
import { addImportPart, buildGoogleSheetsImportPayload, emptyImportTotals } from '@/lib/google-sheets-import';

describe('resumable import totals', () => {
    it('adds each part to the running totals, remembers where to continue, and keeps at most 20 row errors', () => {
        const first = addImportPart(emptyImportTotals(900), { success: true, totalRows: 900, importedRows: 30, duplicateRows: 5,
            skippedRows: 1, errors: Array.from({ length: 15 }, (_, i) => `Row ${i + 1}: a`), startRow: 0, nextRow: 36, prefixHash: 'h1' });
        expect(first).toMatchObject({ success: true, totalRows: 900, processedRows: 36, importedRows: 30, duplicateRows: 5,
            skippedRows: 1, nextRow: 36, prefixHash: 'h1' });
        const second = addImportPart(first, { success: false, totalRows: 900, importedRows: 10, duplicateRows: 0,
            skippedRows: 10, errors: Array.from({ length: 10 }, (_, i) => `Row ${i + 40}: b`), startRow: 36, nextRow: null });
        expect(second).toMatchObject({ success: false, processedRows: 900, importedRows: 40, duplicateRows: 5, skippedRows: 11, nextRow: null });
        expect(second.errors).toHaveLength(20);
        expect(second.errors.at(-1)).toBe('Row 44: b');
    });

    it('treats a response without a resume position as the whole sheet, as older servers send', () => {
        expect(addImportPart(emptyImportTotals(3), { success: true, totalRows: 3, importedRows: 3, duplicateRows: 0, skippedRows: 0, errors: [] }))
            .toMatchObject({ processedRows: 3, importedRows: 3, nextRow: null });
    });
});

describe('Google Sheets import unit contract', () => {
    it('requires and preserves the concrete destination unit', () => {
        expect(() => buildGoogleSheetsImportPayload('sheet-url', '0', ''))
            .toThrow(/Pilih unit kerja/);
        expect(buildGoogleSheetsImportPayload('sheet-url', '234636572', 'unit-a')).toEqual({
            spreadsheetUrl: 'sheet-url',
            gid: '234636572',
            unitKerjaId: 'unit-a',
        });
    });
});
