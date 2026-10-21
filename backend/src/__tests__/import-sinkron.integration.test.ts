import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import { createMigratedPglite, insertRangkaian, insertSuratKeluar, insertUser, resetRangkaianFixture, seedUnits, uid, type PenggunaUji } from './helpers/lacak-pglite';

// "Sinkron" updates letters an earlier import created when the source changed
// them later, through the canonical update path and its guards.
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let importer: typeof import('../services/google-drive-import.service').googleDriveImportService;
const admin = { id: uid(921), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' } satisfies PenggunaUji;
const audit = { userId: admin.id, userEmail: admin.email };
const sinkron = { actor: admin };
const link = (n: number) => `https://drive.google.com/file/d/synthetic-${n}/view`;

const keluarHeader = ['No', 'Nomor Surat', 'Tanggal Surat', 'Hal', 'Sifat Surat', 'Get link'];
const keluar = (no: number, nomor: string, tanggal: string, hal: string, sifat = 'Biasa', tautan = link(no)) => [String(no), nomor, tanggal, hal, sifat, tautan];
const keluarRow = async (nomor: string, unit = 'dir_bppt') => (await database.query<{
    id: string; perihal: string; sifat_surat: string | null; link_dokumen: string | null; tanggal_surat: string; naskah_dinas: string | null;
}>(`SELECT id, perihal, sifat_surat, link_dokumen, tanggal_surat::text AS tanggal_surat, naskah_dinas
    FROM surat_keluar WHERE nomor_surat = $1 AND unit_kerja_id = $2`, [nomor, unit])).rows[0];
const updates = async (id: string) => (await database.query<{ changes: any; user_id: string }>(
    `SELECT changes, user_id FROM audit_log WHERE entity_id = $1 AND action = 'update' ORDER BY created_at`, [id])).rows;

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    ({ googleDriveImportService: importer } = await import('../services/google-drive-import.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });

beforeEach(async () => {
    await database.exec('TRUNCATE arsip CASCADE; TRUNCATE audit_log');
    await resetRangkaianFixture(database);
    await seedUnits(database, [{ id: 'sesditjen', name: 'Sesditjen', pengawas: true }, { id: 'dir_bppt', name: 'Dit. BPPT' }, { id: 'dir_ptep', name: 'Dit. PTEP' }]);
    await insertUser(database, admin);
});

describe('sinkron surat keluar', () => {
    const first = [keluarHeader,
        keluar(1, '40/UND-600.BP.01.01/VI/2026', '10/06/2026', 'Undangan rapat koordinasi'),
        keluar(2, '41/UND/VI/2026', '11/06/2026', 'Perihal tetap'),
        keluar(3, '42/UND/VI/2026', '12/06/2026', 'Akan disetujui'),
        keluar(4, '43/UND/VI/2026', '13/06/2026', 'Akan diarsipkan'),
        keluar(5, '44/UND/VI/2026', '14/06/2026', 'Akan dihapus'),
        keluar(6, '45/UND/VI/2026', '15/06/2026', 'Akan dirahasiakan'),
    ];
    const changed = [keluarHeader,
        keluar(1, '40/UND-600.BP.01.01/VI/2026', '10/06/2026', 'Undangan rapat koordinasi teknis', 'Segera'),
        // An emptied link never clears the recorded one.
        keluar(2, '41/UND/VI/2026', '11/06/2026', 'Perihal tetap', 'Biasa', ''),
        keluar(3, '42/UND/VI/2026', '12/06/2026', 'Sudah disetujui, diubah di sheet'),
        keluar(4, '43/UND/VI/2026', '13/06/2026', 'Sudah diarsipkan, diubah di sheet'),
        keluar(5, '44/UND/VI/2026', '14/06/2026', 'Sudah dihapus, diubah di sheet'),
        keluar(6, '45/UND/VI/2026', '15/06/2026', 'Sudah rahasia, diubah di sheet'),
        // The register repeats a number; only its first row is applied.
        keluar(7, '40/UND-600.BP.01.01/VI/2026', '10/06/2026', 'Baris ganda dengan perihal lain'),
    ];

    beforeEach(async () => {
        expect(await importer.importRows('surat-keluar', first, 'dir_bppt', audit)).toMatchObject({ importedRows: 6 });
        await database.exec(`
            UPDATE surat_keluar SET approval_status = 'approved' WHERE nomor_surat = '42/UND/VI/2026';
            UPDATE surat_keluar SET is_archived = true WHERE nomor_surat = '43/UND/VI/2026';
            UPDATE surat_keluar SET is_deleted = true WHERE nomor_surat = '44/UND/VI/2026';
            UPDATE surat_keluar SET klasifikasi_keamanan = 'rahasia' WHERE nomor_surat = '45/UND/VI/2026';
            TRUNCATE audit_log;`);
        // The same number in another unit is another letter.
        await insertSuratKeluar(database, { n: 77, unit: 'dir_ptep', nomor: '40/UND-600.BP.01.01/VI/2026', tanggal: '2026-06-10', perihal: 'Surat unit lain' });
    });

    it('leaves recorded letters alone without sinkron, as before', async () => {
        const result = await importer.importRows('surat-keluar', changed, 'dir_bppt', audit);
        expect(result).toMatchObject({ importedRows: 0, duplicateRows: 7 });
        expect((await keluarRow('40/UND-600.BP.01.01/VI/2026')).perihal).toBe('Undangan rapat koordinasi');
        expect(await database.query('SELECT 1 FROM audit_log')).toMatchObject({ rows: [] });
    });

    it('updates changed source fields of the unit\'s open letters with one audit entry each, and says why others stay', async () => {
        const result = await importer.importRows('surat-keluar', changed, 'dir_bppt', audit, {}, undefined, sinkron);

        expect(result).toMatchObject({ importedRows: 0, updatedRows: 1, skippedRows: 0 });
        const updated = await keluarRow('40/UND-600.BP.01.01/VI/2026');
        expect(updated).toMatchObject({ perihal: 'Undangan rapat koordinasi teknis', sifat_surat: 'segera', link_dokumen: link(1) });
        const entries = await updates(updated.id);
        expect(entries).toHaveLength(1);
        expect(entries[0].user_id).toBe(admin.id);
        expect(entries[0].changes).toMatchObject({
            sumber: 'impor_sinkron', fields: ['perihal', 'sifatSurat'],
            before: { perihal: 'Undangan rapat koordinasi', sifatSurat: 'biasa' },
            after: { perihal: 'Undangan rapat koordinasi teknis', sifatSurat: 'segera' },
        });

        expect(result.rows?.map(row => [row.row, row.status, row.reason])).toEqual([
            [1, 'updated', undefined],
            [2, 'duplicate', 'Sudah tercatat; tidak ada perubahan.'],
            [3, 'locked', 'Tidak diperbarui: surat sedang atau telah disetujui.'],
            [4, 'locked', 'Tidak diperbarui: surat sudah diarsipkan.'],
            [5, 'duplicate', 'Surat ini sudah dihapus di SIMSA; impor tidak memulihkan atau mengubahnya.'],
            [6, 'locked', 'Tidak diperbarui: Anda tidak berwenang mengubah surat ini.'],
            [7, 'duplicate', 'Nomor surat dan tahun sama dengan baris data ke-1 pada sumber ini.'],
        ]);
        expect(result.rows?.[0].changes).toEqual([
            { field: 'perihal', label: 'Perihal', before: 'Undangan rapat koordinasi', after: 'Undangan rapat koordinasi teknis' },
            { field: 'sifatSurat', label: 'Sifat surat', before: 'biasa', after: 'segera' },
        ]);
        // What would change is shown where the person may read the letter, never for one they may not.
        expect(result.rows?.[2].changes).toEqual([{ field: 'perihal', label: 'Perihal', before: 'Akan disetujui', after: 'Sudah disetujui, diubah di sheet' }]);
        expect(result.rows?.[5]).not.toHaveProperty('changes');

        expect((await keluarRow('41/UND/VI/2026')).link_dokumen).toBe(link(2));
        for (const [nomor, perihal] of [['42/UND/VI/2026', 'Akan disetujui'], ['43/UND/VI/2026', 'Akan diarsipkan'],
            ['44/UND/VI/2026', 'Akan dihapus'], ['45/UND/VI/2026', 'Akan dirahasiakan']]) {
            const row = await keluarRow(nomor);
            expect(row.perihal).toBe(perihal);
            expect(await updates(row.id)).toEqual([]);
        }
        expect((await keluarRow('40/UND-600.BP.01.01/VI/2026', 'dir_ptep')).perihal).toBe('Surat unit lain');
    });

    it('is idempotent: a second run finds nothing to change', async () => {
        await importer.importRows('surat-keluar', changed, 'dir_bppt', audit, {}, undefined, sinkron);
        const again = await importer.importRows('surat-keluar', changed, 'dir_bppt', audit, {}, undefined, sinkron);
        expect(again).toMatchObject({ updatedRows: 0 });
        expect(again.rows?.[0]).toMatchObject({ status: 'duplicate', reason: 'Sudah tercatat; tidak ada perubahan.' });
        expect(await updates((await keluarRow('40/UND-600.BP.01.01/VI/2026')).id)).toHaveLength(1);
    });

    it('changes only columns the source maps: a register without Sifat or link leaves them', async () => {
        const narrow = [['No', 'Nomor Surat', 'Tanggal Surat', 'Hal', 'Jenis Naskah'],
            ['1', '40/UND-600.BP.01.01/VI/2026', '2026-06-11', 'Undangan rapat koordinasi', 'Undangan']];
        const result = await importer.importRows('surat-keluar', narrow, 'dir_bppt', audit, {}, undefined, sinkron);
        expect(result.rows?.[0]).toMatchObject({ status: 'updated', changes: [
            { field: 'tanggalSurat', label: 'Tanggal surat', before: '2026-06-10', after: '2026-06-11' },
            { field: 'naskahDinas', label: 'Jenis naskah', before: 'Surat Dinas', after: 'Undangan' },
        ] });
        expect(await keluarRow('40/UND-600.BP.01.01/VI/2026')).toMatchObject({
            tanggal_surat: '2026-06-11', naskah_dinas: 'Undangan', sifat_surat: 'biasa', link_dokumen: link(1) });
    });
});

describe('sinkron surat masuk', () => {
    const header = ['Nomor Surat', 'Tanggal Surat', 'Perihal', 'Dari', 'Sifat Surat', 'Jenis Surat'];
    const masuk = (nomor: string, perihal: string, sifat = 'Biasa', jenis = 'Surat Dinas') => [nomor, '02/03/2026', perihal, 'Kantah A', sifat, jenis];
    const perihalOf = async (nomor: string) => (await database.query<{ id: string; perihal: string; sifat_surat: string; jenis_surat: string }>(
        'SELECT id, perihal, sifat_surat, jenis_surat FROM surat_masuk WHERE nomor_surat = $1', [nomor])).rows[0];

    it('never changes the sifat, which is the letter\'s security classification', async () => {
        await importer.importRows('surat-masuk', [header, masuk('SM-1/2026', 'Permohonan data')], 'dir_bppt', audit);
        const result = await importer.importRows('surat-masuk', [header, masuk('SM-1/2026', 'Permohonan data pertanahan', 'Rahasia', 'Nota Dinas')],
            'dir_bppt', audit, {}, undefined, sinkron);
        expect(result.rows?.[0]).toMatchObject({ status: 'updated', changes: [
            { field: 'perihal', label: 'Perihal', before: 'Permohonan data', after: 'Permohonan data pertanahan' },
            { field: 'jenisSurat', label: 'Jenis surat', before: 'Surat Dinas', after: 'Nota Dinas' },
        ] });
        expect(await perihalOf('SM-1/2026')).toMatchObject({ perihal: 'Permohonan data pertanahan', sifat_surat: 'Biasa', jenis_surat: 'Nota Dinas' });
    });

    it('leaves a letter in a rangkaian to its own correction flow, which needs a reason', async () => {
        await importer.importRows('surat-masuk', [header, masuk('SM-2/2026', 'Undangan')], 'dir_bppt', audit);
        const letter = await perihalOf('SM-2/2026');
        await insertRangkaian(database, { n: 1, kode: 'RS-2026-000001', tahun: 2026, pencatat: 'dir_bppt', judul: 'Undangan',
            anggota: [{ jenis: 'surat_masuk', id: letter.id, peran: 'induk', unit: 'dir_bppt' }] });
        const result = await importer.importRows('surat-masuk', [header, masuk('SM-2/2026', 'Undangan rapat')], 'dir_bppt', audit, {}, undefined, sinkron);
        expect(result.rows?.[0]).toMatchObject({ status: 'locked',
            reason: expect.stringMatching(/^Tidak diperbarui: Perubahan nomor\/perihal\/sifat .* wajib disertai alasan/) });
        expect((await perihalOf('SM-2/2026')).perihal).toBe('Undangan');
    });
});
