import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

const queries = vi.hoisted(() => ({ masuk: vi.fn(), keluar: vi.fn(), arsip: vi.fn() }));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: { findAll: queries.masuk } }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: { findAll: queries.keluar } }));
vi.mock('../services/arsip.service', () => ({ arsipService: { findAll: queries.arsip } }));
const { exportService } = await import('../services/export.service');
const { requireCompleteExport } = await import('../services/export-completeness');

const methods = [
    ['generateExcelSuratMasuk', 'masuk'], ['generatePdfSuratMasuk', 'masuk'],
    ['generateExcelSuratKeluar', 'keluar'], ['generatePdfSuratKeluar', 'keluar'],
    ['generateExcelArsip', 'arsip'], ['generatePdfArsip', 'arsip'],
] as const;

describe('complete bounded exports', () => {
    beforeEach(() => vi.resetAllMocks());

    it('accepts the exact 10,000 row boundary and rejects invalid or undercounted totals', () => {
        const data = Array.from({ length: 10000 }, (_, id) => ({ id }));
        expect(requireCompleteExport({ data, pagination: { total: 10000 } })).toBe(data);
        for (const total of [-1, Number.NaN, 9999]) {
            expect(() => requireCompleteExport({ data, pagination: { total } })).toThrow(/Hasil berubah/);
        }
    });

    it.each(methods)('%s rejects 10,001 matches instead of producing a partial file', async (method, query) => {
        queries[query].mockResolvedValue({ data: [], pagination: { total: 10001 } });
        const filters = { unitKerjaId: 'unit-a', search: 'tanah', securityClassifications: ['biasa'] };
        await expect(exportService[method](filters)).rejects.toMatchObject({
            statusCode: 422, code: 'EXPORT_LIMIT_EXCEEDED', limit: 10000, total: 10001,
        });
        expect(queries[query]).toHaveBeenCalledExactlyOnceWith({ ...filters, page: 1, limit: 10000 });
    });

    it.each(methods)('%s rejects an incomplete page even when total is below the limit', async (method, query) => {
        queries[query].mockResolvedValue({ data: [], pagination: { total: 1 } });
        await expect(exportService[method]({})).rejects.toMatchObject({
            statusCode: 409, code: 'EXPORT_RESULT_CHANGED',
        });
    });

    it('writes all rows of a complete filtered Excel result', async () => {
        queries.masuk.mockResolvedValue({
            data: [{ id: 'visible-record', nomorSurat: 'SM-VISIBLE', tanggalSurat: '2026-09-11', perihal: 'Tanah terpilih' }],
            pagination: { total: 1 },
        });
        const buffer = await exportService.generateExcelSuratMasuk({ unitKerjaId: 'unit-a' });
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);
        const values = workbook.worksheets[0].getSheetValues();
        expect(JSON.stringify(values)).toContain('SM-VISIBLE');
        expect(JSON.stringify(values)).toContain('Tanah terpilih');
    });
});
