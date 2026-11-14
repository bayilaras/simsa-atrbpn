import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import { createMigratedPglite, insertUser, resetRangkaianFixture, seedUnits, uid, type PenggunaUji } from './helpers/lacak-pglite';

// No. Agenda / No. Urut yang diketik atau dibawa impor, dan pindah tahun saat
// tanggal surat dikoreksi.

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let suratMasukService: typeof import('../services/surat-masuk.service').suratMasukService;
let suratKeluarService: typeof import('../services/surat-keluar.service').suratKeluarService;
const admin = { id: uid(931), email: 'tu@example.test', name: 'Admin TU', role: 'admin_unit', unitKerjaId: 'dir_bppt' } satisfies PenggunaUji;
const audit = { userId: admin.id, userEmail: admin.email };

const catatMasuk = (extra: Record<string, unknown> = {}) => suratMasukService.create({
    unitKerjaId: 'dir_bppt', jenisSurat: 'Nota Dinas', sifatSurat: 'biasa', tanggalSurat: '2026-03-02',
    perihal: 'Permohonan data', dari: 'Kanwil A', kepada: 'Direktur', createdBy: admin.id, actor: admin, ...extra,
} as any, audit);
const catatKeluar = (extra: Record<string, unknown> = {}) => suratKeluarService.create({
    unitKerjaId: 'dir_bppt', naskahDinas: 'Nota Dinas', numberingMode: 'auto', tanggalSurat: '2026-05-04',
    perihal: 'Undangan rapat', kepada: 'Direktur', createdBy: admin.id, actor: admin, ...extra,
} as any, audit);
const nomor = async (tabel: 'surat_masuk' | 'surat_keluar', id: string) => (await database.query<{ tahun: number; no_urut: number; nomor_surat: string }>(
    `SELECT tahun, no_urut, nomor_surat FROM ${tabel} WHERE id = $1`, [id])).rows[0];
const jumlah = async (tabel: 'surat_masuk' | 'surat_keluar') =>
    (await database.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${tabel}`)).rows[0].n;
const auditUbah = async (id: string) => (await database.query<{ changes: any }>(
    "SELECT changes FROM audit_log WHERE entity_id = $1 AND action = 'update' ORDER BY created_at DESC LIMIT 1", [id])).rows[0]?.changes;

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
    await seedUnits(database, [{ id: 'dir_bppt', name: 'Dit. BPPT' }, { id: 'dir_ptep', name: 'Dit. PTEP' }]);
    await insertUser(database, admin);
});

describe('No. Agenda dan No. Urut yang diketik pada formulir', () => {
    it('menyimpan No. Agenda yang belum dipakai, lalu nomor otomatis melanjutkannya', async () => {
        await catatMasuk({ nomorSurat: 'EXT-1/2026' });
        const lanjutan = await catatMasuk({ noUrut: 345 });
        expect(await nomor('surat_masuk', lanjutan.id)).toMatchObject({ tahun: 2026, no_urut: 345, nomor_surat: '345/SM/2026' });
        const otomatis = await catatMasuk({ nomorSurat: 'EXT-2/2026' });
        expect((await nomor('surat_masuk', otomatis.id)).no_urut).toBe(346);
    });

    it('menolak No. Agenda yang sudah dipakai, juga oleh surat yang sudah dihapus, dengan 409 yang menyebut nomornya', async () => {
        const lama = await catatMasuk({ noUrut: 7, nomorSurat: 'EXT-7/2026' });
        await suratMasukService.delete(lama.id, admin.id, 'dir_bppt', audit);
        const sebelum = await jumlah('surat_masuk');
        await expect(catatMasuk({ noUrut: 7 })).rejects.toMatchObject({
            statusCode: 409,
            message: 'No. Agenda 7 tahun 2026 sudah dipakai surat lain di unit ini. Nomor surat yang sudah dihapus juga tidak dapat dipakai ulang. '
                + 'Kosongkan No. Agenda untuk nomor otomatis atau isi nomor lain.',
        });
        expect(await jumlah('surat_masuk')).toBe(sebelum);
        // Unit dan tahun lain punya urutannya sendiri.
        expect((await nomor('surat_masuk', (await catatMasuk({ noUrut: 7, tanggalSurat: '2025-12-30' })).id)).no_urut).toBe(7);
        expect((await nomor('surat_masuk', (await catatMasuk({ noUrut: 7, unitKerjaId: 'dir_ptep' })).id)).no_urut).toBe(7);
    });

    it('surat keluar: No. Urut yang diketik dipakai juga pada nomor surat otomatis', async () => {
        const surat = await catatKeluar({ noUrut: 120 });
        expect(await nomor('surat_keluar', surat.id)).toMatchObject({ tahun: 2026, no_urut: 120, nomor_surat: '120/Nota Dinas/05/2026' });
        await expect(catatKeluar({ noUrut: 120, numberingMode: 'manual', nomorSurat: 'ND-9/2026' }))
            .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/^No\. Urut 120 tahun 2026 sudah dipakai surat lain di unit ini\./) });
        expect((await nomor('surat_keluar', (await catatKeluar()).id)).no_urut).toBe(121);
    });

    it('impor menyimpan nomor sumber yang belum dipakai dan memberi nomor berikutnya bila sudah dipakai', async () => {
        await catatMasuk({ noUrut: 12, nomorSurat: 'EXT-12/2026' });
        const bebas = await suratMasukService.createImported({
            unitKerjaId: 'dir_bppt', noUrut: 30, tahun: 2026, nomorSurat: 'IMP-30/2026', tanggalSurat: '2026-04-01',
            perihal: 'Register lama', dari: 'Kanwil B', createdBy: admin.id,
        }, audit);
        const terpakai = await suratMasukService.createImported({
            unitKerjaId: 'dir_bppt', noUrut: 12, tahun: 2026, nomorSurat: 'IMP-12/2026', tanggalSurat: '2026-04-02',
            perihal: 'Register lama', dari: 'Kanwil B', createdBy: admin.id,
        }, audit);
        expect([bebas.noUrut, terpakai.noUrut]).toEqual([30, 31]);
        const keluar = await suratKeluarService.createImported({
            unitKerjaId: 'dir_bppt', noUrut: 5, tahun: 2026, naskahDinas: 'Nota Dinas', numberingMode: 'manual',
            nomorSurat: 'ND-5/2026', tanggalSurat: '2026-04-02', perihal: 'Register keluar', kepada: 'Direktur', createdBy: admin.id,
        }, audit);
        expect(keluar.noUrut).toBe(5);
    });
});

describe('tanggal surat dikoreksi ke tahun lain', () => {
    it('surat masuk pindah ke urutan tahun baru; nomor surat tetap dan audit mencatat nomor serta tahun lama dan baru', async () => {
        await catatMasuk({ tanggalSurat: '2025-11-20', noUrut: 40, nomorSurat: 'EXT-40/2025' });
        const surat = await catatMasuk({ nomorSurat: 'EXT-1/2026', tanggalSurat: '2026-01-05' });
        expect(await nomor('surat_masuk', surat.id)).toMatchObject({ tahun: 2026, no_urut: 1 });

        const hasil = await suratMasukService.update(surat.id, { tanggalSurat: '2025-12-30' }, 'dir_bppt', undefined, audit);
        expect(hasil).toMatchObject({ tahun: 2025, noUrut: 41, nomorSurat: 'EXT-1/2026', tanggalSurat: '2025-12-30' });
        expect(await auditUbah(surat.id)).toMatchObject({
            before: { tahun: 2026, noUrut: 1 },
            after: { tahun: 2025, noUrut: 41, tanggalSurat: '2025-12-30', nomorSurat: 'EXT-1/2026' },
            fields: ['tanggalSurat', 'tahun', 'noUrut'],
        });
        // Nomor 1 di 2026 kembali dapat dipakai; urutan 2026 tidak terganggu.
        expect((await nomor('surat_masuk', (await catatMasuk({ nomorSurat: 'EXT-2/2026' })).id)).no_urut).toBe(1);
    });

    it('perubahan tanggal di tahun yang sama tidak mengubah No. Agenda', async () => {
        const surat = await catatMasuk({ nomorSurat: 'EXT-3/2026', noUrut: 9 });
        const hasil = await suratMasukService.update(surat.id, { tanggalSurat: '2026-08-17', perihal: 'Perihal koreksi' }, 'dir_bppt', undefined, audit);
        expect(hasil).toMatchObject({ tahun: 2026, noUrut: 9, tanggalSurat: '2026-08-17' });
        const changes = await auditUbah(surat.id);
        expect(changes.fields).toEqual(['tanggalSurat', 'perihal']);
        expect(changes).not.toHaveProperty('before');
    });

    it('surat keluar draf pindah ke urutan tahun baru dengan nomor surat tetap', async () => {
        const surat = await catatKeluar({ numberingMode: 'manual', nomorSurat: 'ND-4/2026', tanggalSurat: '2026-01-03' });
        await catatKeluar({ numberingMode: 'manual', nomorSurat: 'ND-77/2027', tanggalSurat: '2027-01-02', noUrut: 77 });
        const hasil = await suratKeluarService.update(surat.id, { tanggalSurat: '2027-01-04' }, 'dir_bppt', undefined, audit);
        expect(hasil).toMatchObject({ tahun: 2027, noUrut: 78, nomorSurat: 'ND-4/2026' });
        expect(await auditUbah(surat.id)).toMatchObject({ before: { tahun: 2026, noUrut: 1 }, after: { tahun: 2027, noUrut: 78 } });
    });
});
