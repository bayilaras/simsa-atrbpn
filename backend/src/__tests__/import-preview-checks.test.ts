import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedMatches } from './helpers/import-matches.js';

// Real reading, identity and admission rules; the canonical creates and the bulk lookup are mocked.
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
import { DuplicateSuratImportError, suratImportIdentityKey } from '../services/surat-import-identity.js';
import { PESAN_KELAS_MELEBIHI_KEWENANGAN, PESAN_SIFAT_TIDAK_DIKENAL } from '../constants/pesan-akses.js';

const importer = (role: string) => ({ userId: '11111111-1111-4111-8111-111111111111', role });
const adminUnit = importer('admin_unit');
const header = ['No', 'Nomor Surat', 'Tanggal Surat', 'Perihal', 'Dari', 'Sifat Surat'];
const register = [header,
    ['1', 'SM-1/2026', '05/01/2026', 'Biasa', 'Kantah A', 'Biasa'],
    ['2', 'SM-2/2026', '05/01/2026', 'Rahasia', 'Kantah A', 'Rahasia'],
    ['3', 'SM-3/2026', '11/25/2026', 'Bulan lebih dulu', 'Kantah A', 'Biasa'],
    ['4', 'SM-4/2026', '', 'Tanpa tanggal', 'Kantah A', 'Biasa'],
    ['5', '-', '06/01/2026', 'Tanpa nomor dan pengirim', '', 'Biasa'],
    ['6', 'SM-6/2026', '07/01/2026', 'Sifat asing', 'Kantah A', 'Konfidensial'],
    // Empty for the import (no number, no perihal): skipped, not rejected.
    ['7', '', '', '', 'Kantah A', ''],
    ['8', 'SM-1/2026', '05/01/2026', 'Diketik ulang', 'kantah a', 'Biasa'],
    ['9', 'SM-9/2026', '08/01/2026', 'Sudah tercatat', 'Kantah B', 'Biasa'],
];
const rejected = [
    { row: 2, reason: PESAN_KELAS_MELEBIHI_KEWENANGAN },
    { row: 3, reason: expect.stringContaining('Tanggal "11/25/2026" tampaknya ditulis dengan bulan lebih dulu') },
    { row: 4, reason: 'Tanggal surat yang valid wajib diisi untuk identitas impor yang stabil.' },
    { row: 5, reason: expect.stringMatching(/^Nomor surat kosong memerlukan tanggal, perihal, dan pengirim/) },
    { row: 6, reason: PESAN_SIFAT_TIDAK_DIKENAL },
];
const lookedUp = () => mocks.matches.mock.calls.flatMap(([keys]) => keys.map((key: { nomorSurat: string }) => key.nomorSurat));
let service: GoogleDriveImportService;

beforeEach(() => {
    vi.clearAllMocks();
    service = new GoogleDriveImportService();
    // SM-9/2026 is recorded in the unit; the canonical create finds what this run created.
    mocks.matches.mockImplementation(async (keys: Array<{ nomorSurat: string }>) => recordedMatches(keys.map(key => key.nomorSurat === 'SM-9/2026')));
    const created = new Set<string>();
    mocks.incoming.mockImplementation(async (record: Parameters<typeof suratImportIdentityKey>[1]) => {
        const identity = JSON.stringify(suratImportIdentityKey('masuk', record));
        if (created.has(identity)) throw new DuplicateSuratImportError();
        created.add(identity);
        return { id: identity };
    });
});

describe('import preview judges every row as the import does, without writing', () => {
    it('lists the rows the import rejects, with the import\'s own reasons, and counts the duplicates', async () => {
        const preview = await service.previewRows(register, 3, 'surat-masuk', { importer: adminUnit, unitKerjaId: 'unit-a' });
        expect(preview.rowIssues).toEqual({ total: 5, rows: rejected });
        expect(preview.duplicates).toEqual({ source: 1, recorded: 1, deleted: 0 });
        expect(preview.rows).toHaveLength(3);
        expect(mocks.incoming).not.toHaveBeenCalled();
        // One lookup, as the import makes; a row it rejects before writing is never looked up.
        expect(mocks.matches).toHaveBeenCalledOnce();
        expect(lookedUp()).toEqual(['SM-1/2026', 'SM-6/2026', 'SM-1/2026', 'SM-9/2026']);

        const result = await service.importRows('surat-masuk', register, 'unit-a', adminUnit);
        expect(result.rows?.filter(row => row.status === 'invalid').map(row => ({ row: row.row, reason: row.reason }))).toEqual(rejected);
        expect(result.rows?.map(row => [row.row, row.status, row.duplicate])).toEqual([
            [1, 'imported', undefined], [2, 'invalid', undefined], [3, 'invalid', undefined], [4, 'invalid', undefined],
            [5, 'invalid', undefined], [6, 'invalid', undefined], [7, 'empty', undefined], [8, 'duplicate', 'source'], [9, 'duplicate', 'recorded']]);
    });

    it('judges the rows for the importing role: a super admin may import the Rahasia row', async () => {
        const preview = await service.previewRows(register, 3, 'surat-masuk', { importer: importer('super_admin'), unitKerjaId: 'unit-a' });
        expect(preview.rowIssues?.rows.map(issue => issue.row)).toEqual([3, 4, 5, 6]);
    });

    it('looks nothing up without a destination unit and still finds the repeats inside the source', async () => {
        const preview = await service.previewRows(register, 3, 'surat-masuk', { importer: adminUnit });
        expect(preview.rowIssues).toEqual({ total: 5, rows: rejected });
        expect(preview.duplicates).toEqual({ source: 1 });
        expect(mocks.matches).not.toHaveBeenCalled();
    });

    it('does not reject a recorded letter for a sifat it would only refuse to store anew, like the import', async () => {
        mocks.matches.mockImplementation(async (keys: unknown[]) => recordedMatches(keys.map(() => true), { isDeleted: true }));
        const rows = [header, ['1', 'SM-6/2026', '07/01/2026', 'Sifat asing', 'Kantah A', 'Konfidensial']];
        const preview = await service.previewRows(rows, 1, 'surat-masuk', { importer: adminUnit, unitKerjaId: 'unit-a' });
        expect(preview.rowIssues).toEqual({ total: 0, rows: [] });
        expect(preview.duplicates).toEqual({ source: 0, recorded: 0, deleted: 1 });
        expect((await service.importRows('surat-masuk', rows, 'unit-a', adminUnit)).rows?.[0]).toMatchObject({ status: 'duplicate', duplicate: 'deleted' });
    });

    it('counts a numbered row without a sender as a repeat of an earlier row with that number, as the database compares them', async () => {
        const rows = [header, ['1', 'SM-5/2026', '05/01/2026', 'Dari A', 'Kantah A', 'Biasa'],
            ['2', 'SM-5/2026', '06/01/2026', 'Tanpa pengirim', '', 'Biasa'], ['3', 'SM-5/2026', '07/01/2026', 'Dari B', 'Kantah B', 'Biasa']];
        expect((await service.previewRows(rows, 3, 'surat-masuk', { importer: adminUnit })).duplicates).toEqual({ source: 1 });
    });

    it('lists at most twenty rejected rows and counts them all', async () => {
        const rows = [header, ...Array.from({ length: 25 }, (_, i) => [String(i + 1), `SM-${i + 1}/2026`, '05/01/2026', `Surat ${i + 1}`, 'Kantah A', 'Rahasia'])];
        const { rowIssues } = await service.previewRows(rows, 10, 'surat-masuk', { importer: adminUnit });
        expect(rowIssues?.total).toBe(25);
        expect(rowIssues?.rows.map(issue => issue.row)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });

    it('judges outgoing rows too, which carry no class ceiling', async () => {
        const rows = [['Nomor Surat', 'Tanggal Surat', 'Hal', 'Kepada', 'Sifat Surat'],
            ['SK-1/2026', '05/01/2026', 'Undangan', 'Kantah A', 'Rahasia'], ['-', '06/01/2026', 'Tanpa tujuan', '', 'Biasa']];
        const preview = await service.previewRows(rows, 2, 'surat-keluar', { importer: importer('staff'), unitKerjaId: 'unit-a' });
        expect(preview.rowIssues).toEqual({ total: 1, rows: [{ row: 2, reason: expect.stringMatching(/^Nomor surat kosong/) }] });
        expect(mocks.outgoing).not.toHaveBeenCalled();
    });

    it('keeps the earlier answer without an importer', async () => {
        const preview = await service.previewRows(register, 3, 'surat-masuk');
        expect(preview).not.toHaveProperty('rowIssues');
        expect(preview).not.toHaveProperty('duplicates');
        expect(preview.dateIssues.total).toBe(2);
        expect(mocks.matches).not.toHaveBeenCalled();
    });
});
