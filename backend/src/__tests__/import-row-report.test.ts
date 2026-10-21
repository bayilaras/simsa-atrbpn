import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DuplicateSuratImportError } from '../services/surat-import-identity.js';

// The real identity rules: an undated row has no import identity and is rejected before any write.
const mocks = vi.hoisted(() => ({ incoming: vi.fn(), outgoing: vi.fn(), existing: vi.fn() }));
vi.mock('../services/surat-masuk.service.js', async () => {
    const { suratImportIdentityKey } = await import('../services/surat-import-identity.js');
    return { suratMasukService: { createImported: mocks.incoming, existingImportIdentities: mocks.existing,
        importIdentityKey: (data: Parameters<typeof suratImportIdentityKey>[1]) => suratImportIdentityKey('masuk', data) } };
});
vi.mock('../services/surat-keluar.service.js', async () => {
    const { suratImportIdentityKey } = await import('../services/surat-import-identity.js');
    return { suratKeluarService: { createImported: mocks.outgoing, existingImportIdentities: mocks.existing,
        importIdentityKey: (data: Parameters<typeof suratImportIdentityKey>[1]) => suratImportIdentityKey('keluar', data) } };
});
vi.mock('../utils/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }));
import { GoogleDriveImportService } from '../services/google-drive-import.service.js';

const audit = { userId: '11111111-1111-4111-8111-111111111111' };
const header = ['No', 'Nomor Surat', 'Tanggal Surat', 'Hal', 'Sifat Surat', 'Get link'];
const link = (n: number) => `https://drive.google.com/file/d/synthetic-${n}/view`;
const letter = (no: number, nomor: string, tanggal: string, hal: string) => [String(no), nomor, tanggal, hal, 'Biasa', link(no)];
let service: GoogleDriveImportService;

beforeEach(() => {
    vi.clearAllMocks();
    service = new GoogleDriveImportService();
    mocks.outgoing.mockResolvedValue({ id: 'outgoing' });
    mocks.incoming.mockResolvedValue({ id: 'incoming' });
    mocks.existing.mockImplementation(async (keys: unknown[]) => keys.map(() => false));
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
        mocks.existing.mockImplementation(async (keys: Array<{ nomorSurat: string }>) => keys.map(key => key.nomorSurat === '2/UND/I/2026'));
        mocks.outgoing.mockResolvedValueOnce({ id: 'created' }).mockRejectedValueOnce(new DuplicateSuratImportError());

        const result = await service.importRows('surat-keluar', rows, 'unit-a', audit);

        expect(result).toMatchObject({ importedRows: 1, duplicateRows: 2, skippedRows: 2 });
        expect(result.rows).toEqual([
            { row: 1, no: '1', nomorSurat: '1/UND/I/2026', tanggal: '05/01/2026', perihal: 'Undangan rapat', status: 'imported' },
            { row: 2, no: '2', nomorSurat: '2/UND/I/2026', tanggal: '06/01/2026', perihal: 'Sudah ada di SIMSA', status: 'duplicate',
                reason: 'Sudah tercatat di SIMSA pada unit ini (termasuk surat yang dihapus).' },
            { row: 3, no: '3', nomorSurat: '1/UND/I/2026', tanggal: '07/01/2026', perihal: 'Nomor yang sama diketik ulang', status: 'duplicate',
                reason: 'Nomor surat dan tahun sama dengan baris data ke-1 pada sumber ini.' },
            { row: 4, no: '4', nomorSurat: '4/UND/I/2026', tanggal: '', perihal: 'Tanpa tanggal', status: 'invalid',
                reason: 'Tanggal surat yang valid wajib diisi untuk identitas impor yang stabil.' },
            { row: 5, no: '5', nomorSurat: '', tanggal: '', perihal: '', status: 'empty', reason: 'Nomor surat dan perihal kosong.' },
        ]);
        // Only the two new identities reach the canonical create; the undated row never does.
        expect(mocks.outgoing.mock.calls.map(([record]) => record.perihal)).toEqual(['Undangan rapat', 'Nomor yang sama diketik ulang']);
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
            mocks.existing.mockImplementation(async (keys: Array<{ nomorSurat: string }>) => keys.map(key => key.nomorSurat === '1/UND/2026'));
            const rest = await service.importRows('surat-keluar', rows, 'unit-a', audit, {},
                { startRow: first.nextRow!, prefixHash: first.prefixHash, deadlineAt: clock + 60_000 });
            expect(rest.rows).toEqual([
                expect.objectContaining({ row: 3, status: 'imported' }),
                expect.objectContaining({ row: 4, status: 'duplicate', reason: 'Nomor surat dan tahun sama dengan baris data ke-1 pada sumber ini.' }),
            ]);
        } finally { vi.mocked(Date.now).mockRestore(); }
    });
});
