import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const selectQueue: any[] = [];
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(async () => selectQueue.shift() || []);
    return {
        chain,
        selectQueue,
        createMasuk: vi.fn(),
        createKeluar: vi.fn(),
        ordinaryCreate: vi.fn(),
        createArsip: vi.fn(),
        logs: vi.fn(),
    };
});
vi.mock('../utils/logger', () => ({ createLogger: () => ({ warn: mocks.logs, error: mocks.logs }) }));

vi.mock('../config/database', () => ({ db: mocks.chain }));
vi.mock('../services/surat-masuk.service.js', () => ({
    suratMasukService: { create: mocks.ordinaryCreate, createImported: mocks.createMasuk },
}));
vi.mock('../services/surat-keluar.service.js', () => ({
    suratKeluarService: { create: mocks.ordinaryCreate, createImported: mocks.createKeluar },
}));
vi.mock('../services/arsip.service.js', () => ({
    arsipService: { create: mocks.createArsip },
}));

const { GoogleDriveImportService } = await import('../services/google-drive-import.service.js');
const { migrationService } = await import('../services/migration.service.js');
const { DatabaseError, ValidationError } = await import('../utils/errors.js');
const { DuplicateSuratImportError } = await import('../services/surat-import-identity.js');

const auditContext = {
    userId: '11111111-1111-4111-8111-111111111111',
    userEmail: 'importer@example.test',
    ipAddress: '127.0.0.1',
};

describe('fail-closed canonical imports', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.selectQueue.length = 0;
        mocks.createMasuk.mockResolvedValue({ id: 'surat-masuk-1' });
        mocks.createKeluar.mockResolvedValue({ id: 'surat-keluar-1' });
        mocks.createArsip.mockResolvedValue({ id: 'arsip-1' });
    });

    it('rejects excessive preview and CSV data before any network or database work', async () => {
        const service = new GoogleDriveImportService();
        const source = vi.spyOn(service, 'fetchSheetAsCSV');
        await expect(service.previewData('sheet-id', 'Sheet1', 101)).rejects.toMatchObject({ statusCode: 400 });
        expect(source).not.toHaveBeenCalled();
        source.mockResolvedValue('No,Nomor Surat,Tanggal Surat,Perihal,Dari\n' + Array.from({ length: 1_001 }, (_, i) => `${i},SM-${i},2026-09-12,Arsip,Unit`).join('\n'));
        await expect(service.importSuratMasuk('sheet-id', 'Sheet1', 'unit-a', auditContext)).rejects.toMatchObject({ statusCode: 413 });
        expect(mocks.chain.select).not.toHaveBeenCalled();
        expect(mocks.createMasuk).not.toHaveBeenCalled();
    });

    it('sanitizes synthetic DB/provider row errors in both imports and log metadata', async () => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue('No,Nomor Surat,Tanggal Surat,Perihal,Dari,Kepada\n1,SM-1,2026-09-12,Arsip,Unit A,Unit B');
        const marker = 'SYNTHETIC_SECRET_IMPORT';
        mocks.createMasuk.mockRejectedValueOnce(new DatabaseError(marker));
        const sheets = await service.importSuratMasuk('sheet-id', 'Sheet1', 'unit-a', auditContext);
        mocks.createKeluar.mockRejectedValueOnce(new Error(marker));
        const csv = await migrationService.importSuratKeluar('Nomor Surat,Tanggal Surat,Perihal,Kepada\nSK-1,2026-09-12,Arsip,Unit', 'unit-a', auditContext);
        expect(sheets).toMatchObject({ success: false, importedRows: 0, skippedRows: 1 });
        expect(csv).toMatchObject({ success: false, imported: 0, skipped: 1 });
        expect(JSON.stringify({ sheets, csv, logs: mocks.logs.mock.calls })).not.toContain(marker);
        expect(mocks.logs).toHaveBeenCalled();
        mocks.createMasuk.mockRejectedValueOnce(new ValidationError('Nomor surat tidak sesuai aturan unit.'));
        const domain = await service.importSuratMasuk('sheet-id', 'Sheet1', 'unit-a', auditContext);
        expect(domain.errors[0]).toContain('Nomor surat tidak sesuai aturan unit.');
    });

    it('validates the complete source before importing its first row', async () => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue('No,Nomor Surat,Tanggal Surat,Perihal,Dari\n1,SM-1,2026-09-12,Arsip,Unit\n2,"broken');
        await expect(service.importSuratMasuk('sheet-id', 'Sheet1', 'unit-a', auditContext)).rejects.toMatchObject({ statusCode: 400 });
        expect(mocks.createMasuk).not.toHaveBeenCalled();
    });

    it('stops before a new row write after disconnect during source download', async () => {
        const service = new GoogleDriveImportService();
        const caller = new AbortController();
        vi.spyOn(service, 'fetchSheetAsCSV').mockImplementationOnce(async () => { caller.abort(); return 'No,Nomor Surat,Tanggal Surat,Perihal,Dari\n1,SM-1,2026-09-12,Arsip,Unit'; });
        await expect(service.importSuratMasuk('sheet-id', 'Sheet1', 'unit-a', auditContext, { signal: caller.signal })).rejects.toMatchObject({ statusCode: 499 });
        expect(mocks.createMasuk).not.toHaveBeenCalled();
    });

    it('routes Google Sheets rows through canonical transactional surat creation', async () => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue([
            'No,Nomor Surat,Tanggal Surat,Perihal,Dari',
            '7,SM-7,28/08/2026,Permohonan Data,Kantah Jakarta',
        ].join('\n'));
        mocks.selectQueue.push([]);

        const result = await service.importSuratMasuk(
            'sheet-id',
            'Sheet1',
            'unit-a',
            auditContext,
        );

        expect(result).toMatchObject({ success: true, importedRows: 1 });
        expect(mocks.createMasuk).toHaveBeenCalledWith(
            expect.objectContaining({
                unitKerjaId: 'unit-a',
                nomorSurat: 'SM-7',
                createdBy: auditContext.userId,
            }),
            auditContext,
            {},
        );
    });

    it('uses a stable business fingerprint for numberless Google rows on re-import', async () => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue([
            'No,Nomor Surat,Tanggal Surat,Perihal,Dari',
            '99,-,28/08/2026,Permohonan Data,Kantah Jakarta',
        ].join('\n'));
        mocks.createMasuk.mockResolvedValueOnce({ id: 'imported' }).mockRejectedValueOnce(new DuplicateSuratImportError());

        const first = await service.importSuratMasuk(
            'sheet-id',
            'Sheet1',
            'unit-a',
            auditContext,
        );
        const second = await service.importSuratMasuk(
            'sheet-id',
            'Sheet1',
            'unit-a',
            auditContext,
        );

        expect(first.importedRows).toBe(1);
        expect(second).toMatchObject({ importedRows: 0, duplicateRows: 1 });
        expect(mocks.createMasuk).toHaveBeenCalledTimes(2);
    });

    it('reports a failed critical audit/canonical transaction as a skipped import row', async () => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue([
            'No,Nomor Surat,Tanggal Surat,Perihal,Kepada',
            '1,SK-1,28/08/2026,Undangan Rapat,Kantah Bandung',
        ].join('\n'));
        mocks.selectQueue.push([]);
        mocks.createKeluar.mockRejectedValueOnce(new Error('audit unavailable'));

        const result = await service.importSuratKeluar(
            'sheet-id',
            'Sheet1',
            'unit-a',
            auditContext,
        );

        expect(result).toMatchObject({ success: false, importedRows: 0, skippedRows: 1 });
        expect(result.errors[0]).toContain('Terjadi kesalahan pada server');
        expect(JSON.stringify(result)).not.toContain('audit unavailable');
    });

    it('routes CSV migration through canonical services and keeps legacy archive rules unverified', async () => {
        const incomingCsv = [
            'No,Nomor Surat,Tanggal Surat,Perihal,Dari,Kepada',
            '1,SM-CSV-1,28/08/2026,Permohonan Data,Kantah A,Ditjen',
        ].join('\n');
        const archiveCsv = [
            'No,Jenis Arsip,Tanggal,Uraian,Kode Klasifikasi,Keterangan',
            '1,masuk,28/08/2026,Berkas Pengadaan,PG.01,Data lama',
        ].join('\n');

        mocks.selectQueue.push([], []);
        const incoming = await migrationService.importSuratMasuk(
            incomingCsv,
            'unit-a',
            auditContext,
        );
        const archive = await migrationService.importArsip(
            archiveCsv,
            'unit-a',
            auditContext,
        );

        expect(incoming).toMatchObject({ success: true, imported: 1 });
        expect(mocks.createMasuk).toHaveBeenCalledWith(
            expect.objectContaining({ nomorSurat: 'SM-CSV-1' }),
            auditContext,
        );
        expect(archive).toMatchObject({ success: true, imported: 1 });
        const archivePayload = mocks.createArsip.mock.calls[0]?.[0];
        expect(archivePayload).not.toHaveProperty('kodeKlasifikasi');
        expect(archivePayload.keterangan).toContain('Kode klasifikasi sumber (belum diverifikasi): PG.01');
        expect(mocks.createArsip).toHaveBeenCalledWith(
            expect.any(Object),
            auditContext,
        );
    });

    it('does not count a CSV row when canonical audit persistence fails', async () => {
        mocks.createMasuk.mockRejectedValueOnce(new Error('audit unavailable'));
        mocks.selectQueue.push([]);
        const result = await migrationService.importSuratMasuk([
            'No,Nomor Surat,Tanggal Surat,Perihal,Dari,Kepada',
            '1,SM-CSV-1,28/08/2026,Permohonan Data,Kantah A,Ditjen',
        ].join('\n'), 'unit-a', auditContext);

        expect(result).toMatchObject({ success: false, imported: 0, skipped: 1 });
        expect(result.errors[0]).toContain('Terjadi kesalahan pada server');
        expect(JSON.stringify(result)).not.toContain('audit unavailable');
    });

    it('makes CSV retries idempotent with the same stable numberless fingerprint', async () => {
        const csv = [
            'No,Nomor Surat,Tanggal Surat,Perihal,Dari,Kepada',
            '99,-,28/08/2026,Permohonan Data,Kantah A,Ditjen',
        ].join('\n');
        mocks.selectQueue.push([], [{ id: 'already-imported' }]);

        const first = await migrationService.importSuratMasuk(csv, 'unit-a', auditContext);
        const retry = await migrationService.importSuratMasuk(csv, 'unit-a', auditContext);

        expect(first).toMatchObject({ success: true, imported: 1, duplicates: 0 });
        expect(retry).toMatchObject({ success: true, imported: 0, duplicates: 1 });
        expect(mocks.createMasuk).toHaveBeenCalledTimes(1);
    });

    it.each(['masuk', 'keluar'] as const)('counts a late %s duplicate from the shared Sheets/CSV transaction without errors', async type => {
        const canonical = type === 'masuk' ? mocks.createMasuk : mocks.createKeluar;
        const method = type === 'masuk' ? 'importSuratMasuk' : 'importSuratKeluar';
        const source = [
            'Nomor Surat,Tanggal Surat,Perihal,Dari,Kepada',
            '-,28/08/2026,Permohonan Data,Kantah A,Ditjen',
            '-,28/08/2026,Permohonan Data,Kantah A,Ditjen',
        ].join('\n');
        mocks.selectQueue.push([]);
        canonical.mockRejectedValueOnce(new DuplicateSuratImportError());

        const result = await migrationService[method](source, 'unit-a', auditContext);

        expect(result).toMatchObject({ success: true, imported: 0, duplicates: 2, skipped: 0, valid: 0, errors: [] });
        expect(result.rows.map(row => row.status)).toEqual(['duplicate', 'duplicate']);
        expect(canonical).toHaveBeenCalledTimes(1);
        expect(canonical).toHaveBeenCalledWith(expect.objectContaining({ tanggalSurat: '2026-08-28', perihal: 'Permohonan Data' }), auditContext);
        if (type === 'keluar') expect(canonical.mock.calls[0][0]).toMatchObject({ numberingMode: 'auto', nomorSurat: undefined });
        expect(mocks.ordinaryCreate).not.toHaveBeenCalled();
        expect(mocks.logs).not.toHaveBeenCalled();
    });
});
