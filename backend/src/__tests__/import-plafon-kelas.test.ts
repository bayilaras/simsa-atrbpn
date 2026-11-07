import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedMatches } from './helpers/import-matches.js';

// Real identity rules; the canonical creates and the bulk lookup are mocked.
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
import { assertImportedKelasSuratMasuk } from '../services/import-plafon-kelas.js';
import { PESAN_KELAS_MELEBIHI_KEWENANGAN } from '../constants/pesan-akses.js';
import { ForbiddenError } from '../utils/errors.js';

const importer = (role: string | undefined) => ({ userId: '11111111-1111-4111-8111-111111111111', role });
const adminUnit = importer('admin_unit');
const superAdmin = importer('super_admin');
const header = ['No', 'Nomor Surat', 'Tanggal Surat', 'Perihal', 'Dari', 'Sifat Surat'];
const masuk = (no: number, sifat: string, nomor = `SM-${no}/2026`) => [String(no), nomor, '05/01/2026', `Perihal ${no}`, 'Kantah A', sifat];
const register = [header, masuk(1, 'Biasa'), masuk(2, 'Rahasia'), masuk(3, 'Sangat Rahasia'), masuk(4, 'Terbatas'), masuk(5, 'Segera')];
const createdNumbers = () => mocks.incoming.mock.calls.map(([record]) => record.nomorSurat);
const lookedUp = () => mocks.matches.mock.calls.flatMap(([keys]) => keys.map((key: { nomorSurat: string }) => key.nomorSurat));
let service: GoogleDriveImportService;

beforeEach(() => {
    vi.clearAllMocks();
    service = new GoogleDriveImportService();
    mocks.incoming.mockResolvedValue({ id: 'incoming' });
    mocks.outgoing.mockResolvedValue({ id: 'outgoing' });
    mocks.matches.mockImplementation(async (keys: unknown[]) => keys.map(() => []));
});

describe('class ceiling of an imported surat masuk', () => {
    const allowed = (role: string | undefined, sifat: string) => {
        try { assertImportedKelasSuratMasuk(importer(role), sifat); return true; } catch (error) {
            expect(error).toBeInstanceOf(ForbiddenError);
            expect((error as Error).message).toBe(PESAN_KELAS_MELEBIHI_KEWENANGAN);
            return false;
        }
    };

    it.each([
        ['super_admin', [true, true, true, true]],
        ['admin_unit', [true, true, false, false]],
        ['admin_dirjen', [true, true, false, false]],
        ['admin_sesditjen', [true, true, false, false]],
        ['staff', [true, false, false, false]],
        // Without a known role nothing passes, as in the form.
        [undefined, [false, false, false, false]],
    ] as const)('lets %s set the classes kelasUntukRole allows', (role, expected) => {
        expect(['Biasa', 'Terbatas', 'Rahasia', 'Sangat Rahasia'].map(sifat => allowed(role, sifat))).toEqual(expected);
    });

    it('reads the sifat as the form and the read paths do: urgency words are biasa, spelling variants still a class', () => {
        for (const sifat of ['Segera', 'Sangat Segera', 'Penting', 'Undangan', 'Biasa/Terbuka', '']) expect(allowed('staff', sifat)).toBe(true);
        for (const sifat of [' RAHASIA ', 'sangat-rahasia', 'Sangat  Rahasia', ' Rahasia']) expect(allowed('admin_unit', sifat)).toBe(false);
    });

    it('leaves a sifat that names no class to the existing import behaviour', () => {
        expect(allowed('admin_unit', 'Konfidensial')).toBe(true);
    });
});

describe('importing rows above the importer\'s class ceiling', () => {
    it('rejects each such row with the form\'s message and imports the others', async () => {
        const result = await service.importRows('surat-masuk', register, 'unit-a', adminUnit);

        expect(result).toMatchObject({ success: false, totalRows: 5, importedRows: 3, skippedRows: 2, duplicateRows: 0, updatedRows: 0 });
        expect(result.errors).toEqual([`Row 2: ${PESAN_KELAS_MELEBIHI_KEWENANGAN} (FORBIDDEN)`, `Row 3: ${PESAN_KELAS_MELEBIHI_KEWENANGAN} (FORBIDDEN)`]);
        expect(result.rows?.map(row => [row.row, row.nomorSurat, row.status, row.reason])).toEqual([
            [1, 'SM-1/2026', 'imported', undefined],
            [2, 'SM-2/2026', 'invalid', PESAN_KELAS_MELEBIHI_KEWENANGAN],
            [3, 'SM-3/2026', 'invalid', PESAN_KELAS_MELEBIHI_KEWENANGAN],
            [4, 'SM-4/2026', 'imported', undefined],
            [5, 'SM-5/2026', 'imported', undefined],
        ]);
        expect(createdNumbers()).toEqual(['SM-1/2026', 'SM-4/2026', 'SM-5/2026']);
        // Like any row rejected before a write, it is not even looked up.
        expect(lookedUp()).toEqual(['SM-1/2026', 'SM-4/2026', 'SM-5/2026']);
    });

    it('imports every row for a super admin, with the sifat as written', async () => {
        const result = await service.importRows('surat-masuk', register, 'unit-a', superAdmin);
        expect(result).toMatchObject({ success: true, importedRows: 5, skippedRows: 0, errors: [] });
        expect(mocks.incoming.mock.calls.map(([record]) => record.sifatSurat)).toEqual(['Biasa', 'Rahasia', 'Sangat Rahasia', 'Terbatas', 'Segera']);
    });

    it('is no earlier row of its identity: a later row with the same number is judged on its own', async () => {
        mocks.matches.mockImplementation(async (keys: unknown[]) => recordedMatches(keys.map(() => true)));
        const rows = [header, masuk(1, 'Rahasia', 'SM-9/2026'), masuk(2, 'Biasa', 'SM-9/2026')];
        const result = await service.importRows('surat-masuk', rows, 'unit-a', adminUnit);
        expect(result.rows?.map(row => [row.status, row.duplicate, row.reason])).toEqual([
            ['invalid', undefined, PESAN_KELAS_MELEBIHI_KEWENANGAN],
            ['duplicate', 'recorded', 'Sudah tercatat di SIMSA pada unit ini.'],
        ]);
        expect(lookedUp()).toEqual(['SM-9/2026']);
    });

    it('rejects such a row with sinkron too, before it can match a recorded letter', async () => {
        mocks.matches.mockImplementation(async (keys: unknown[]) => recordedMatches(keys.map(() => true)));
        const result = await service.importRows('surat-masuk', [header, masuk(1, 'Sangat Rahasia')], 'unit-a', adminUnit, {}, undefined,
            { actor: { id: adminUnit.userId, role: 'admin_unit', unitKerjaId: 'unit-a' } });
        expect(result).toMatchObject({ updatedRows: 0, duplicateRows: 0, skippedRows: 1 });
        expect(result.rows?.[0]).toMatchObject({ status: 'invalid', reason: PESAN_KELAS_MELEBIHI_KEWENANGAN });
        expect(mocks.matches).not.toHaveBeenCalled();
    });

    it('resumes across a rejected row with a digest of the rows as read, whoever imports', async () => {
        // A spent budget: every part handles exactly one row.
        const part = (actor: ReturnType<typeof importer>, resume: { startRow: number; prefixHash?: string }) =>
            service.importRows('surat-masuk', register, 'unit-a', actor, {}, { ...resume, deadlineAt: Date.now() - 1 });
        const parts = [];
        let resume: { startRow: number; prefixHash?: string } = { startRow: 0 };
        for (;;) {
            const result = await part(adminUnit, resume);
            parts.push(result);
            if (result.nextRow === null) break;
            resume = { startRow: result.nextRow!, prefixHash: result.prefixHash };
        }
        expect(parts.map(result => [result.startRow, result.rows?.[0].status, result.nextRow])).toEqual([
            [0, 'imported', 1], [1, 'invalid', 2], [2, 'invalid', 3], [3, 'imported', 4], [4, 'imported', null]]);
        expect(createdNumbers()).toEqual(['SM-1/2026', 'SM-4/2026', 'SM-5/2026']);

        // The digest covers the source, not the outcome: a super admin's part after the same rows proves the same prefix.
        const afterRejected = parts[2];
        const sameRows = await part(superAdmin, { startRow: 2, prefixHash: parts[1].prefixHash });
        expect(sameRows).toMatchObject({ nextRow: 3, prefixHash: afterRejected.prefixHash, importedRows: 1 });
    });

    it('leaves surat keluar alone: its sifat is urgency, and an import never sets its security class', async () => {
        const rows = [['Nomor Surat', 'Tanggal Surat', 'Hal', 'Kepada', 'Sifat Surat'], ['SK-1/2026', '05/01/2026', 'Undangan', 'Kantah A', 'Rahasia']];
        const result = await service.importRows('surat-keluar', rows, 'unit-a', importer('staff'));
        expect(result).toMatchObject({ success: true, importedRows: 1 });
        expect(mocks.outgoing.mock.calls[0][0]).not.toHaveProperty('klasifikasiKeamanan');
    });
});
