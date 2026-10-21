import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../utils/errors.js';

// The bulk lookup is advisory; by default it finds nothing so every row reaches the canonical create.
const mocks = vi.hoisted(() => ({ incoming: vi.fn(), outgoing: vi.fn(), existing: vi.fn(),
    identityKey: (data: { nomorSurat?: string; linkDokumen?: string | null }) => ({ nomor: data.nomorSurat, link: data.linkDokumen }) }));
vi.mock('../services/surat-masuk.service.js', () => ({ suratMasukService: {
    createImported: mocks.incoming, importIdentityKey: mocks.identityKey, existingImportIdentities: mocks.existing } }));
vi.mock('../services/surat-keluar.service.js', () => ({ suratKeluarService: {
    createImported: mocks.outgoing, importIdentityKey: mocks.identityKey, existingImportIdentities: mocks.existing } }));
vi.mock('../utils/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }));
import { GoogleDriveImportService, googleDriveImportService } from '../services/google-drive-import.service.js';
import { fileImportService } from '../services/file-import.service.js';
import { REGISTER_HEADERS, driveLink, registerWorkbook, singleSheetWorkbook, upload } from './helpers/import-file-fixtures.js';

const audit = { userId: '11111111-1111-4111-8111-111111111111' };
const csv = (text: string) => upload(Buffer.from(text, 'utf8'), 'register.csv', 'text/csv');
const registerCsv = (delimiter: string) => [
    'REGISTER SURAT KELUAR 2026',
    REGISTER_HEADERS.join(delimiter),
    ['1', '87/SK-600/I/2026', '05/01/2026', '05/01/2026 15:12', 'Tim peneliti', 'Segera', 'Halaman Ke 3', '', driveLink('a')].join(delimiter),
    ['2', '88/SK-600/I/2026', '06/01/2026', '', 'Undangan rapat', 'Biasa', 'Halaman Ke 1', 'file', driveLink('b')].join(delimiter),
    ['3', '-', '07/01/2026', '', 'Nota dinas tanpa nomor', 'Penting', '', 'file', driveLink('c')].join(delimiter),
].join('\n');
const expectedRegister = [
    { noUrut: 1, nomorSurat: '87/SK-600/I/2026', tanggalSurat: '2026-01-05', tahun: 2026, perihal: 'Tim peneliti', kepada: '', sifatSurat: 'segera', linkDokumen: driveLink('a') },
    { noUrut: 2, nomorSurat: '88/SK-600/I/2026', tanggalSurat: '2026-01-06', tahun: 2026, perihal: 'Undangan rapat', kepada: '', sifatSurat: 'biasa', linkDokumen: driveLink('b') },
    { noUrut: 3, nomorSurat: '-', tanggalSurat: '2026-01-07', tahun: 2026, perihal: 'Nota dinas tanpa nomor', kepada: '', sifatSurat: 'penting', linkDokumen: driveLink('c') },
];
const created = () => mocks.outgoing.mock.calls.map(([record]) => record);

beforeEach(() => {
    vi.clearAllMocks(); mocks.incoming.mockResolvedValue({ id: 'incoming' }); mocks.outgoing.mockResolvedValue({ id: 'outgoing' });
    mocks.existing.mockImplementation(async (keys: unknown[]) => keys.map(() => false));
});

describe('file import shares the Google Sheets mapping and import path', () => {
    it('previews the chosen XLSX tab with the flexible column mapping', async () => {
        const preview = await fileImportService.preview(upload(await registerWorkbook()), '2026', 2, 'surat-keluar');
        expect(preview).toMatchObject({ format: 'xlsx', sheet: '2026', importType: 'surat-keluar', headerRow: 2, totalRows: 3, headers: REGISTER_HEADERS });
        expect(preview.sheets.map(sheet => sheet.name)).toEqual(['2026', '2025', 'Rekap']);
        expect(preview.rows).toHaveLength(2);
        expect(preview.mapping).toEqual(expect.arrayContaining([
            { field: 'nomorSurat', label: 'Nomor surat', columnIndex: 1, header: 'Nomor Surat' },
            { field: 'tanggalSurat', label: 'Tanggal surat', columnIndex: 2, header: 'Tanggal Surat' },
            { field: 'perihal', label: 'Perihal', columnIndex: 4, header: 'Hal' },
            { field: 'sifatSurat', label: 'Sifat surat', columnIndex: 5, header: 'Sifat Surat' },
            { field: 'linkDokumen', label: 'Tautan dokumen', columnIndex: 8, header: 'Get link' },
        ]));
        expect(preview.mapping.map(item => item.field)).not.toContain('kepada');
        expect(mocks.outgoing).not.toHaveBeenCalled();
    });

    it('imports the register tab through the canonical outgoing-letter creation', async () => {
        const result = await fileImportService.importSurat('surat-keluar', upload(await registerWorkbook()), '2026', 'unit-a', audit);
        expect(result).toMatchObject({ success: true, totalRows: 3, importedRows: 3, duplicateRows: 0, skippedRows: 0, errors: [] });
        expect(created()).toEqual(expectedRegister.map(record => expect.objectContaining({ ...record, unitKerjaId: 'unit-a', numberingMode: 'manual' })));
        expect(mocks.outgoing).toHaveBeenCalledWith(expect.anything(), audit, {});
    });

    it('imports the same records from the XLSX tab, a ";" or "," CSV, and the Google Sheets export', async () => {
        const records = async (run: () => Promise<unknown>) => { mocks.outgoing.mockClear(); await run(); return created(); };
        const sheets = new GoogleDriveImportService();
        vi.spyOn(sheets, 'fetchSheetAsCSV').mockResolvedValue(registerCsv(','));
        const fromSheets = await records(() => sheets.importSuratKeluar('sheet', { gid: '0' }, 'unit-a', audit));
        expect(fromSheets).toEqual(expectedRegister.map(record => expect.objectContaining(record)));
        expect(await records(async () => fileImportService.importSurat('surat-keluar', upload(await registerWorkbook()), '2026', 'unit-a', audit))).toEqual(fromSheets);
        expect(await records(() => fileImportService.importSurat('surat-keluar', csv(registerCsv(';')), undefined, 'unit-a', audit))).toEqual(fromSheets);
        expect(await records(() => fileImportService.importSurat('surat-keluar', csv(registerCsv(',')), undefined, 'unit-a', audit))).toEqual(fromSheets);
    });

    it('counts rows already recorded with one lookup for the whole file', async () => {
        mocks.existing.mockImplementation(async (keys: Array<{ nomor: string }>) => keys.map(key => key.nomor !== '-'));
        const result = await fileImportService.importSurat('surat-keluar', csv(registerCsv(';')), undefined, 'unit-a', audit);
        expect(result).toMatchObject({ importedRows: 1, duplicateRows: 2 });
        expect(mocks.existing).toHaveBeenCalledOnce();
        expect(created()).toEqual([expect.objectContaining({ nomorSurat: '-' })]);
    });

    it('imports surat masuk from an XLSX file', async () => {
        const file = upload(await singleSheetWorkbook(sheet => {
            sheet.addRow(['No', 'No. Surat', 'Tgl Surat', 'Perihal', 'Asal']);
            sheet.addRow([4, 'SM-1/2026', new Date(Date.UTC(2026, 8, 12)), 'Permohonan data', 'Kantah A']);
            sheet.getCell('C2').numFmt = 'dd/mm/yyyy';
        }));
        expect(await fileImportService.importSurat('surat-masuk', file, undefined, 'unit-a', audit)).toMatchObject({ importedRows: 1 });
        expect(mocks.incoming).toHaveBeenCalledWith(expect.objectContaining({
            noUrut: 4, nomorSurat: 'SM-1/2026', tanggalSurat: '2026-09-12', perihal: 'Permohonan data', dari: 'Kantah A', unitKerjaId: 'unit-a',
        }), audit, {});
    });

    it('continues a resumable file import only while the earlier rows are unchanged', async () => {
        const file = upload(await registerWorkbook());
        // A spent time budget still handles one row, so every part advances.
        const first = await fileImportService.importSurat('surat-keluar', file, '2026', 'unit-a', audit, {}, { startRow: 0, deadlineAt: 0 });
        expect(first).toMatchObject({ startRow: 0, nextRow: 1, importedRows: 1, prefixHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
        const second = await fileImportService.importSurat('surat-keluar', file, '2026', 'unit-a', audit, {},
            { startRow: 1, prefixHash: first.prefixHash, deadlineAt: Date.now() + 60_000 });
        expect(second).toMatchObject({ startRow: 1, nextRow: null, importedRows: 2 });
        expect(created()).toEqual(expectedRegister.map(record => expect.objectContaining(record)));

        const edited = csv(registerCsv(';').replace('Tim peneliti', 'Tim peneliti (revisi)'));
        const fromCsv = await fileImportService.importSurat('surat-keluar', csv(registerCsv(';')), undefined, 'unit-a', audit, {}, { startRow: 0, deadlineAt: 0 });
        await expect(fileImportService.importSurat('surat-keluar', edited, undefined, 'unit-a', audit, {},
            { startRow: 1, prefixHash: fromCsv.prefixHash, deadlineAt: Date.now() + 60_000 })).rejects.toThrow(ConflictError);
    });

    it('lists tabs and previews a CSV without tabs', async () => {
        expect(await fileImportService.sheets(csv(registerCsv(',')))).toEqual({ format: 'csv', sheets: [] });
        expect(await fileImportService.preview(csv(registerCsv(',')), undefined, 10, 'surat-keluar')).toMatchObject({
            format: 'csv', sheets: [], sheet: null, headerRow: 2, totalRows: 3,
        });
    });

    it('rejects an unrecognised header before any write', async () => {
        const file = upload(await singleSheetWorkbook(sheet => { sheet.addRow(['Jumlah', 3]); sheet.addRow(['Selesai', 2]); }, 'Rekap'));
        await expect(fileImportService.preview(file, 'Rekap', 10, 'surat-keluar')).rejects.toThrow('Header sheet tidak dikenali');
        await expect(fileImportService.importSurat('surat-keluar', file, 'Rekap', 'unit-a', audit)).rejects.toThrow('Header sheet tidak dikenali');
        expect(mocks.outgoing).not.toHaveBeenCalled();
    });
});

describe('duplicated link columns in a workbook', () => {
    const workbook = (label: (row: number) => unknown) => singleSheetWorkbook(sheet => {
        sheet.addRow(['Nomor Surat', 'Tanggal Surat', 'Hal', 'Get link', 'Get link']);
        sheet.addRow(['1/A', '05/01/2026', 'Rapat', label(1), driveLink('a')]);
        sheet.addRow(['2/A', '06/01/2026', 'Undangan', null, driveLink('b')]);
    });

    it('uses the column holding every URL when the label column links to the same files', async () => {
        const file = upload(await workbook(() => ({ text: 'file', hyperlink: driveLink('a') })));
        const preview = await fileImportService.preview(file, undefined, 10, 'surat-keluar');
        expect(preview.mapping).toContainEqual({ field: 'linkDokumen', label: 'Tautan dokumen', columnIndex: 4, header: 'Get link' });
    });

    it('stays ambiguous when the label column links elsewhere', async () => {
        const file = upload(await workbook(() => ({ text: 'folder', hyperlink: 'https://drive.google.com/drive/folders/synthetic' })));
        await expect(fileImportService.preview(file, undefined, 10, 'surat-keluar')).rejects.toThrow('Tautan dokumen');
    });
});

describe('Google Sheets preview after extracting the shared preview', () => {
    it('validates maxRows before fetching the sheet', async () => {
        const service = new GoogleDriveImportService();
        const fetch = vi.spyOn(service, 'fetchSheetAsCSV');
        await expect(service.previewData('sheet', 'Data', 0)).rejects.toThrow('maxRows');
        expect(fetch).not.toHaveBeenCalled();
        expect(() => googleDriveImportService.previewRows([], 101, 'surat-keluar')).toThrow('maxRows');
    });
});
