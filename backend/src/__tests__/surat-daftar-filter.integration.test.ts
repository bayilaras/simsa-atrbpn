import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { kelasUntukRole } from '../services/access/visibility-spec';
import { SURAT, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let suratMasukService: typeof import('../services/surat-masuk.service').suratMasukService;
let suratKeluarService: typeof import('../services/surat-keluar.service').suratKeluarService;

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    ({ suratMasukService } = await import('../services/surat-masuk.service'));
    ({ suratKeluarService } = await import('../services/surat-keluar.service'));
}, 120_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => { await seedRangkaianFixture(database); });

const SEMUA_KELAS = kelasUntukRole('super_admin');

async function idSuratMasuk(filters: Record<string, unknown>) {
    const hasil = await suratMasukService.findAll({
        unitKerjaId: 'sesditjen', securityClassifications: SEMUA_KELAS, limit: 100, ...filters,
    } as any);
    const ids = hasil.data.map((row) => row.id).sort();
    expect(hasil.pagination.total).toBe(ids.length);
    return ids;
}

// Fixture: smBiasa didisposisikan ke Dit. BPPT (received) dan ke Dit. PTEP (rejected);
// smTerbatas ke Dit. PTEP (sent); smTunggal tanpa disposisi. Kolom teks disposisi kosong.
describe('filter Disposisi Ke pada daftar surat masuk', () => {
    it('unit tujuan dicocokkan lewat baris disposisi; disposisi yang ditolak tidak dihitung', async () => {
        expect(await idSuratMasuk({ disposisiUnitId: 'dir_bppt' })).toEqual([SURAT.smBiasa]);
        expect(await idSuratMasuk({ disposisiUnitId: 'dir_ptep' })).toEqual([SURAT.smTerbatas]);
        expect(await idSuratMasuk({ disposisiUnitId: 'dir_uji' })).toEqual([]);
    });

    it('surat lama tanpa baris disposisi ke unit itu dicocokkan lewat label teks lama atau nama unit', async () => {
        await database.exec(`
            UPDATE surat_masuk SET disposisi = ARRAY['  Dit.  BPPT ', 'Kabag Program dan Hukum', 'DIT. UJI']
             WHERE id = '${SURAT.smTunggal}';
            UPDATE surat_masuk SET disposisi = ARRAY['Dit. PTEP'] WHERE id = '${SURAT.smBiasa}';`);
        expect(await idSuratMasuk({ disposisiUnitId: 'dir_bppt' })).toEqual([SURAT.smBiasa, SURAT.smTunggal].sort());
        // Nama unit di fixture: "Dit. Uji".
        expect(await idSuratMasuk({ disposisiUnitId: 'dir_uji' })).toEqual([SURAT.smTunggal]);
        // smBiasa punya baris disposisi (ditolak) ke Dit. PTEP; label teksnya tidak menggantikan baris itu.
        expect(await idSuratMasuk({ disposisiUnitId: 'dir_ptep' })).toEqual([SURAT.smTerbatas]);
    });

    it('label tanpa unit (Kabag) dicocokkan setelah normalisasi huruf dan spasi', async () => {
        await database.exec(`UPDATE surat_masuk SET disposisi = ARRAY['Kabag Program dan Hukum'] WHERE id = '${SURAT.smTunggal}'`);
        expect(await idSuratMasuk({ disposisi: 'Kabag Program dan Hukum' })).toEqual([SURAT.smTunggal]);
        expect(await idSuratMasuk({ disposisi: ' kabag  program dan hukum' })).toEqual([SURAT.smTunggal]);
        expect(await idSuratMasuk({ disposisi: 'Kabag Kepegawaian Keuangan dan Umum' })).toEqual([]);
    });

    it('tidak memperluas cakupan unit maupun plafon kelas daftar', async () => {
        // smTerbatas berkelas Terbatas: tidak terbaca staf walau cocok dengan filter.
        expect(await idSuratMasuk({ disposisiUnitId: 'dir_ptep', securityClassifications: kelasUntukRole('staff') })).toEqual([]);
        expect(await idSuratMasuk({ disposisiUnitId: 'dir_bppt', unitKerjaId: 'bagian_umum' })).toEqual([]);
        expect(await idSuratMasuk({ disposisiUnitId: 'dir_bppt', unitKerjaId: null })).toEqual([SURAT.smBiasa]);
    });
});

describe('urutan daftar surat', () => {
    it('hanya nilai urutan yang dikenal diterima', async () => {
        const { querySuratMasukSchema, querySuratKeluarSchema } = await import('../validators/schemas');
        const { urutanDaftarSuratDari } = await import('../services/urutan-daftar-surat');
        for (const skema of [querySuratMasukSchema, querySuratKeluarSchema]) {
            for (const urutan of ['dicatat_terbaru', 'tanggal_terbaru', 'tanggal_terlama']) {
                expect(skema.safeParse({ urutan }).success).toBe(true);
            }
            expect(skema.safeParse({ urutan: 'nomor_surat' }).success).toBe(false);
            expect(skema.safeParse({ urutan: 'created_at desc' }).success).toBe(false);
        }
        expect(urutanDaftarSuratDari('tanggal_terlama')).toBe('tanggal_terlama');
        expect(urutanDaftarSuratDari('perihal')).toBeUndefined();
        expect(urutanDaftarSuratDari(['tanggal_terlama'])).toBeUndefined();
    });

    it('surat masuk: bawaan menurut waktu dicatat, atau menurut tanggal surat dengan tanggal kosong di akhir', async () => {
        await database.exec(`
            UPDATE surat_masuk SET created_at = '2026-10-01T00:00:00Z', tanggal_surat = '2026-09-01' WHERE id = '${SURAT.smBiasa}';
            UPDATE surat_masuk SET created_at = '2026-10-03T00:00:00Z', tanggal_surat = '2026-08-01' WHERE id = '${SURAT.smTerbatas}';
            UPDATE surat_masuk SET created_at = '2026-10-02T00:00:00Z', tanggal_surat = NULL WHERE id = '${SURAT.smTunggal}';`);
        const urut = async (urutan?: string) => (await suratMasukService.findAll({
            unitKerjaId: 'sesditjen', securityClassifications: SEMUA_KELAS, limit: 100, urutan,
        } as any)).data.map((row) => row.id);
        const bawaan = [SURAT.smTerbatas, SURAT.smTunggal, SURAT.smBiasa];
        expect(await urut()).toEqual(bawaan);
        expect(await urut('dicatat_terbaru')).toEqual(bawaan);
        expect(await urut('tanggal_terbaru')).toEqual([SURAT.smBiasa, SURAT.smTerbatas, SURAT.smTunggal]);
        expect(await urut('tanggal_terlama')).toEqual([SURAT.smTerbatas, SURAT.smBiasa, SURAT.smTunggal]);
    });

    it('nilai yang sama diurutkan menurut id sehingga halaman tidak bertukar baris', async () => {
        await database.exec(`UPDATE surat_masuk SET created_at = '2026-10-01T00:00:00Z', tanggal_surat = '2026-09-01'
            WHERE unit_kerja_id = 'sesditjen'`);
        const halaman = async (urutan: string | undefined, page: number) => (await suratMasukService.findAll({
            unitKerjaId: 'sesditjen', securityClassifications: SEMUA_KELAS, limit: 1, page, urutan,
        } as any)).data.map((row) => row.id);
        const menurun = [SURAT.smTunggal, SURAT.smTerbatas, SURAT.smBiasa];
        for (const urutan of [undefined, 'tanggal_terbaru']) {
            expect([...await halaman(urutan, 1), ...await halaman(urutan, 2), ...await halaman(urutan, 3)]).toEqual(menurun);
        }
        expect([...await halaman('tanggal_terlama', 1), ...await halaman('tanggal_terlama', 2), ...await halaman('tanggal_terlama', 3)])
            .toEqual([...menurun].reverse());
    });

    it('surat keluar memakai urutan yang sama', async () => {
        await database.exec(`
            UPDATE surat_keluar SET created_at = '2026-10-01T00:00:00Z', tanggal_surat = '2026-07-01' WHERE id = '${SURAT.skBpptBiasa}';
            UPDATE surat_keluar SET created_at = '2026-10-03T00:00:00Z', tanggal_surat = '2026-09-01' WHERE id = '${SURAT.skBpptNull}';
            UPDATE surat_keluar SET created_at = '2026-10-02T00:00:00Z', tanggal_surat = '2026-08-01' WHERE id = '${SURAT.skBpptTunggal}';`);
        const urut = async (urutan?: string) => (await suratKeluarService.findAll({
            unitKerjaId: 'dir_bppt', securityClassifications: SEMUA_KELAS, limit: 100, urutan,
        } as any)).data.map((row) => row.id);
        expect(await urut()).toEqual([SURAT.skBpptNull, SURAT.skBpptTunggal, SURAT.skBpptBiasa]);
        expect(await urut('tanggal_terbaru')).toEqual([SURAT.skBpptNull, SURAT.skBpptTunggal, SURAT.skBpptBiasa]);
        expect(await urut('tanggal_terlama')).toEqual([SURAT.skBpptBiasa, SURAT.skBpptTunggal, SURAT.skBpptNull]);
    });
});

describe('nama unit kerja pada baris daftar', () => {
    it('daftar surat masuk dan keluar membawa nama unit pemilik, bukan hanya kodenya', async () => {
        const masuk = await suratMasukService.findAll({ unitKerjaId: null, securityClassifications: SEMUA_KELAS, limit: 100 });
        const namaMasuk = Object.fromEntries(masuk.data.map((row: any) => [row.id, row.unitKerjaNama]));
        expect(namaMasuk[SURAT.smBiasa]).toBe('Sekretariat Ditjen');
        expect(namaMasuk[SURAT.smBagian]).toBe('Bagian Umum');
        const keluar = await suratKeluarService.findAll({ unitKerjaId: null, securityClassifications: SEMUA_KELAS, limit: 100 });
        const namaKeluar = Object.fromEntries(keluar.data.map((row: any) => [row.id, row.unitKerjaNama]));
        expect(namaKeluar[SURAT.skBpptBiasa]).toBe('Dit. BPPT');
        expect(namaKeluar[SURAT.skPtepBiasa]).toBe('Dit. PTEP');
        // Jalur pembaca (balasanUntuk tersaring) membawa kolom yang sama.
        const pembaca = await suratKeluarService.findAll({
            unitKerjaId: 'dir_bppt', securityClassifications: SEMUA_KELAS, limit: 100,
            pembaca: { id: '10000000-0000-4000-8000-000000000001', role: 'super_admin', unitKerjaId: null },
        });
        expect(pembaca.data.every((row: any) => row.unitKerjaNama === 'Dit. BPPT')).toBe(true);
    });
});
