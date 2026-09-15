import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSheetMapping } from '../services/google-sheets-import-mapping.js';
import { DuplicateSuratImportError, suratImportIdentity } from '../services/surat-import-identity.js';

const mocks = vi.hoisted(() => ({ incoming: vi.fn(), outgoing: vi.fn() }));
vi.mock('../services/surat-masuk.service.js', () => ({ suratMasukService: { createImported: mocks.incoming } }));
vi.mock('../services/surat-keluar.service.js', () => ({ suratKeluarService: { createImported: mocks.outgoing } }));
vi.mock('../utils/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }));
import { GoogleDriveImportService } from '../services/google-drive-import.service.js';

const audit = { userId: '11111111-1111-4111-8111-111111111111' };
const headers = ['Nomor Urut', 'No. Surat', 'Tanggal Surat', 'Perihal', 'Dari', 'Kepada'];
const data = ['7', 'SM-2026-actual', '12/09/2026', 'Permohonan data', 'Kantah A', 'Ditjen'];
beforeEach(() => {
    vi.clearAllMocks(); mocks.incoming.mockResolvedValue({ id: 'incoming' }); mocks.outgoing.mockResolvedValue({ id: 'outgoing' });
});

describe('exact Google Sheets column mapping before writes', () => {
    it.each(['surat-masuk', 'surat-keluar'] as const)('keeps sequence and official number distinct for %s', async type => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue([headers, data].map(row => row.join(',')).join('\n'));
        const preview = await service.previewData('sheet', 'Data', 10, {}, type);
        expect(preview).toMatchObject({ importType: type, headerRow: 1, totalRows: 1 });
        expect(preview.mapping).toContainEqual({ field: 'nomorSurat', label: 'Nomor surat', columnIndex: 1, header: 'No. Surat' });
        await (type === 'surat-masuk' ? service.importSuratMasuk('sheet', 'Data', 'unit-a', audit)
            : service.importSuratKeluar('sheet', 'Data', 'unit-a', audit));
        expect(type === 'surat-masuk' ? mocks.incoming : mocks.outgoing).toHaveBeenCalledWith(
            expect.objectContaining({ noUrut: 7, nomorSurat: 'SM-2026-actual', tahun: 2026, tanggalSurat: '2026-09-12' }), audit, {});
    });

    it('normalizes Unicode width, punctuation, underscores and repeated whitespace exactly', () => {
        const mapping = resolveSheetMapping([['Ｎｏ．　Ｓｕｒａｔ', 'TANGGAL_SURAT', '  Perihal  ', 'Pengirim']], 'surat-masuk');
        expect(mapping.columnMap).toMatchObject({ nomorSurat: 0, tanggalSurat: 1, perihal: 2, dari: 3 });
    });

    it('uses the same detected header row in preview and import', async () => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue(['Daftar surat tahun 2026', 'Kantor sintetis', headers.join(','), data.join(',')].join('\n'));
        const preview = await service.previewData('sheet', 'Data');
        expect(preview.headerRow).toBe(3); expect(preview.rows).toEqual([data]);
        expect((await service.importSuratMasuk('sheet', 'Data', 'unit-a', audit)).importedRows).toBe(1);
    });

    it.each([
        ['No Surat', 'Nomor Surat', 'Tanggal', 'Perihal', 'Dari'],
        ['No. Surat', 'No_Surat', 'Tanggal', 'Perihal', 'Dari'],
        ['Nomor Surat', 'Tanggal', 'Tanggal Surat', 'Perihal', 'Dari'],
    ])('rejects ambiguous aliases before preview or writes: %j', async (...ambiguous) => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue([ambiguous.join(','), data.join(',')].join('\n'));
        await expect(service.previewData('sheet', 'Data')).rejects.toMatchObject({ statusCode: 400 });
        await expect(service.importSuratMasuk('sheet', 'Data', 'unit-a', audit)).rejects.toMatchObject({ statusCode: 400 });
        expect(mocks.incoming).not.toHaveBeenCalled(); expect(mocks.outgoing).not.toHaveBeenCalled();
    });

    it('does not infer an unknown header by its position or substring', () => {
        expect(() => resolveSheetMapping([['ID', 'No', 'Jenis', 'Sifat', 'Nomor Urut Surat', 'Tanggal', 'Perihal', 'Dari']], 'surat-masuk')).toThrow('Nomor surat');
    });

    it('does not use a column from another import type as the required counterpart', () => {
        expect(() => resolveSheetMapping([['Nomor Surat', 'Tanggal', 'Perihal', 'Dari']], 'surat-keluar')).toThrow('Kepada');
    });

    it('counts canonical duplicate rejection separately from failed writes', async () => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue([headers, data, data].map(row => row.join(',')).join('\n'));
        mocks.incoming.mockResolvedValueOnce({ id: 'created' }).mockRejectedValueOnce(new DuplicateSuratImportError());
        expect(await service.importSuratMasuk('sheet', 'Data', 'unit-a', audit)).toMatchObject({
            success: true, importedRows: 1, duplicateRows: 1, skippedRows: 0, errors: [],
        });
    });

    it.each([null, '', '2026-99-99', '2026-02-31'])('rejects an unstable/invalid import identity date %s', date => {
        expect(() => suratImportIdentity('masuk', { unitKerjaId: 'unit-a', tahun: 2026,
            nomorSurat: 'SM-1', tanggalSurat: date })).toThrow('Tanggal surat');
    });
});
