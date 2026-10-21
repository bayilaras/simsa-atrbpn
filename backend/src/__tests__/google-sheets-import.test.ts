import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { resolveSheetMapping } from '../services/google-sheets-import-mapping.js';
import { DuplicateSuratImportError, suratImportIdentity } from '../services/surat-import-identity.js';

// The bulk lookup is advisory; by default it finds nothing so every row reaches the canonical create.
const mocks = vi.hoisted(() => ({ incoming: vi.fn(), outgoing: vi.fn(), existing: vi.fn(),
    identityKey: (data: { nomorSurat?: string }) => ({ nomor: data.nomorSurat }) }));
vi.mock('../services/surat-masuk.service.js', () => ({ suratMasukService: {
    createImported: mocks.incoming, importIdentityKey: mocks.identityKey, existingImportIdentities: mocks.existing } }));
vi.mock('../services/surat-keluar.service.js', () => ({ suratKeluarService: {
    createImported: mocks.outgoing, importIdentityKey: mocks.identityKey, existingImportIdentities: mocks.existing } }));
vi.mock('../utils/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }));
import { GoogleDriveImportService } from '../services/google-drive-import.service.js';

const audit = { userId: '11111111-1111-4111-8111-111111111111' };
const headers = ['Nomor Urut', 'No. Surat', 'Tanggal Surat', 'Perihal', 'Dari', 'Kepada'];
const data = ['7', 'SM-2026-actual', '12/09/2026', 'Permohonan data', 'Kantah A', 'Ditjen'];
beforeEach(() => {
    vi.clearAllMocks(); mocks.incoming.mockResolvedValue({ id: 'incoming' }); mocks.outgoing.mockResolvedValue({ id: 'outgoing' });
    mocks.existing.mockImplementation(async (keys: unknown[]) => keys.map(() => false));
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

    it('does not use a column from another import type as the counterpart', () => {
        expect(resolveSheetMapping([['Nomor Surat', 'Tanggal', 'Perihal', 'Dari']], 'surat-keluar').columnMap).not.toHaveProperty('kepada');
        expect(() => resolveSheetMapping([['Nomor Surat', 'Tanggal', 'Perihal', 'Kepada']], 'surat-masuk')).toThrow('Pengirim');
    });

    it('imports an outgoing register without a Kepada column, taking the document link from the column holding URLs', async () => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue([
            'SURAT KELUAR 2026 No,Nomor Surat,Tanggal Surat,Tanggal TTE,Hal,Sifat Surat,Posisi,Get link,Get link',
            '1,87/SK-600/I/2026,05/01/2026,05/01/2026 15:12,Tim peneliti,Segera,Halaman Ke 3,,https://drive.google.com/file/d/synthetic-a/view',
            '2,88/SK-600/I/2026,06/01/2026,06/01/2026 09:00,Undangan rapat,Biasa,Halaman Ke 1,file,https://drive.google.com/file/d/synthetic-b/view',
        ].join('\n'));
        const preview = await service.previewData('sheet', { gid: '234636572' }, 10, {}, 'surat-keluar');
        expect(preview.mapping).toContainEqual({ field: 'linkDokumen', label: 'Tautan dokumen', columnIndex: 8, header: 'Get link' });
        expect(preview.mapping.map(item => item.field)).not.toContain('kepada');
        expect(await service.importSuratKeluar('sheet', { gid: '234636572' }, 'unit-a', audit)).toMatchObject({ importedRows: 2, errors: [] });
        expect(mocks.outgoing).toHaveBeenNthCalledWith(1, expect.objectContaining({
            noUrut: 1, nomorSurat: '87/SK-600/I/2026', tanggalSurat: '2026-01-05', perihal: 'Tim peneliti', kepada: '',
            linkDokumen: 'https://drive.google.com/file/d/synthetic-a/view', sifatSurat: 'segera',
        }), audit, {});
        expect(mocks.outgoing).toHaveBeenNthCalledWith(2, expect.objectContaining({ sifatSurat: 'biasa' }), audit, {});
        expect(preview.mapping).toContainEqual({ field: 'sifatSurat', label: 'Sifat surat', columnIndex: 5, header: 'Sifat Surat' });
    });

    it('leaves the sifat of an outgoing letter unrecorded when the register has no such column', async () => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue([headers, data].map(row => row.join(',')).join('\n'));
        await service.importSuratKeluar('sheet', 'Data', 'unit-a', audit);
        expect(mocks.outgoing).toHaveBeenCalledWith(expect.objectContaining({ sifatSurat: null }), audit, {});
    });

    it.each([
        ['both link columns hold URLs', 'https://a.example/1,https://a.example/2'],
        ['no link column holds a URL', 'file,file'],
    ])('rejects duplicated link columns when %s', async (_case, links) => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue(['Nomor Surat,Tanggal Surat,Hal,Get link,Get link', `1/A,05/01/2026,Hal,${links}`].join('\n'));
        await expect(service.previewData('sheet', 'Data', 10, {}, 'surat-keluar')).rejects.toThrow('Tautan dokumen');
        expect(mocks.outgoing).not.toHaveBeenCalled();
    });

    it('stores only web addresses as the document link', async () => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue(['Nomor Surat,Tanggal Surat,Hal,Link', '1/A,05/01/2026,Hal,file'].join('\n'));
        await service.importSuratKeluar('sheet', 'Data', 'unit-a', audit);
        expect(mocks.outgoing).toHaveBeenCalledWith(expect.objectContaining({ linkDokumen: null }), audit, {});
    });

    it('counts canonical duplicate rejection separately from failed writes', async () => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue([headers, data, data].map(row => row.join(',')).join('\n'));
        mocks.incoming.mockResolvedValueOnce({ id: 'created' }).mockRejectedValueOnce(new DuplicateSuratImportError());
        expect(await service.importSuratMasuk('sheet', 'Data', 'unit-a', audit)).toMatchObject({
            success: true, importedRows: 1, duplicateRows: 1, skippedRows: 0, errors: [],
        });
    });

    it.each([
        ['surat-masuk', mocks.incoming],
        ['surat-keluar', mocks.outgoing],
    ] as const)('looks up the whole %s sheet once and skips rows already recorded without opening their transactions', async (type, create) => {
        const service = new GoogleDriveImportService();
        const second = ['8', 'SM-2026-next', '13/09/2026', 'Undangan rapat', 'Kantah B', 'Ditjen'];
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue([headers, data, second].map(row => row.join(',')).join('\n'));
        mocks.existing.mockResolvedValueOnce([true, false]);
        const result = await (type === 'surat-masuk' ? service.importSuratMasuk('sheet', 'Data', 'unit-a', audit)
            : service.importSuratKeluar('sheet', 'Data', 'unit-a', audit));
        expect(result).toMatchObject({ success: true, importedRows: 1, duplicateRows: 1, skippedRows: 0, errors: [] });
        expect(mocks.existing).toHaveBeenCalledTimes(1);
        expect(mocks.existing).toHaveBeenCalledWith([{ nomor: 'SM-2026-actual' }, { nomor: 'SM-2026-next' }]);
        expect(create).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ nomorSurat: 'SM-2026-next' }), audit, {});
    });

    it.each([null, '', '2026-99-99', '2026-02-31'])('rejects an unstable/invalid import identity date %s', date => {
        expect(() => suratImportIdentity('masuk', { unitKerjaId: 'unit-a', tahun: 2026,
            nomorSurat: 'SM-1', tanggalSurat: date })).toThrow('Tanggal surat');
    });
});

describe('importing already-parsed rows from any source', () => {
    it.each([['surat-masuk', mocks.incoming], ['surat-keluar', mocks.outgoing]] as const)(
        'maps and imports %s rows without fetching a sheet', async (type, create) => {
            const service = new GoogleDriveImportService();
            const fetch = vi.spyOn(service, 'fetchSheetAsCSV');
            const result = await service.importRows(type, [['Daftar surat 2026'], headers, data], 'unit-a', audit);
            expect(result).toMatchObject({ success: true, totalRows: 1, importedRows: 1, duplicateRows: 0, errors: [] });
            expect(create).toHaveBeenCalledWith(expect.objectContaining({
                unitKerjaId: 'unit-a', noUrut: 7, nomorSurat: 'SM-2026-actual', tanggalSurat: '2026-09-12', perihal: 'Permohonan data',
            }), audit, {});
            expect(fetch).not.toHaveBeenCalled();
        });

    it('imports parsed rows in resumable parts', async () => {
        const service = new GoogleDriveImportService();
        const second = ['8', 'SK-2026-next', '13/09/2026', 'Undangan rapat', 'Kantah B', 'Ditjen'];
        const rows = [headers, data, second];
        // An already-spent budget: each part imports exactly one row.
        const first = await service.importRows('surat-keluar', rows, 'unit-a', audit, {}, { startRow: 0, deadlineAt: Date.now() - 1 });
        expect(first).toMatchObject({ importedRows: 1, startRow: 0, nextRow: 1 });
        const rest = await service.importRows('surat-keluar', rows, 'unit-a', audit, {},
            { startRow: first.nextRow!, prefixHash: first.prefixHash, deadlineAt: Date.now() - 1 });
        expect(rest).toMatchObject({ importedRows: 1, startRow: 1, nextRow: null });
        expect(mocks.outgoing.mock.calls.map(([record]) => record.nomorSurat)).toEqual(['SM-2026-actual', 'SK-2026-next']);
    });

    it('reports a source without data rows', async () => {
        expect(await new GoogleDriveImportService().importRows('surat-keluar', [headers], 'unit-a', audit))
            .toMatchObject({ success: false, totalRows: 0, importedRows: 0, errors: ['No data found'] });
        expect(mocks.outgoing).not.toHaveBeenCalled();
    });
});

describe('resumable import within a time budget', () => {
    // Outgoing rows; the Dari column is not read by a surat keluar import.
    const outgoingRows = (count: number) => Array.from({ length: count }, (_, i) =>
        [String(i + 1), `SK-${i + 1}`, '12/09/2026', `Perihal ${i + 1}`, 'Kantah A', 'Ditjen']);
    const csv = (rows: string[][]) => [headers, ...rows].map(row => row.join(',')).join('\n');
    let clock = 0;
    const importer = (rows: string[][]) => {
        const service = new GoogleDriveImportService();
        vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue(csv(rows));
        return service;
    };
    const run = (rows: string[][], resume?: { startRow: number; prefixHash?: string }) => importer(rows)
        .importSuratKeluar('sheet', { gid: '0' }, 'unit-a', audit, {}, resume && { ...resume, deadlineAt: clock + 25_000 });
    beforeEach(() => {
        clock = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => clock);
        // Each canonical write takes ten seconds on this synthetic clock.
        mocks.outgoing.mockImplementation(async () => { clock += 10_000; return { id: 'outgoing' }; });
    });
    afterEach(() => { vi.mocked(Date.now).mockRestore(); });
    const written = () => mocks.outgoing.mock.calls.map(([record]) => record.nomorSurat);

    it('stops once the budget is spent and says where to resume', async () => {
        const result = await run(outgoingRows(5), { startRow: 0 });
        expect(result).toMatchObject({ success: true, totalRows: 5, importedRows: 3, startRow: 0, nextRow: 3 });
        expect(result.prefixHash).toMatch(/^[a-f0-9]{64}$/);
        expect(written()).toEqual(['SK-1', 'SK-2', 'SK-3']);
    });

    it('continues from the returned position and finishes the sheet', async () => {
        const first = await run(outgoingRows(5), { startRow: 0 });
        vi.clearAllMocks();
        const rest = await run(outgoingRows(5), { startRow: first.nextRow!, prefixHash: first.prefixHash });
        expect(rest).toMatchObject({ success: true, totalRows: 5, importedRows: 2, duplicateRows: 0, startRow: 3, nextRow: null });
        expect(written()).toEqual(['SK-4', 'SK-5']);
        expect(mocks.existing).toHaveBeenCalledWith([{ nomor: 'SK-4' }, { nomor: 'SK-5' }]);
    });

    it('continues when rows were appended or an unread column changed', async () => {
        const first = await run(outgoingRows(5), { startRow: 0 });
        const grown = outgoingRows(6);
        grown[0][4] = 'Pengirim diubah';
        vi.clearAllMocks();
        const rest = await run(grown, { startRow: first.nextRow!, prefixHash: first.prefixHash });
        expect(rest).toMatchObject({ importedRows: 3, startRow: 3, totalRows: 6 });
        expect(written()).toEqual(['SK-4', 'SK-5', 'SK-6']);
    });

    it('continues when an earlier row changed only in mapped columns the import never reads (ID, Status)', async () => {
        const register = (status: string, id: string) => [['ID', 'Nomor Surat', 'Tanggal Surat', 'Perihal', 'Dari', 'Status'],
            ...[1, 2, 3].map(n => [n === 1 ? id : `id-${n}`, `SM-${n}`, '12/09/2026', `Perihal ${n}`, 'Kantah A', n === 1 ? status : 'baru'])];
        mocks.incoming.mockImplementation(async () => { clock += 10_000; return { id: 'incoming' }; });
        const service = new GoogleDriveImportService();
        const first = await service.importRows('surat-masuk', register('baru', 'id-1'), 'unit-a', audit, {}, { startRow: 0, deadlineAt: clock + 15_000 });
        expect(first).toMatchObject({ importedRows: 2, nextRow: 2 });
        const rest = await service.importRows('surat-masuk', register('sudah dibalas', 'id-1b'), 'unit-a', audit, {},
            { startRow: first.nextRow!, prefixHash: first.prefixHash, deadlineAt: clock + 15_000 });
        expect(rest).toMatchObject({ importedRows: 1, startRow: 2, nextRow: null });
        expect(mocks.incoming.mock.calls.map(([record]) => record.nomorSurat)).toEqual(['SM-1', 'SM-2', 'SM-3']);
    });

    it.each([
        ['an earlier row was edited', (rows: string[][]) => { rows[1][3] = 'Perihal diubah'; return rows; }],
        ['a row was inserted above the position', (rows: string[][]) => [rows[0], ['9', 'SK-9', '12/09/2026', 'Sisipan', 'Kantah A', 'Ditjen'], ...rows.slice(1)]],
        ['the sheet became shorter than the position', (rows: string[][]) => rows.slice(0, 2)],
    ])('refuses to resume when %s', async (_case, change) => {
        const first = await run(outgoingRows(5), { startRow: 0 });
        vi.clearAllMocks();
        await expect(run(change(outgoingRows(5)), { startRow: first.nextRow!, prefixHash: first.prefixHash }))
            .rejects.toMatchObject({ statusCode: 409 });
        expect(mocks.outgoing).not.toHaveBeenCalled();
    });

    it('keeps the single-request contract when the caller does not ask to resume', async () => {
        const result = await run(outgoingRows(5));
        expect(result).toMatchObject({ importedRows: 5, totalRows: 5 });
        for (const field of ['startRow', 'nextRow', 'prefixHash']) expect(result).not.toHaveProperty(field);
    });
});

describe('import identity of an unnumbered outgoing letter', () => {
    const base = { unitKerjaId: 'unit-a', tahun: 2026, nomorSurat: '-', tanggalSurat: '2026-01-13', perihal: 'Formulir pendaftaran pengguna' };
    const link = 'https://drive.google.com/file/d/synthetic-a/view';
    const query = (sql: ReturnType<typeof suratImportIdentity>) => new PgDialect().sqlToQuery(sql);

    it('is anchored on the document link when the recipient is not recorded', () => {
        const identity = query(suratImportIdentity('keluar', { ...base, kepada: '', linkDokumen: link }));
        expect(identity.sql).toContain('"link_dokumen"');
        expect(identity.sql).not.toContain('"kepada"');
        expect(identity.params).toEqual(expect.arrayContaining(['unit-a', '2026-01-13', base.perihal, link]));
    });

    it('keeps using the recipient when it is recorded', () => {
        const identity = query(suratImportIdentity('keluar', { ...base, kepada: 'Biro Keuangan', linkDokumen: link }));
        expect(identity.sql).toContain('"kepada"');
        expect(identity.sql).not.toContain('"link_dokumen"');
    });

    it.each([
        ['keluar', { kepada: '', linkDokumen: null }],
        ['keluar', { kepada: '', linkDokumen: 'file' }],
        ['masuk', { dari: '', linkDokumen: link }],
    ] as const)('still rejects an unnumbered %s letter without a stable counterpart: %j', (type, extra) => {
        expect(() => suratImportIdentity(type, { ...base, ...extra })).toThrow('Nomor surat kosong');
    });
});
