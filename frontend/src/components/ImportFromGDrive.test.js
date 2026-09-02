import { describe, expect, it } from 'vitest';
import { buildGoogleSheetsImportPayload } from '@/lib/google-sheets-import';

describe('Google Sheets import unit contract', () => {
    it('requires and preserves the concrete destination unit', () => {
        expect(() => buildGoogleSheetsImportPayload('sheet-url', 'Data', ''))
            .toThrow(/Pilih unit kerja/);
        expect(buildGoogleSheetsImportPayload('sheet-url', 'Data', 'unit-a')).toEqual({
            spreadsheetUrl: 'sheet-url',
            sheetName: 'Data',
            unitKerjaId: 'unit-a',
        });
    });
});
