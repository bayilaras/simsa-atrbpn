import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import { createMigratedPglite, insertRangkaian, insertUser, resetRangkaianFixture, seedUnits, uid, type PenggunaUji } from './helpers/lacak-pglite';

// Suntingan surat dari formulir yang datanya sudah diubah orang lain sejak dimuat.

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let suratMasukService: typeof import('../services/surat-masuk.service').suratMasukService;
let suratKeluarService: typeof import('../services/surat-keluar.service').suratKeluarService;
const admin = { id: uid(932), email: 'tu@example.test', name: 'Admin TU', role: 'admin_unit', unitKerjaId: 'dir_bppt' } satisfies PenggunaUji;
const audit = { userId: admin.id, userEmail: admin.email };

const catatMasuk = (extra: Record<string, unknown> = {}) => suratMasukService.create({
    unitKerjaId: 'dir_bppt', jenisSurat: 'Nota Dinas', sifatSurat: 'biasa', tanggalSurat: '2026-03-02',
    perihal: 'Permohonan data', dari: 'Kanwil A', kepada: 'Direktur', createdBy: admin.id, actor: admin, ...extra,
} as any, audit);
const catatKeluar = (extra: Record<string, unknown> = {}) => suratKeluarService.create({
    unitKerjaId: 'dir_bppt', naskahDinas: 'Nota Dinas', numberingMode: 'auto', tanggalSurat: '2026-05-04',
    perihal: 'Undangan rapat', kepada: 'Direktur', createdBy: admin.id, actor: admin, ...extra,
} as any, audit);
const nomor = async (tabel: 'surat_masuk' | 'surat_keluar', id: string) => (await database.query<{ tahun: number; no_urut: number }>(
    `SELECT tahun, no_urut FROM ${tabel} WHERE id = $1`, [id])).rows[0];
/** updatedAt seperti yang diterima formulir: Date dari layanan, lewat JSON, lalu dikirim balik. */
const versiDimuat = (rekaman: { updatedAt: Date }) => new Date(JSON.parse(JSON.stringify(rekaman.updatedAt)));
/** Waktu ubah yang pasti berbeda dari `new Date()` pada suntingan berikutnya. */
const mundurkanWaktuUbah = (tabel: 'surat_masuk' | 'surat_keluar', id: string) =>
    database.query(`UPDATE ${tabel} SET updated_at = '2026-01-01 08:00:00' WHERE id = $1`, [id]);

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    ({ suratMasukService } = await import('../services/surat-masuk.service'));
    ({ suratKeluarService } = await import('../services/surat-keluar.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });

beforeEach(async () => {
    await database.exec('TRUNCATE arsip CASCADE');
    await resetRangkaianFixture(database);
    await seedUnits(database, [{ id: 'dir_bppt', name: 'Dit. BPPT' }]);
    await insertUser(database, admin);
});

describe('suntingan dari formulir yang datanya sudah diubah orang lain', () => {
    it('surat masuk: versi yang dimuat diterima; versi lama ditolak 409 DATA_SUDAH_BERUBAH tanpa mengubah data', async () => {
        const surat = await catatMasuk({ nomorSurat: 'EXT-5/2026' });
        await mundurkanWaktuUbah('surat_masuk', surat.id);
        const dimuat = versiDimuat((await suratMasukService.findById(surat.id, 'dir_bppt'))!);
        await suratMasukService.update(surat.id, { perihal: 'Perbaikan pertama', expectedUpdatedAt: dimuat }, 'dir_bppt', undefined, audit);
        await expect(suratMasukService.update(surat.id, { perihal: 'Perbaikan yang menimpa', expectedUpdatedAt: dimuat }, 'dir_bppt', undefined, audit))
            .rejects.toMatchObject({ statusCode: 409, code: 'DATA_SUDAH_BERUBAH' });
        expect((await suratMasukService.findById(surat.id, 'dir_bppt'))!.perihal).toBe('Perbaikan pertama');
        // Klien rilis sebelumnya tidak mengirim versi: perilaku lama.
        await expect(suratMasukService.update(surat.id, { perihal: 'Tanpa versi' }, 'dir_bppt', undefined, audit))
            .resolves.toMatchObject({ perihal: 'Tanpa versi' });
    });

    it('updated_at bermikrodetik dari PostgreSQL tidak dianggap berubah', async () => {
        const surat = await catatMasuk({ nomorSurat: 'EXT-6/2026' });
        await database.query("UPDATE surat_masuk SET updated_at = '2026-03-02 10:00:00.123456' WHERE id = $1", [surat.id]);
        const dimuat = versiDimuat((await suratMasukService.findById(surat.id, 'dir_bppt'))!);
        expect(dimuat.toISOString()).toBe('2026-03-02T10:00:00.123Z');
        await expect(suratMasukService.update(surat.id, { perihal: 'Koreksi', expectedUpdatedAt: dimuat }, 'dir_bppt', undefined, audit))
            .resolves.toMatchObject({ perihal: 'Koreksi' });
    });

    it('surat keluar: versi lama ditolak sebelum tahun dipindahkan', async () => {
        const surat = await catatKeluar({ numberingMode: 'manual', nomorSurat: 'ND-8/2026' });
        await mundurkanWaktuUbah('surat_keluar', surat.id);
        const dimuat = versiDimuat((await suratKeluarService.findById(surat.id, 'dir_bppt'))!);
        await suratKeluarService.update(surat.id, { perihal: 'Perbaikan pertama' }, 'dir_bppt', undefined, audit);
        await expect(suratKeluarService.update(surat.id, { tanggalSurat: '2027-01-04', expectedUpdatedAt: dimuat }, 'dir_bppt', undefined, audit))
            .rejects.toMatchObject({ statusCode: 409, code: 'DATA_SUDAH_BERUBAH' });
        expect(await nomor('surat_keluar', surat.id)).toMatchObject({ tahun: 2026, no_urut: 1 });
    });
});

describe('perubahan status turunan tidak menolak suntingan yang terbuka', () => {
    it('status surat masuk dihitung ulang rangkaian di antara muat dan simpan: suntingan tetap tersimpan', async () => {
        const surat = await catatMasuk({ nomorSurat: 'EXT-9/2026' });
        await mundurkanWaktuUbah('surat_masuk', surat.id);
        const dimuat = versiDimuat((await suratMasukService.findById(surat.id, 'dir_bppt'))!);

        // Rangkaian ditutup manual: status surat menjadi sudah_dibalas lewat hitung ulang.
        const { id: rangkaianId } = await insertRangkaian(database, {
            n: 3, kode: 'RS-2026-000003', tahun: 2026, pencatat: 'dir_bppt', judul: 'Permohonan data',
            anggota: [{ jenis: 'surat_masuk', id: surat.id, peran: 'induk', unit: 'dir_bppt' }],
        });
        await database.query(`UPDATE rangkaian_surat SET selesai_manual = true, selesai_by = $2,
            catatan_selesai = 'Selesai tanpa surat balasan.' WHERE id = $1`, [rangkaianId, admin.id]);
        const { rangkaianService, aktor } = await import('../services/rangkaian/deps.js');
        const [perubahan] = await holder.db.transaction((tx: any) => rangkaianService.recomputeSuratMasukStatus(tx, [surat.id], aktor(admin, audit)));
        expect(perubahan).toMatchObject({ before: 'belum_dibalas', after: 'sudah_dibalas', changed: true });

        await expect(suratMasukService.update(surat.id, { dari: 'Kanwil C', expectedUpdatedAt: dimuat }, 'dir_bppt', undefined, audit))
            .resolves.toMatchObject({ dari: 'Kanwil C', status: 'sudah_dibalas' });
    });

    it('perubahan isian oleh pengguna lain tetap ditolak', async () => {
        const surat = await catatMasuk({ nomorSurat: 'EXT-10/2026' });
        await mundurkanWaktuUbah('surat_masuk', surat.id);
        const dimuat = versiDimuat((await suratMasukService.findById(surat.id, 'dir_bppt'))!);
        await suratMasukService.update(surat.id, { dari: 'Kanwil B' }, 'dir_bppt', undefined, audit);
        await expect(suratMasukService.update(surat.id, { perihal: 'Koreksi saya', expectedUpdatedAt: dimuat }, 'dir_bppt', undefined, audit))
            .rejects.toMatchObject({ statusCode: 409, code: 'DATA_SUDAH_BERUBAH' });
    });
});
