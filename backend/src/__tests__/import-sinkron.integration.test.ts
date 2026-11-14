import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import { createMigratedPglite, insertRangkaian, insertSuratKeluar, insertUser, resetRangkaianFixture, seedUnits, uid, type PenggunaUji } from './helpers/lacak-pglite';
import { PESAN_KELAS_MELEBIHI_KEWENANGAN, PESAN_SIFAT_TIDAK_DIKENAL } from '../constants/pesan-akses';

// "Sinkron" updates letters an earlier import created when the source changed
// them later, through the canonical update path and its guards.
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let importer: typeof import('../services/google-drive-import.service').googleDriveImportService;
const admin = { id: uid(921), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' } satisfies PenggunaUji;
const audit = { userId: admin.id, userEmail: admin.email, role: admin.role };
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
            [5, 'duplicate', 'Surat dengan identitas ini sudah dihapus di SIMSA; impor tidak membuat ulang, memulihkan, atau mengubahnya.'],
            [6, 'locked', 'Tidak diperbarui: Anda tidak berwenang mengubah surat ini.'],
            [7, 'duplicate', 'Nomor surat dan tahun sama dengan baris data ke-1 pada sumber ini.'],
        ]);
        expect(result.rows?.map(row => row.duplicate)).toEqual([undefined, 'recorded', undefined, undefined, 'deleted', undefined, 'source']);
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

    it('applies one row per letter even when an unnumbered row matches the same letter by its link', async () => {
        const rows = [keluarHeader,
            keluar(1, '40/UND-600.BP.01.01/VI/2026', '10/06/2026', 'Undangan rapat koordinasi', 'Segera'),
            keluar(1, '-', '10/06/2026', 'Undangan rapat koordinasi', 'Penting')];
        const result = await importer.importRows('surat-keluar', rows, 'dir_bppt', audit, {}, undefined, sinkron);
        expect(result.rows?.map(row => [row.status, row.reason])).toEqual([
            ['updated', undefined], ['duplicate', 'Surat yang sama sudah dicocokkan dengan baris data ke-1 pada sumber ini.']]);
        expect(result.rows?.[1].duplicate).toBe('source');
        const letter = await keluarRow('40/UND-600.BP.01.01/VI/2026');
        expect(letter.sifat_surat).toBe('segera');
        expect(await updates(letter.id)).toHaveLength(1);
    });

    it('stores and compares source text the way the edit form does', async () => {
        const rows = [keluarHeader, keluar(2, '41/UND/VI/2026', '11/06/2026', '  Perihal   <b>tetap</b> ')];
        const result = await importer.importRows('surat-keluar', rows, 'dir_bppt', audit, {}, undefined, sinkron);
        expect(result.rows?.[0]).toMatchObject({ status: 'duplicate', reason: 'Sudah tercatat; tidak ada perubahan.' });
        const changed = await importer.importRows('surat-keluar', [keluarHeader, keluar(2, '41/UND/VI/2026', '11/06/2026', 'Perihal <i>baru</i>')],
            'dir_bppt', audit, {}, undefined, sinkron);
        expect(changed.rows?.[0]).toMatchObject({ status: 'updated' });
        expect((await keluarRow('41/UND/VI/2026')).perihal).toBe('Perihal baru');
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

    it('stores a day-first date as written and leaves the letter alone when the date cannot be read', async () => {
        const rows = [keluarHeader,
            keluar(1, '40/UND-600.BP.01.01/VI/2026', '06/13/2026', 'Perihal dari baris yang ditolak'),
            keluar(2, '41/UND/VI/2026', '05.06.26', 'Perihal tetap'),
            keluar(8, '48/UND/VI/2026', '03/06/2026 23:30', 'Surat baru')];
        const result = await importer.importRows('surat-keluar', rows, 'dir_bppt', audit, {}, undefined, sinkron);
        expect(result.rows?.map(row => row.status)).toEqual(['invalid', 'updated', 'imported']);
        expect(result.rows?.[0].reason).toContain('Tanggal "06/13/2026" tampaknya ditulis dengan bulan lebih dulu');
        expect(result.rows?.[1].changes).toEqual([{ field: 'tanggalSurat', label: 'Tanggal surat', before: '2026-06-11', after: '2026-06-05' }]);
        expect(await keluarRow('40/UND-600.BP.01.01/VI/2026')).toMatchObject({ tanggal_surat: '2026-06-10', perihal: 'Undangan rapat koordinasi' });
        // 5 June and 3 June, not 6 May and 6 March, and not moved a day by the time.
        expect((await keluarRow('41/UND/VI/2026')).tanggal_surat).toBe('2026-06-05');
        expect((await keluarRow('48/UND/VI/2026')).tanggal_surat).toBe('2026-06-03');
    });
});

describe('sinkron surat masuk', () => {
    const header = ['Nomor Surat', 'Tanggal Surat', 'Perihal', 'Dari', 'Sifat Surat', 'Jenis Surat'];
    const masuk = (nomor: string, perihal: string, sifat = 'Biasa', jenis = 'Surat Dinas') => [nomor, '02/03/2026', perihal, 'Kantah A', sifat, jenis];
    const perihalOf = async (nomor: string) => (await database.query<{ id: string; perihal: string; sifat_surat: string; jenis_surat: string }>(
        'SELECT id, perihal, sifat_surat, jenis_surat FROM surat_masuk WHERE nomor_surat = $1', [nomor])).rows[0];

    it('never changes the sifat, which is the letter\'s security classification', async () => {
        await importer.importRows('surat-masuk', [header, masuk('SM-1/2026', 'Permohonan data')], 'dir_bppt', audit);
        // Terbatas is within an Admin Unit Kerja's ceiling, so the row is applied without its sifat.
        const result = await importer.importRows('surat-masuk', [header, masuk('SM-1/2026', 'Permohonan data pertanahan', 'Terbatas', 'Nota Dinas')],
            'dir_bppt', audit, {}, undefined, sinkron);
        expect(result.rows?.[0]).toMatchObject({ status: 'updated', changes: [
            { field: 'perihal', label: 'Perihal', before: 'Permohonan data', after: 'Permohonan data pertanahan' },
            { field: 'jenisSurat', label: 'Jenis surat', before: 'Surat Dinas', after: 'Nota Dinas' },
        ] });
        expect(await perihalOf('SM-1/2026')).toMatchObject({ perihal: 'Permohonan data pertanahan', sifat_surat: 'Biasa', jenis_surat: 'Nota Dinas' });
    });

    it('still updates a recorded letter from a row whose sifat names no class, but never stores such a row as a new letter', async () => {
        await importer.importRows('surat-masuk', [header, masuk('SM-3/2026', 'Permohonan data')], 'dir_bppt', audit);
        const result = await importer.importRows('surat-masuk', [header,
            ['SM-3/2026', '04/03/2026', 'Permohonan data pertanahan', 'Kantah A', 'Konfidensial', 'Nota Dinas'],
            masuk('SM-4/2026', 'Surat baru', 'Konfidensial')], 'dir_bppt', audit, {}, undefined, sinkron);

        expect(result).toMatchObject({ success: false, updatedRows: 1, importedRows: 0, skippedRows: 1 });
        expect(result.rows?.map(row => [row.nomorSurat, row.status, row.reason])).toEqual([
            ['SM-3/2026', 'updated', undefined], ['SM-4/2026', 'invalid', PESAN_SIFAT_TIDAK_DIKENAL]]);
        expect(result.rows?.[0].changes?.map(change => change.field)).toEqual(['perihal', 'tanggalSurat', 'jenisSurat']);
        expect(await perihalOf('SM-3/2026')).toMatchObject({ perihal: 'Permohonan data pertanahan', sifat_surat: 'Biasa', jenis_surat: 'Nota Dinas' });
        expect(await perihalOf('SM-4/2026')).toBeUndefined();
    });

    it('records the letter of another sender with the same number as a new letter and leaves the recorded one alone', async () => {
        await importer.importRows('surat-masuk', [header, ['045/2026', '02/03/2026', 'Permohonan', 'Dinas B', 'Biasa', 'Surat Dinas']], 'dir_bppt', audit);
        const result = await importer.importRows('surat-masuk', [header, ['045/2026', '05/03/2026', 'Undangan', 'Dinas A', 'Biasa', 'Surat Dinas']],
            'dir_bppt', audit, {}, undefined, sinkron);
        expect(result).toMatchObject({ importedRows: 1, updatedRows: 0 });
        expect((await database.query('SELECT dari, perihal FROM surat_masuk WHERE nomor_surat = $1 ORDER BY dari', ['045/2026'])).rows)
            .toEqual([{ dari: 'Dinas A', perihal: 'Undangan' }, { dari: 'Dinas B', perihal: 'Permohonan' }]);
    });

    it('updates the letter of the same sender written in another letter case and spacing', async () => {
        await importer.importRows('surat-masuk', [header, ['046/2026', '02/03/2026', 'Permohonan', 'Dinas B', 'Biasa', 'Surat Dinas']], 'dir_bppt', audit);
        const result = await importer.importRows('surat-masuk', [header, ['046/2026', '02/03/2026', 'Permohonan data', ' DINAS  b ', 'Biasa', 'Surat Dinas']],
            'dir_bppt', audit, {}, undefined, sinkron);
        expect(result.rows?.[0]).toMatchObject({ status: 'updated', changes: [{ field: 'perihal', label: 'Perihal', before: 'Permohonan', after: 'Permohonan data' }] });
        expect(await perihalOf('046/2026')).toMatchObject({ perihal: 'Permohonan data' });
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

// Senders number their letters independently, so a numbered surat masuk is
// recognised by its number, year, and sender; a surat keluar by number and year.
describe('import identity of numbered letters', () => {
    const header = ['Nomor Surat', 'Tanggal Surat', 'Perihal', 'Dari'];
    const letters = async (nomor: string) => (await database.query<{ dari: string; perihal: string }>(
        "SELECT dari, perihal FROM surat_masuk WHERE nomor_surat = $1 AND unit_kerja_id = 'dir_bppt' ORDER BY perihal", [nomor])).rows;

    it('records the same number and year from another sender, and keeps the same sender a duplicate whatever its spelling', async () => {
        await importer.importRows('surat-masuk', [header, ['001/2026', '02/03/2026', 'Permohonan A', 'Instansi A']], 'dir_bppt', audit);
        const result = await importer.importRows('surat-masuk', [header,
            ['001/2026', '04/03/2026', 'Permohonan B', 'Instansi B'],
            ['001/2026', '02/03/2026', 'Permohonan A lagi', '  INSTANSI  a '],
            // A row without a sender tells no letter apart: its number and year decide, as before.
            ['001/2026', '05/03/2026', 'Tanpa pengirim', ''],
        ], 'dir_bppt', audit);
        expect(result.rows?.map(row => [row.status, row.duplicate])).toEqual([['imported', undefined], ['duplicate', 'recorded'], ['duplicate', 'recorded']]);
        expect(await letters('001/2026')).toEqual([{ dari: 'Instansi A', perihal: 'Permohonan A' }, { dari: 'Instansi B', perihal: 'Permohonan B' }]);
    });

    it('tells rows of one source apart by their sender and names the earlier row of the same sender', async () => {
        const result = await importer.importRows('surat-masuk', [header,
            ['002/2026', '02/03/2026', 'Dari A', 'Instansi A'],
            ['002/2026', '03/03/2026', 'Dari B', 'Instansi B'],
            ['002/2026', '04/03/2026', 'Dari A lagi', 'instansi  a']], 'dir_bppt', audit);
        expect(result.rows?.map(row => [row.status, row.reason])).toEqual([['imported', undefined], ['imported', undefined],
            ['duplicate', 'Nomor surat, tahun, dan pengirim sama dengan baris data ke-1 pada sumber ini.']]);
        expect(await letters('002/2026')).toEqual([{ dari: 'Instansi A', perihal: 'Dari A' }, { dari: 'Instansi B', perihal: 'Dari B' }]);
    });

    it('reads a recorded sender with a non-breaking space, or none, as the import reads the source', async () => {
        await database.query(`INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun, nomor_surat, tanggal_surat, perihal, dari, sifat_surat)
            VALUES ('dir_bppt', 1, 2026, '003/2026', '2026-03-02', 'Tercatat', 'Kantor Pertanahan', 'Biasa'),
                   ('dir_bppt', 2, 2026, '004/2026', '2026-03-02', 'Tercatat tanpa pengirim', NULL, 'Biasa')`);
        const result = await importer.importRows('surat-masuk', [header,
            ['003/2026', '02/03/2026', 'Ulang', 'kantor pertanahan'], ['004/2026', '02/03/2026', 'Ulang', 'Instansi C']], 'dir_bppt', audit);
        expect(result).toMatchObject({ importedRows: 0, duplicateRows: 2 });
        // The canonical create repeats the lookup under the unit lock with the same comparison.
        const { suratMasukService } = await import('../services/surat-masuk.service');
        await expect(suratMasukService.createImported({ unitKerjaId: 'dir_bppt', noUrut: 9, tahun: 2026, nomorSurat: '003/2026',
            tanggalSurat: '2026-03-05', perihal: 'Ulang', dari: 'KANTOR PERTANAHAN', sifatSurat: 'Biasa', createdBy: admin.id }, audit))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('lets the preview count the recorded letters of the unit and the rejected rows without writing anything', async () => {
        await importer.importRows('surat-masuk', [header, ['005/2026', '02/03/2026', 'Tercatat', 'Instansi A']], 'dir_bppt', audit);
        const count = async () => Number((await database.query<{ n: string }>('SELECT count(*) AS n FROM surat_masuk')).rows[0].n);
        const auditRows = async () => Number((await database.query<{ n: string }>('SELECT count(*) AS n FROM audit_log')).rows[0].n);
        const [lettersBefore, auditBefore] = [await count(), await auditRows()];
        const rows = [[...header, 'Sifat Surat'], ['005/2026', '02/03/2026', 'Tercatat', 'instansi a', 'Biasa'],
            ['006/2026', '03/03/2026', 'Baru', 'Instansi A', 'Biasa'], ['007/2026', '04/03/2026', 'Rahasia', 'Instansi A', 'Rahasia']];
        const preview = await importer.previewRows(rows, 10, 'surat-masuk', { importer: audit, unitKerjaId: 'dir_bppt' });
        expect(preview.rowIssues).toEqual({ total: 1, rows: [{ row: 3, reason: PESAN_KELAS_MELEBIHI_KEWENANGAN }] });
        expect(preview.duplicates).toEqual({ source: 0, recorded: 1, deleted: 0 });
        // Another unit has none of these letters.
        expect((await importer.previewRows(rows, 10, 'surat-masuk', { importer: audit, unitKerjaId: 'dir_ptep' })).duplicates)
            .toEqual({ source: 0, recorded: 0, deleted: 0 });
        expect([await count(), await auditRows()]).toEqual([lettersBefore, auditBefore]);
    });

    it('keeps identifying a numbered surat keluar by its number and year only', async () => {
        const rows = [['Nomor Surat', 'Tanggal Surat', 'Hal', 'Kepada'],
            ['SK-9/2026', '02/03/2026', 'Undangan', 'Instansi A'], ['SK-9/2026', '03/03/2026', 'Undangan lain', 'Instansi B']];
        const result = await importer.importRows('surat-keluar', rows, 'dir_bppt', audit);
        expect(result.rows?.map(row => [row.status, row.reason])).toEqual([['imported', undefined],
            ['duplicate', 'Nomor surat dan tahun sama dengan baris data ke-1 pada sumber ini.']]);
    });
});

// The sifat of a surat masuk is its security class; an import sets only what the importer could set in the form.
describe('class ceiling of imported surat masuk', () => {
    const superAdmin = { id: uid(922), email: 'super@example.test', name: 'Super Admin', role: 'super_admin', unitKerjaId: null } satisfies PenggunaUji;
    const superAudit = { userId: superAdmin.id, userEmail: superAdmin.email, role: superAdmin.role };
    const header = ['Nomor Surat', 'Tanggal Surat', 'Perihal', 'Dari', 'Sifat Surat'];
    const masuk = (nomor: string, perihal: string, sifat: string) => [nomor, '02/03/2026', perihal, 'Kantah A', sifat];
    const letters = async () => (await database.query<{ id: string; nomor_surat: string; perihal: string; sifat_surat: string }>(
        "SELECT id, nomor_surat, perihal, sifat_surat FROM surat_masuk WHERE unit_kerja_id = 'dir_bppt' ORDER BY nomor_surat")).rows;
    const created = async () => Number((await database.query<{ n: string }>("SELECT count(*) AS n FROM audit_log WHERE entity_type = 'surat_masuk' AND action = 'create'")).rows[0].n);
    beforeEach(async () => { await insertUser(database, superAdmin); });

    it('rejects an Admin Unit Kerja\'s Rahasia and Sangat Rahasia rows without writing them, and imports the rest', async () => {
        const result = await importer.importRows('surat-masuk', [header, masuk('SM-B/2026', 'Biasa', 'Biasa'),
            masuk('SM-R/2026', 'Rahasia', 'Rahasia'), masuk('SM-SR/2026', 'Sangat rahasia', 'Sangat Rahasia'),
            masuk('SM-T/2026', 'Terbatas', 'Terbatas')], 'dir_bppt', audit);

        expect(result).toMatchObject({ success: false, importedRows: 2, skippedRows: 2, duplicateRows: 0 });
        expect(result.rows?.map(row => [row.nomorSurat, row.status, row.reason])).toEqual([
            ['SM-B/2026', 'imported', undefined],
            ['SM-R/2026', 'invalid', PESAN_KELAS_MELEBIHI_KEWENANGAN],
            ['SM-SR/2026', 'invalid', PESAN_KELAS_MELEBIHI_KEWENANGAN],
            ['SM-T/2026', 'imported', undefined],
        ]);
        expect((await letters()).map(row => [row.nomor_surat, row.sifat_surat])).toEqual([['SM-B/2026', 'Biasa'], ['SM-T/2026', 'Terbatas']]);
        expect(await created()).toBe(2);
    });

    it('lets a super admin import them; an Admin Unit Kerja\'s sinkron rejects those rows instead of matching their letters', async () => {
        const rows = (suffix: string) => [header, masuk('SM-B/2026', `Biasa${suffix}`, 'Biasa'),
            masuk('SM-R/2026', `Rahasia${suffix}`, 'Rahasia'), masuk('SM-SR/2026', `Sangat rahasia${suffix}`, 'Sangat Rahasia')];
        expect(await importer.importRows('surat-masuk', rows(''), 'dir_bppt', superAudit)).toMatchObject({ success: true, importedRows: 3 });
        expect((await letters()).map(row => row.sifat_surat)).toEqual(['Biasa', 'Rahasia', 'Sangat Rahasia']);
        await database.exec('TRUNCATE audit_log');

        const result = await importer.importRows('surat-masuk', rows(' diubah'), 'dir_bppt', audit, {}, undefined, sinkron);

        expect(result).toMatchObject({ success: false, updatedRows: 1, duplicateRows: 0, skippedRows: 2 });
        expect(result.rows?.map(row => [row.status, row.reason])).toEqual([
            ['updated', undefined], ['invalid', PESAN_KELAS_MELEBIHI_KEWENANGAN], ['invalid', PESAN_KELAS_MELEBIHI_KEWENANGAN]]);
        const [biasa, rahasia, sangatRahasia] = await letters();
        expect(biasa.perihal).toBe('Biasa diubah');
        for (const letter of [rahasia, sangatRahasia]) {
            expect(letter.perihal).not.toMatch(/diubah$/);
            expect(await updates(letter.id)).toEqual([]);
        }
    });
});
