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

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    ({ suratMasukService } = await import('../services/surat-masuk.service'));
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
