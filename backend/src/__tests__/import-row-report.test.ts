import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DuplicateSuratImportError } from '../services/surat-import-identity.js';
import { recordedMatches } from './helpers/import-matches.js';

// The real identity rules: an undated row has no import identity and is rejected before any write.
const mocks = vi.hoisted(() => ({ incoming: vi.fn(), outgoing: vi.fn(), matches: vi.fn() }));
vi.mock('../services/surat-masuk.service.js', async () => {
    const { suratImportIdentityKey } = await import('../services/surat-import-identity.js');
    return { suratMasukService: { createImported: mocks.incoming, importMatches: mocks.matches,
        importIdentityKey: (data: Parameters<typeof suratImportIdentityKey>[1]) => suratImportIdentityKey('masuk', data) } };
});
vi.mock('../services/surat-keluar.service.js', async () => {
    const { suratImportIdentityKey } = await import('../services/surat-import-identity.js');
    return { suratKeluarService: { createImported: mocks.outgoing, importMatches: mocks.matches,
        importIdentityKey: (data: Parameters<typeof suratImportIdentityKey>[1]) => suratImportIdentityKey('keluar', data) } };
});
vi.mock('../utils/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }));
import { GoogleDriveImportService } from '../services/google-drive-import.service.js';

// The importer's role caps the security class a surat masuk row may carry.
const audit = { userId: '11111111-1111-4111-8111-111111111111', role: 'admin_unit' };
const header = ['No', 'Nomor Surat', 'Tanggal Surat', 'Hal', 'Sifat Surat', 'Get link'];
const link = (n: number) => `https://drive.google.com/file/d/synthetic-${n}/view`;
const letter = (no: number, nomor: string, tanggal: string, hal: string) => [String(no), nomor, tanggal, hal, 'Biasa', link(no)];
let service: GoogleDriveImportService;

beforeEach(() => {
    vi.clearAllMocks();
    service = new GoogleDriveImportService();
    mocks.outgoing.mockResolvedValue({ id: 'outgoing' });
    mocks.incoming.mockResolvedValue({ id: 'incoming' });
    mocks.matches.mockImplementation(async (keys: unknown[]) => keys.map(() => []));
});

describe('per-row import report', () => {
    it('reports every data row with its outcome and reason, as a register with repeated numbers and undated rows produces', async () => {
        const rows = [['SURAT KELUAR 2026'], header,
            letter(1, '1/UND/I/2026', '05/01/2026', 'Undangan rapat'),
            letter(2, '2/UND/I/2026', '06/01/2026', 'Sudah ada di SIMSA'),
            letter(3, '1/UND/I/2026', '07/01/2026', 'Nomor yang sama diketik ulang'),
            letter(4, '4/UND/I/2026', '', 'Tanpa tanggal'),
            ['5', '', '', '', '', ''],
        ];
        mocks.matches.mockImplementation(async (keys: Array<{ nomorSurat: string }>) => recordedMatches(keys.map(key => key.nomorSurat === '2/UND/I/2026')));
        mocks.outgoing.mockResolvedValueOnce({ id: 'created' }).mockRejectedValueOnce(new DuplicateSuratImportError());

        const result = await service.importRows('surat-keluar', rows, 'unit-a', audit);

        expect(result).toMatchObject({ importedRows: 1, duplicateRows: 2, skippedRows: 2 });
        expect(result.rows).toEqual([
            { row: 1, no: '1', nomorSurat: '1/UND/I/2026', tanggal: '05/01/2026', perihal: 'Undangan rapat', status: 'imported' },
            { row: 2, no: '2', nomorSurat: '2/UND/I/2026', tanggal: '06/01/2026', perihal: 'Sudah ada di SIMSA', status: 'duplicate',
                duplicate: 'recorded', reason: 'Sudah tercatat di SIMSA pada unit ini.' },
            { row: 3, no: '3', nomorSurat: '1/UND/I/2026', tanggal: '07/01/2026', perihal: 'Nomor yang sama diketik ulang', status: 'duplicate',
                duplicate: 'source', reason: 'Nomor surat dan tahun sama dengan baris data ke-1 pada sumber ini.' },
            { row: 4, no: '4', nomorSurat: '4/UND/I/2026', tanggal: '', perihal: 'Tanpa tanggal', status: 'invalid',
                reason: 'Tanggal surat yang valid wajib diisi untuk identitas impor yang stabil.' },
            { row: 5, no: '5', nomorSurat: '', tanggal: '', perihal: '', status: 'empty', reason: 'Nomor surat dan perihal kosong.' },
        ]);
        // Only the two new identities reach the canonical create; the undated row never does.
        expect(mocks.outgoing.mock.calls.map(([record]) => record.perihal)).toEqual(['Undangan rapat', 'Nomor yang sama diketik ulang']);
    });

    it('tells a letter deleted in SIMSA apart from one still recorded, and never recreates it', async () => {
        mocks.matches.mockImplementation(async (keys: unknown[]) => recordedMatches(keys.map(() => true), { isDeleted: true }));
        const result = await service.importRows('surat-keluar', [header, letter(1, '1/UND/2026', '05/01/2026', 'Dihapus')], 'unit-a', audit);
        expect(result.rows?.[0]).toMatchObject({ status: 'duplicate', duplicate: 'deleted',
            reason: 'Surat dengan identitas ini sudah dihapus di SIMSA; impor tidak membuat ulang, memulihkan, atau mengubahnya.' });
        expect(mocks.outgoing).not.toHaveBeenCalled();
    });

    it('reports the No column of a register whose title ran into its first header', async () => {
        const result = await service.importRows('surat-keluar',
            [['SURAT KELUAR 2026 No', 'Nomor Surat', 'Tanggal Surat', 'Hal', 'Sifat Surat', 'Get link'], letter(7, '7/UND/2026', '05/01/2026', 'Undangan')],
            'unit-a', audit);
        expect(result.rows?.[0]).toMatchObject({ row: 1, no: '7', status: 'imported' });
    });

    it('names the identity an unnumbered row shares with an earlier row', async () => {
        const rows = [header, letter(1, '-', '05/01/2026', 'Formulir'), letter(1, '-', '05/01/2026', 'Formulir')];
        mocks.outgoing.mockResolvedValueOnce({ id: 'created' }).mockRejectedValueOnce(new DuplicateSuratImportError());
        const result = await service.importRows('surat-keluar', rows, 'unit-a', audit);
        expect(result.rows?.[1]).toMatchObject({ status: 'duplicate',
            reason: 'Tanggal, perihal, dan tautan dokumen sama dengan baris data ke-1 pada sumber ini.' });
    });

    it('reports a canonical write failure with its public message', async () => {
        mocks.incoming.mockRejectedValueOnce(new Error('connection reset by peer'));
        const result = await service.importRows('surat-masuk', [['Nomor Surat', 'Tanggal Surat', 'Perihal', 'Dari'],
            ['SM-1', '12/09/2026', 'Permohonan data', 'Kantah A']], 'unit-a', audit);
        expect(result.rows).toEqual([{ row: 1, no: '', nomorSurat: 'SM-1', tanggal: '12/09/2026', perihal: 'Permohonan data',
            status: 'invalid', reason: 'Terjadi kesalahan pada server.' }]);
        expect(result.rows?.[0].reason).not.toContain('connection reset');
    });

    it('reports every rejected row although the error list stays at 20', async () => {
        const undated = Array.from({ length: 30 }, (_, i) => letter(i + 1, `${i + 1}/UND/2024`, '', `Surat ${i + 1}`));
        const result = await service.importRows('surat-keluar', [header, ...undated], 'unit-a', audit);
        expect(result.errors).toHaveLength(20);
        expect(result.rows).toHaveLength(30);
        expect(result.rows?.every(row => row.status === 'invalid')).toBe(true);
    });

    it('stores day-first dates the built-in parser would read month-first, and rejects the rows it cannot read exactly', async () => {
        const result = await service.importRows('surat-keluar', [header,
            letter(1, '1/UND/2026', '03/11/26', 'Tahun dua angka'),
            letter(2, '2/UND/2026', '03.11.2026', 'Pemisah titik'),
            letter(3, '3/UND/2026', '03/11/2026 10:00', 'Dengan jam'),
            letter(4, '4/UND/2026', '3 Nov 2026', 'Nama bulan'),
            letter(5, '5/UND/2026', '11/25/2026', 'Bulan lebih dulu'),
            letter(6, '6/UND/2026', '31/02/2026', 'Bukan tanggal kalender'),
            letter(7, '7/UND/2026', 'Nov 3, 2026', 'Penulisan lain'),
        ], 'unit-a', audit);

        expect(mocks.outgoing.mock.calls.map(([record]) => [record.nomorSurat, record.tanggalSurat, record.tahun])).toEqual([
            ['1/UND/2026', '2026-11-03', 2026], ['2/UND/2026', '2026-11-03', 2026],
            ['3/UND/2026', '2026-11-03', 2026], ['4/UND/2026', '2026-11-03', 2026],
        ]);
        expect(result).toMatchObject({ success: false, totalRows: 7, importedRows: 4, skippedRows: 3, duplicateRows: 0 });
        expect(result.rows?.slice(4)).toEqual([
            { row: 5, no: '5', nomorSurat: '5/UND/2026', tanggal: '11/25/2026', perihal: 'Bulan lebih dulu', status: 'invalid',
                reason: expect.stringContaining('Tanggal "11/25/2026" tampaknya ditulis dengan bulan lebih dulu') },
            { row: 6, no: '6', nomorSurat: '6/UND/2026', tanggal: '31/02/2026', perihal: 'Bukan tanggal kalender', status: 'invalid',
                reason: 'Tanggal "31/02/2026" tidak ada di kalender. Periksa hari, bulan, dan tahunnya.' },
            { row: 7, no: '7', nomorSurat: '7/UND/2026', tanggal: 'Nov 3, 2026', perihal: 'Penulisan lain', status: 'invalid',
                reason: expect.stringContaining('Tanggal "Nov 3, 2026" tidak dapat dibaca. Tulis dengan urutan hari, bulan, tahun') },
        ]);
        expect(result.errors[0]).toContain('Row 5: Tanggal "11/25/2026"');
    });

    it('rejects an unreadable date for surat masuk before the lookup and any write', async () => {
        const result = await service.importRows('surat-masuk', [['Nomor Surat', 'Tanggal Surat', 'Perihal', 'Dari'],
            ['SM-1', '11/25/2026', 'Permohonan data', 'Kantah A'], ['SM-2', '25/11/2026', 'Permohonan data', 'Kantah A']], 'unit-a', audit);
        expect(result.rows?.map(row => row.status)).toEqual(['invalid', 'imported']);
        expect(mocks.matches).toHaveBeenCalledWith([expect.objectContaining({ nomorSurat: 'SM-2' })]);
        expect(mocks.incoming).toHaveBeenCalledTimes(1);
        expect(mocks.incoming).toHaveBeenCalledWith(expect.objectContaining({ nomorSurat: 'SM-2', tanggalSurat: '2026-11-25', tahun: 2026 }), audit, {});
    });

    it('flags in the preview the rows the import will reject for their date, with the same reasons', () => {
        const rows = [header,
            letter(1, '1/UND/2026', '03/11/26', 'Dibaca'),
            letter(2, '2/UND/2026', '11/25/2026', 'Bulan lebih dulu'),
            letter(3, '3/UND/2026', '', 'Tanpa tanggal'),
            ['4', '', 'besok', '', 'Biasa', link(4)],
            letter(5, '5/UND/2026', '31/02/2026', 'Bukan tanggal kalender'),
        ];
        const preview = service.previewRows(rows, 2, 'surat-keluar');
        expect(preview.rows).toHaveLength(2);
        // Counted over the whole source, not only the rows shown; the import skips row 4 as empty, so it is not flagged.
        expect(preview.dateIssues).toEqual({ total: 3, rows: [
            { row: 2, value: '11/25/2026', reason: expect.stringContaining('bulan lebih dulu') },
            { row: 3, value: '', reason: 'Tanggal surat kosong.' },
            { row: 5, value: '31/02/2026', reason: 'Tanggal "31/02/2026" tidak ada di kalender. Periksa hari, bulan, dan tahunnya.' },
        ] });
        expect(service.previewRows([header, letter(1, '1/UND/2026', '3 November 2026', 'Dibaca')], 10, 'surat-keluar').dateIssues).toEqual({ total: 0, rows: [] });
    });

    it('lists at most ten flagged rows in the preview and counts them all', () => {
        const rows = Array.from({ length: 25 }, (_, i) => letter(i + 1, `${i + 1}/UND/2026`, '11/25/2026', `Surat ${i + 1}`));
        const { dateIssues } = service.previewRows([header, ...rows], 5, 'surat-keluar');
        expect(dateIssues.total).toBe(25);
        expect(dateIssues.rows.map(issue => issue.row)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('passes the source No as the requested number and reports one that was replaced', async () => {
        // createImported answers with the number it stored: kept, already used (57), or replaced because unusable (58).
        mocks.outgoing.mockResolvedValueOnce({ id: 'a', noUrut: 1 }).mockResolvedValueOnce({ id: 'b', noUrut: 57 })
            .mockResolvedValueOnce({ id: 'c', noUrut: 58 }).mockResolvedValueOnce({ id: 'd', noUrut: 59 });
        const result = await service.importRows('surat-keluar', [header,
            letter(1, '1/UND/2026', '05/01/2026', 'Nomor bebas'),
            letter(2, '2/UND/2026', '05/01/2026', 'Nomor sudah dipakai'),
            ['2a', '3/UND/2026', '05/01/2026', 'Bukan angka', 'Biasa', link(3)],
            ['', '4/UND/2026', '05/01/2026', 'Tanpa nomor sumber', 'Biasa', link(4)],
        ], 'unit-a', audit);
        expect(mocks.outgoing.mock.calls.map(([record]) => record.noUrut)).toEqual([1, 2, undefined, undefined]);
        expect(result.rows?.map(row => [row.status, row.reason])).toEqual([
            ['imported', undefined],
            ['imported', 'Nomor urut sumber 2 sudah dipakai; diberi nomor 57.'],
            ['imported', 'Nomor urut sumber "2a" bukan angka 1 sampai 999999; diberi nomor 58.'],
            ['imported', undefined],
        ]);
    });

    it('names the No. Agenda of surat masuk in the report', async () => {
        mocks.incoming.mockResolvedValueOnce({ id: 'a', noUrut: 31 });
        const result = await service.importRows('surat-masuk', [['No. Agenda', 'Nomor Surat', 'Tanggal Surat', 'Perihal', 'Dari'],
            ['12', 'SM-1', '12/09/2026', 'Permohonan data', 'Kantah A']], 'unit-a', audit);
        expect(mocks.incoming).toHaveBeenCalledWith(expect.objectContaining({ noUrut: 12 }), audit, {});
        expect(result.rows?.[0]).toMatchObject({ no: '12', status: 'imported', reason: 'Nomor agenda sumber 12 sudah dipakai; diberi nomor 31.' });
    });

    it('shortens a long perihal in the report only', async () => {
        const long = 'Perihal panjang '.repeat(40).trim();
        const result = await service.importRows('surat-keluar', [header, letter(1, '1/UND/2026', '05/01/2026', long)], 'unit-a', audit);
        expect(mocks.outgoing).toHaveBeenCalledWith(expect.objectContaining({ perihal: long }), audit, {});
        expect(result.rows?.[0].perihal).toHaveLength(200);
        expect(result.rows?.[0].perihal.endsWith('…')).toBe(true);
    });

    it('reports the rows of each resumable part with sheet-wide row numbers and earlier duplicates', async () => {
        let clock = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => clock);
        mocks.outgoing.mockImplementation(async () => { clock += 10_000; return { id: 'outgoing' }; });
        const rows = [header, letter(1, '1/UND/2026', '05/01/2026', 'Satu'), letter(2, '2/UND/2026', '05/01/2026', 'Dua'),
            letter(3, '3/UND/2026', '05/01/2026', 'Tiga'), letter(4, '1/UND/2026', '06/01/2026', 'Satu lagi')];
        try {
            const first = await service.importRows('surat-keluar', rows, 'unit-a', audit, {}, { startRow: 0, deadlineAt: clock + 15_000 });
            expect(first.rows?.map(row => [row.row, row.status])).toEqual([[1, 'imported'], [2, 'imported']]);
            // The first row is recorded by now.
            mocks.matches.mockImplementation(async (keys: Array<{ nomorSurat: string }>) => recordedMatches(keys.map(key => key.nomorSurat === '1/UND/2026')));
            const rest = await service.importRows('surat-keluar', rows, 'unit-a', audit, {},
                { startRow: first.nextRow!, prefixHash: first.prefixHash, deadlineAt: clock + 60_000 });
            expect(rest.rows).toEqual([
                expect.objectContaining({ row: 3, status: 'imported' }),
                expect.objectContaining({ row: 4, status: 'duplicate', duplicate: 'source', reason: 'Nomor surat dan tahun sama dengan baris data ke-1 pada sumber ini.' }),
            ]);
        } finally { vi.mocked(Date.now).mockRestore(); }
    });
});
