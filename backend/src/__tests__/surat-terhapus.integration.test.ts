import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { kelasUntukRole } from '../services/access/visibility-spec';
import { PENGGUNA, RANGKAIAN, SURAT, USER_ID, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

// Daftar Surat Terhapus dan pemulihan oleh Super Admin, dijalankan pada skema
// migrasi penuh. Surat dihapus lewat jalur hapus yang sebenarnya.

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let suratMasukService: typeof import('../services/surat-masuk.service').suratMasukService;
let suratKeluarService: typeof import('../services/surat-keluar.service').suratKeluarService;
let terhapus: typeof import('../services/surat-terhapus.service');

const auditTu = { userId: USER_ID.tu, userEmail: 'tu@example.test' };
const auditBppt = { userId: USER_ID.bppt, userEmail: 'bppt@example.test' };
const auditSuper = { userId: USER_ID.superAdmin, userEmail: 'super@example.test' };
const SUPER = PENGGUNA.superAdmin as any;
const SEMUA_KELAS = kelasUntukRole('super_admin');
const ALASAN_HAPUS = 'Surat ganda, sudah dicatat ulang';
const ALASAN_PULIH = 'Salah hapus, surat masih dipakai';
const SM_LAIN = '30000000-0000-4000-8000-0000000000a1';

async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
    return (await database.query<T>(text, params)).rows[0];
}
const daftarMasuk = (filter: Record<string, unknown> = {}) =>
    terhapus.suratTerhapusService.daftar('surat_masuk', { securityClassifications: SEMUA_KELAS, ...filter });
const pulihkan = (jenis: 'surat_masuk' | 'surat_keluar', id: string, user = SUPER) =>
    terhapus.suratTerhapusService.pulihkan(jenis, id, user, ALASAN_PULIH, auditSuper);

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    ({ suratMasukService } = await import('../services/surat-masuk.service'));
    ({ suratKeluarService } = await import('../services/surat-keluar.service'));
    terhapus = await import('../services/surat-terhapus.service');
}, 120_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => { await seedRangkaianFixture(database); });

describe('daftar Surat Terhapus', () => {
    it('memuat nomor, perihal, nama unit, penghapus, waktu, dan alasan hapus dari audit', async () => {
        await suratMasukService.delete(SURAT.smTunggal, USER_ID.tu, 'sesditjen', auditTu, { alasan: ALASAN_HAPUS });
        const hasil = await daftarMasuk();
        expect(hasil.pagination.total).toBe(1);
        expect(hasil.data).toEqual([expect.objectContaining({
            id: SURAT.smTunggal, nomorSurat: 'SM-3/2026', perihal: 'Surat tunggal TU', noUrut: 3, tahun: 2026,
            unitKerjaId: 'sesditjen', unitKerjaNama: 'Sekretariat Ditjen', dihapusOleh: 'tu@example.test', alasanHapus: ALASAN_HAPUS,
        })]);
        expect(hasil.data[0].deletedAt).toBeTruthy();
        expect(await daftarMasuk({ search: 'sm-3' })).toMatchObject({ pagination: { total: 1 } });
        expect(await daftarMasuk({ search: 'tidak ada' })).toMatchObject({ data: [], pagination: { total: 0 } });
        expect(await daftarMasuk({ unitKerjaId: 'dir_bppt' })).toMatchObject({ data: [] });
    });

    it('nama penghapus diambil dari profilnya; surat lama tanpa catatan hapus tetap tampil tanpa alasan', async () => {
        await database.exec(`UPDATE users SET name = 'Petugas TU' WHERE id = '${USER_ID.tu}';
            UPDATE surat_masuk SET is_deleted = true WHERE id = '${SURAT.smBagian}';`);
        await suratMasukService.delete(SURAT.smTunggal, USER_ID.tu, 'sesditjen', auditTu, { alasan: ALASAN_HAPUS });
        const baris = Object.fromEntries((await daftarMasuk()).data.map((row: any) => [row.id, row]));
        expect(baris[SURAT.smTunggal]).toMatchObject({ dihapusOleh: 'Petugas TU', alasanHapus: ALASAN_HAPUS });
        expect(baris[SURAT.smBagian]).toMatchObject({ dihapusOleh: null, alasanHapus: null, deletedAt: null, unitKerjaNama: 'Bagian Umum' });
    });

    it('mengikuti plafon kelas daftar', async () => {
        await suratMasukService.delete(SURAT.smTerbatas, USER_ID.tu, 'sesditjen', auditTu, { alasan: ALASAN_HAPUS });
        expect((await daftarMasuk()).data.map((row: any) => row.id)).toEqual([SURAT.smTerbatas]);
        expect((await daftarMasuk({ securityClassifications: kelasUntukRole('staff') })).data).toEqual([]);
    });

    it('surat keluar memuat alasan hapus yang kini dicatat saat menghapus', async () => {
        await suratKeluarService.delete(SURAT.skBpptTunggal, USER_ID.bppt, 'dir_bppt', auditBppt, { alasan: 'Draf ganda, sudah dibuat ulang' });
        const hasil = await terhapus.suratTerhapusService.daftar('surat_keluar', { securityClassifications: SEMUA_KELAS });
        expect(hasil.data).toEqual([expect.objectContaining({
            id: SURAT.skBpptTunggal, nomorSurat: 'ND-3/BPPT/2026', unitKerjaNama: 'Dit. BPPT',
            dihapusOleh: 'bppt@example.test', alasanHapus: 'Draf ganda, sudah dibuat ulang',
        })]);
    });
});

describe('pulihkan surat masuk', () => {
    it('surat kembali ke daftar dengan nomor agenda dan nomor surat semula; pemulihan tercatat di audit', async () => {
        const sebelum = await one('SELECT no_urut, nomor_surat, tahun FROM surat_masuk WHERE id = $1', [SURAT.smTunggal]);
        await suratMasukService.delete(SURAT.smTunggal, USER_ID.tu, 'sesditjen', auditTu, { alasan: ALASAN_HAPUS });
        expect(await pulihkan('surat_masuk', SURAT.smTunggal)).toEqual({ id: SURAT.smTunggal, nomorSurat: 'SM-3/2026', perihal: 'Surat tunggal TU' });

        expect(await one('SELECT no_urut, nomor_surat, tahun, is_deleted, deleted_at, deleted_by FROM surat_masuk WHERE id = $1', [SURAT.smTunggal]))
            .toEqual({ ...sebelum, is_deleted: false, deleted_at: null, deleted_by: null });
        const audit = await one<{ user_id: string; changes: any }>(
            `SELECT user_id, changes FROM audit_log WHERE entity_type = 'surat_masuk' AND action = 'restore' AND entity_id = $1`, [SURAT.smTunggal]);
        expect(audit.user_id).toBe(USER_ID.superAdmin);
        expect(audit.changes).toMatchObject({
            before: { isDeleted: true, deletedBy: USER_ID.tu, nomorSurat: 'SM-3/2026' },
            after: { isDeleted: false, alasan: ALASAN_PULIH },
        });
        expect(audit.changes.before.deletedAt).toBeTruthy();
        expect((await daftarMasuk()).data).toEqual([]);
        const aktif = await suratMasukService.findAll({ unitKerjaId: 'sesditjen', securityClassifications: SEMUA_KELAS, limit: 100 });
        expect(aktif.data.map((row) => row.id)).toContain(SURAT.smTunggal);
    });

    it('anggota rangkaian: audit koreksi anggota, rangkaian selesai dibuka kembali, dan status surat masuknya dihitung ulang', async () => {
        await suratMasukService.delete(SURAT.smBiasa, USER_ID.tu, 'sesditjen', auditTu, { alasan: ALASAN_HAPUS });
        // Selama terhapus: balasan disetujui, rangkaian ditandai selesai manual, dan ada surat masuk anggota lain.
        await database.exec(`
            UPDATE surat_keluar SET approval_status = 'approved' WHERE id IN ('${SURAT.skBpptBiasa}', '${SURAT.skBpptNull}');
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat, status)
                VALUES ('${SM_LAIN}', 'sesditjen', 20, 2026, 'biasa', 'SM-20/2026', 'Surat susulan', 'Kanwil E', '2026-09-20', 'sudah_dibalas');
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
                VALUES ('${RANGKAIAN.rs1}', '${SM_LAIN}', 'sesditjen', 'anggota', 'tautan');
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, processed_at, catatan_penyelesaian, rangkaian_id)
                VALUES ('${SURAT.smBiasa}', 'sesditjen', 'dir_uji', 'processed', now(), 'Selesai ditangani unit uji', '${RANGKAIAN.rs1}');
            UPDATE rangkaian_surat SET status = 'selesai', selesai_manual = true, selesai_at = now(), selesai_by = '${USER_ID.tu}',
                catatan_selesai = 'Ditandai selesai oleh TU' WHERE id = '${RANGKAIAN.rs1}';`);
        expect((await one('SELECT status FROM surat_masuk WHERE id = $1', [SURAT.smBiasa])).status).toBe('belum_dibalas');

        await pulihkan('surat_masuk', SURAT.smBiasa);

        const koreksi = await one<{ changes: any }>(`SELECT changes FROM audit_log WHERE entity_type = 'rangkaian_surat' AND action = 'update'
            AND entity_id = $1 AND changes->'kolom' @> '["pulihkan"]'`, [RANGKAIAN.rs1]);
        expect(koreksi.changes).toMatchObject({ koreksiAnggota: true, suratMasukId: SURAT.smBiasa, alasan: ALASAN_PULIH });
        // Disposisi ke Dit. BPPT (received) milik surat yang dipulihkan kembali terbuka.
        expect(await one('SELECT status, selesai_manual FROM rangkaian_surat WHERE id = $1', [RANGKAIAN.rs1]))
            .toEqual({ status: 'aktif', selesai_manual: false });
        expect((await one('SELECT status FROM surat_masuk WHERE id = $1', [SURAT.smBiasa])).status).toBe('sudah_dibalas');
        expect((await one('SELECT status FROM surat_masuk WHERE id = $1', [SM_LAIN])).status).toBe('belum_dibalas');
    });

    it('rangkaian yang sudah diberkaskan menolak pemulihan dengan pesan yang jelas', async () => {
        await suratMasukService.delete(SURAT.smBiasa, USER_ID.tu, 'sesditjen', auditTu, { alasan: ALASAN_HAPUS });
        // Prasyarat klasifikasi berkas diuji suite Postgres; di sini cukup status 'diberkaskan'.
        await database.query('ALTER TABLE rangkaian_surat DROP CONSTRAINT IF EXISTS rangkaian_berkas_check');
        await database.query(`UPDATE rangkaian_surat SET status = 'diberkaskan', diberkaskan_at = now(), diberkaskan_by = $2 WHERE id = $1`,
            [RANGKAIAN.rs1, USER_ID.tu]);
        await expect(pulihkan('surat_masuk', SURAT.smBiasa)).rejects.toMatchObject({
            statusCode: 409, message: terhapus.PESAN_RANGKAIAN_DIBERKASKAN,
        });
        expect((await one('SELECT is_deleted FROM surat_masuk WHERE id = $1', [SURAT.smBiasa])).is_deleted).toBe(true);
        expect((await one(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'restore'`)).n).toBe(0);
    });

    it('surat yang tidak terhapus, tidak ada, atau di luar kewenangan tidak dipulihkan', async () => {
        await expect(pulihkan('surat_masuk', SURAT.smTunggal)).rejects.toMatchObject({ statusCode: 409, message: terhapus.PESAN_TIDAK_TERHAPUS });
        await expect(pulihkan('surat_masuk', '30000000-0000-4000-8000-0000000000ff')).rejects.toMatchObject({
            statusCode: 404, message: 'Surat masuk tidak ditemukan.',
        });
        await suratMasukService.delete(SURAT.smTunggal, USER_ID.tu, 'sesditjen', auditTu, { alasan: ALASAN_HAPUS });
        await expect(pulihkan('surat_masuk', SURAT.smTunggal, PENGGUNA.bppt as any)).rejects.toMatchObject({ statusCode: 404 });
        // Sifat yang tidak menyebut kelas tidak terbaca siapa pun, termasuk di daftar terhapus.
        await database.exec(`UPDATE surat_masuk SET sifat_surat = 'Konfidensial' WHERE id = '${SURAT.smTunggal}'`);
        await expect(pulihkan('surat_masuk', SURAT.smTunggal)).rejects.toMatchObject({ statusCode: 404 });
        expect((await one('SELECT is_deleted FROM surat_masuk WHERE id = $1', [SURAT.smTunggal])).is_deleted).toBe(true);
    });
});

describe('pulihkan surat keluar', () => {
    it('draf tunggal kembali ke daftar dengan nomor semula', async () => {
        await suratKeluarService.delete(SURAT.skBpptTunggal, USER_ID.bppt, 'dir_bppt', auditBppt, { alasan: 'Draf ganda, sudah dibuat ulang' });
        await pulihkan('surat_keluar', SURAT.skBpptTunggal);
        expect(await one('SELECT is_deleted, no_urut, nomor_surat, approval_status FROM surat_keluar WHERE id = $1', [SURAT.skBpptTunggal]))
            .toEqual({ is_deleted: false, no_urut: 3, nomor_surat: 'ND-3/BPPT/2026', approval_status: 'draft' });
        const audit = await one<{ changes: any }>(
            `SELECT changes FROM audit_log WHERE entity_type = 'surat_keluar' AND action = 'restore' AND entity_id = $1`, [SURAT.skBpptTunggal]);
        expect(audit.changes.after).toEqual({ isDeleted: false, alasan: ALASAN_PULIH });
    });

    it('draf anggota rangkaian kembali menahan rangkaian yang sudah selesai', async () => {
        await database.exec(`UPDATE surat_keluar SET approval_status = 'approved' WHERE id = '${SURAT.skBpptBiasa}';
            UPDATE surat_distributions SET status = 'processed', processed_at = now(), catatan_penyelesaian = 'Selesai ditangani BPPT'
             WHERE id IN (SELECT id FROM surat_distributions WHERE rangkaian_id = '${RANGKAIAN.rs1}' AND status = 'received');`);
        await suratKeluarService.delete(SURAT.skBpptNull, USER_ID.bppt, 'dir_bppt', auditBppt, { alasan: 'Draf keliru, akan dibuat ulang' });
        expect((await one('SELECT status FROM rangkaian_surat WHERE id = $1', [RANGKAIAN.rs1])).status).toBe('selesai');

        await pulihkan('surat_keluar', SURAT.skBpptNull);

        expect((await one('SELECT status FROM rangkaian_surat WHERE id = $1', [RANGKAIAN.rs1])).status).toBe('aktif');
        expect((await one('SELECT is_deleted FROM surat_keluar WHERE id = $1', [SURAT.skBpptNull])).is_deleted).toBe(false);
    });
});
