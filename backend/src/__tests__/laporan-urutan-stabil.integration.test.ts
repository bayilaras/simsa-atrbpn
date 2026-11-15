import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { bootRangkaianDatabase } from './helpers/rangkaian-pglite';

// Tabel Laporan berhalaman (limit/offset) dan ekspornya membaca daftar yang
// sama; urutan wajib punya pengikat id agar baris bernilai urut sama tidak
// muncul dua kali atau terlewat saat berpindah halaman.
const holder = vi.hoisted(() => ({ db: null as any, kueri: [] as string[] }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let reportService: typeof import('../services/report.service').reportService;

const BORROWER = '75000000-0000-4000-8000-000000000001';
const JUMLAH = 7;
const KELAS = ['biasa'];
const nomor = (n: number) => String(n).padStart(2, '0');
const arsipId = (n: number) => `76000000-0000-4000-8000-0000000000${nomor(n)}`;

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema, logger: { logQuery: (query: string) => { holder.kueri.push(query); } } });
    ({ reportService } = await import('../services/report.service'));
    const urut = Array.from({ length: JUMLAH }, (_, i) => i + 1);
    // Semua baris bertanggal dan berwaktu input sama, jadi hanya id yang membedakan urutan.
    await database.exec(`
        INSERT INTO unit_kerja (id, name) VALUES ('ditjen','Direktorat Jenderal');
        INSERT INTO users (id, email, role, unit_kerja_id) VALUES ('${BORROWER}','peminjam@example.test','staff','ditjen');
        INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat, created_at) VALUES
            ${urut.map(n => `('ditjen',${n},2026,'biasa','SM-${nomor(n)}','Perihal','Pengirim','2026-05-05','2026-05-05 01:00:00')`).join(',\n')};
        INSERT INTO surat_keluar (unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, nomor_surat, perihal, kepada, naskah_dinas, tanggal_surat, created_at) VALUES
            ${urut.map(n => `('ditjen',${n},2026,'biasa','SK-${nomor(n)}','Perihal','Tujuan','Nota Dinas','2026-05-05','2026-05-05 01:00:00')`).join(',\n')};
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, nomor_berkas, created_at) VALUES
            ${urut.map(n => `('${arsipId(n)}','ditjen','keluar',2026,'biasa','AR-${nomor(n)}','2026-05-05 01:00:00')`).join(',\n')};
        INSERT INTO archive_lending (lending_type, arsip_id, borrower_id, borrower_name, status, borrow_date, due_date) VALUES
            ${urut.map(n => `('arsip','${arsipId(n)}','${BORROWER}','PJ-${nomor(n)}','returned','2026-05-05','2026-05-20')`).join(',\n')};
    `);
}, 120_000);
afterAll(async () => { await database?.close(); });
beforeEach(() => { holder.kueri.length = 0; });

type Halaman = { data: Array<{ id: string }>; pagination: { total: number } };
async function semuaHalaman(muat: (page: number, limit: number) => Promise<Halaman>) {
    const ids: string[] = [];
    for (let page = 1; page <= Math.ceil(JUMLAH / 3); page++) {
        const halaman = await muat(page, 3);
        expect(halaman.pagination.total).toBe(JUMLAH);
        ids.push(...halaman.data.map(row => row.id));
    }
    return ids;
}

describe('urutan tabel Laporan punya pengikat id', () => {
    it.each([
        ['surat masuk', 'surat_masuk', (page: number, limit: number) => reportService.getSuratMasukReport({ unitKerjaId: 'ditjen', year: 2026, page, limit, securityClassifications: KELAS })],
        ['surat keluar', 'surat_keluar', (page: number, limit: number) => reportService.getSuratKeluarReport({ unitKerjaId: 'ditjen', year: 2026, page, limit, securityClassifications: KELAS })],
        ['arsip', 'arsip', (page: number, limit: number) => reportService.getArsipReport({ unitKerjaId: 'ditjen', type: 'all', page, limit, securityClassifications: KELAS })],
        ['peminjaman', 'archive_lending', (page: number, limit: number) => reportService.getLendingReport({ unitKerjaId: 'ditjen', page, limit, securityClassifications: KELAS })],
    ] as const)('%s: setiap baris muncul tepat sekali di seluruh halaman', async (_nama, tabel, muat) => {
        const ids = await semuaHalaman(muat as (page: number, limit: number) => Promise<Halaman>);
        expect(new Set(ids).size).toBe(JUMLAH);
        expect(ids).toEqual([...ids].sort().reverse());
        expect(holder.kueri.some(sql => new RegExp(`order by .*"${tabel}"\\."id" desc`).test(sql))).toBe(true);
    });

    it('ringkasan arsip per klasifikasi dan per media diurutkan pasti', async () => {
        await reportService.getArsipStats('ditjen', 2026, KELAS);
        expect(holder.kueri.some(sql => /order by count\(\*\) desc, "arsip"\."kode_klasifikasi"/.test(sql))).toBe(true);
        expect(holder.kueri.some(sql => /order by count\(\*\) desc, "arsip"\."media_type"/.test(sql))).toBe(true);
    });
});

describe('daftar yang dibaca ekspor Laporan punya pengikat id', () => {
    it.each([
        ['surat masuk', 'surat_masuk', async () => (await import('../services/surat-masuk.service')).suratMasukService.findAll({ unitKerjaId: 'ditjen', page: 1, limit: 3 })],
        ['surat keluar', 'surat_keluar', async () => (await import('../services/surat-keluar.service')).suratKeluarService.findAll({ unitKerjaId: 'ditjen', page: 1, limit: 3 })],
        ['arsip', 'arsip', async () => (await import('../services/arsip.service')).arsipService.findAll({ unitKerjaId: 'ditjen', page: 1, limit: 3 })],
    ] as const)('%s', async (_nama, tabel, muat) => {
        const hasil = await muat();
        expect(hasil.data).toHaveLength(3);
        expect(holder.kueri.some(sql => new RegExp(`order by "${tabel}"\\."created_at" desc, "${tabel}"\\."id" desc`).test(sql))).toBe(true);
    });
});
