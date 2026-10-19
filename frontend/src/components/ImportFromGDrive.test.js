import { describe, expect, it } from 'vitest';
import { buildGoogleSheetsImportPayload } from '@/lib/google-sheets-import';

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
