import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { bootRangkaianDatabase } from './helpers/rangkaian-pglite';

// Pencarian global berhalaman: "Tampilkan lebih banyak" meminta halaman
// berikutnya dengan batas unit dan kelas yang sama, tanpa hasil berulang.
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let globalSearchService: typeof import('../services/global-search.service').globalSearchService;

const KELAS_ADMIN = ['biasa', 'terbatas'];
const WAKTU = '2026-10-01 02:00:00';

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    ({ globalSearchService } = await import('../services/global-search.service'));
    const seri = (n: number) => `generate_series(1, ${n}) n`;
    // Semua baris berwaktu input sama, jadi urutan hanya ditentukan pengikatnya.
    await database.exec(`
        INSERT INTO unit_kerja (id, name) VALUES ('unit_cari','Unit Cari'), ('unit_lain','Unit Lain'), ('unit_besar','Unit Besar')
            ON CONFLICT (id) DO NOTHING;
        INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat, created_at)
            SELECT 'unit_cari', n, 2026, 'biasa', 'SM-' || n, 'Undangan rapat ' || n, 'Pengirim', '2026-10-01', '${WAKTU}' FROM ${seri(13)};
        INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat, created_at)
            SELECT 'unit_cari', 100 + n, 2026, 'rahasia', 'SM-RAHASIA-' || n, 'Undangan rahasia ' || n, 'Pengirim', '2026-10-01', '${WAKTU}' FROM ${seri(2)};
        INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat, created_at)
            SELECT 'unit_lain', n, 2026, 'biasa', 'SM-LAIN-' || n, 'Undangan unit lain ' || n, 'Pengirim', '2026-10-01', '${WAKTU}' FROM ${seri(2)};
        INSERT INTO surat_keluar (unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, nomor_surat, perihal, kepada, naskah_dinas, tanggal_surat, created_at)
            SELECT 'unit_cari', n, 2026, 'biasa', 'SK-' || n, 'Undangan balasan ' || n, 'Tujuan', 'Nota Dinas', '2026-10-01', '${WAKTU}' FROM ${seri(12)};
        INSERT INTO arsip (unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, uraian_berkas, created_at)
            SELECT 'unit_cari', 'masuk', 2026, 'biasa', 'Berkas undangan ' || n, '${WAKTU}' FROM ${seri(5)};
        INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat, created_at)
            SELECT 'unit_besar', n, 2026, 'biasa', 'SM-BESAR-' || n, 'Undangan besar ' || n, 'Pengirim', '2026-10-01', '${WAKTU}' FROM ${seri(1001)};
    `);
}, 120_000);
afterAll(async () => { await database?.close(); });

const cari = (page: number, limit: number, unitKerjaId = 'unit_cari') => globalSearchService.search({
    query: 'undangan', unitKerjaId, page, limit, securityClassifications: KELAS_ADMIN,
});

describe('pencarian global berhalaman', () => {
    it('halaman berikutnya melanjutkan tanpa hasil berulang sampai habis', async () => {
        const kunci: string[] = [];
        const lagi: boolean[] = [];
        for (let page = 1; page <= 3; page++) {
            const hasil = await cari(page, 10);
            expect(hasil.counts).toMatchObject({ surat_masuk: 13, surat_keluar: 12, arsip: 5, dosir: 0, total: 30 });
            kunci.push(...hasil.results.map(item => `${item.type}:${item.id}`));
            lagi.push(hasil.pagination.hasMore);
        }
        expect(kunci).toHaveLength(30);
        expect(new Set(kunci).size).toBe(30);
        expect(lagi).toEqual([true, true, false]);
        // Halaman yang sama selalu berisi hasil yang sama.
        const ulang = await cari(2, 10);
        expect(ulang.results.map(item => `${item.type}:${item.id}`)).toEqual(kunci.slice(10, 20));
    });

    it('halaman berikutnya tetap dibatasi unit dan kelas keamanan', async () => {
        const semua = [await cari(1, 10), await cari(2, 10), await cari(3, 10)].flatMap(hasil => hasil.results);
        expect(semua.some(item => /RAHASIA|LAIN/.test(item.title))).toBe(false);
    });

    it('halaman di luar 1.000 hasil teratas tidak dikirim', async () => {
        const kesepuluh = await cari(10, 100, 'unit_besar');
        expect(kesepuluh.counts.total).toBe(1001);
        expect(kesepuluh.results).toHaveLength(100);
        expect(kesepuluh.pagination.hasMore).toBe(false);
        const kesebelas = await cari(11, 100, 'unit_besar');
        expect(kesebelas.results).toEqual([]);
        expect(kesebelas.pagination.hasMore).toBe(false);
    });
});
