import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { allowedSecurityClassifications } from '../services/record-access.service';
import { bootRangkaianDatabase } from './helpers/rangkaian-pglite';

// Rekap peminjaman di atas basis data: baris berkas sama dengan tabel Laporan >
// Peminjaman (kueri yang sama), pinjaman arsip di atas plafon kelas pemanggil
// tidak ikut, dan pinjaman unit lain tidak terbawa.
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let reportService: typeof import('../services/report.service').reportService;
let ekspor: typeof import('../services/export-peminjaman').eksporPeminjamanService;

const BORROWER = '75000000-0000-4000-8000-000000000001';
const ARSIP = {
    biasa: '76000000-0000-4000-8000-000000000001',
    terbatas: '76000000-0000-4000-8000-000000000002',
    rahasia: '76000000-0000-4000-8000-000000000003',
    sesditjen: '76000000-0000-4000-8000-000000000004',
};
const BOX = '77000000-0000-4000-8000-000000000001';
const kelas = (role: string) => allowedSecurityClassifications({ id: 'qa-reader', role, unitKerjaId: role === 'super_admin' ? null : 'ditjen' });

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    ({ reportService } = await import('../services/report.service'));
    ({ eksporPeminjamanService: ekspor } = await import('../services/export-peminjaman'));
    await database.exec(`
        INSERT INTO unit_kerja (id, name) VALUES ('ditjen','Direktorat Jenderal'), ('sesditjen','Sekretariat Ditjen');
        INSERT INTO users (id, email, role, unit_kerja_id) VALUES ('${BORROWER}','peminjam@example.test','staff','ditjen');
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, nomor_berkas, uraian_berkas) VALUES
            ('${ARSIP.biasa}','ditjen','keluar',2026,'biasa','NB-BIASA','Uraian biasa'),
            ('${ARSIP.terbatas}','ditjen','keluar',2026,'terbatas','NB-TERBATAS','Uraian terbatas'),
            ('${ARSIP.rahasia}','ditjen','keluar',2026,'rahasia','NB-RAHASIA','Uraian rahasia'),
            ('${ARSIP.sesditjen}','sesditjen','keluar',2026,'biasa','NB-SESDITJEN','Uraian unit lain');
        INSERT INTO storage_locations (id, unit_kerja_id, code, name, level) VALUES ('${BOX}','ditjen','BOX-001','Boks sintetis','box');
        INSERT INTO archive_lending (lending_type, arsip_id, storage_location_id, borrower_id, borrower_name, department_unit, purpose, status, borrow_date, due_date, return_date) VALUES
            ('arsip','${ARSIP.biasa}',NULL,'${BORROWER}','Pemohon biasa','Subbag TU','Uji','returned','2026-09-01','2026-09-05','2026-09-08'),
            ('arsip','${ARSIP.terbatas}',NULL,'${BORROWER}','Pemohon terbatas',NULL,'Uji','borrowed','2026-09-02','2026-09-10',NULL),
            ('arsip','${ARSIP.rahasia}',NULL,'${BORROWER}','PEMINJAM-RAHASIA','UNIT-RAHASIA','Uji','borrowed','2026-09-03','2026-09-30',NULL),
            ('arsip','${ARSIP.sesditjen}',NULL,'${BORROWER}','Pemohon sesditjen',NULL,'Uji','returned','2026-09-04','2026-09-06','2026-09-06'),
            -- Baris lama: pinjaman boks ditjen yang juga menyimpan arsip_id milik sesditjen.
            ('box','${ARSIP.sesditjen}','${BOX}','${BORROWER}','Pemohon boks',NULL,'Uji','borrowed','2026-09-05','2026-09-30',NULL);
    `);
}, 120_000);
afterAll(async () => { await database?.close(); });
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 16 September 2026 pukul 12.00 WIB.
    vi.setSystemTime(new Date('2026-09-16T05:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

const saringan = (role: string, lain: Record<string, unknown> = {}) => ({
    unitKerjaId: 'ditjen', status: 'all' as const, securityClassifications: kelas(role), ...lain,
});

describe('rekap peminjaman di atas basis data', () => {
    it('admin unit: baris berkas sama dengan tabel laporan, arsip Rahasia tidak ikut', async () => {
        const tabel = await ekspor.tabel(saringan('admin_unit'));
        const layar = await reportService.getLendingReport({ unitKerjaId: 'ditjen', status: 'all', securityClassifications: kelas('admin_unit') });

        // Kolom 5 = peminjam; urutan sama dengan layar (tanggal pinjam terbaru dulu).
        expect(tabel.baris.map((sel) => sel[4])).toEqual(layar.data.map((row) => row.borrowerName));
        expect(tabel.baris.map((sel) => sel.slice(1))).toEqual([
            ['Boks', 'BOX-001', 'Boks sintetis', 'Pemohon boks', '-', '2026-09-05', '2026-09-30', '-', 'Dipinjam', 0],
            ['Arsip', 'NB-TERBATAS', 'Uraian terbatas', 'Pemohon terbatas', '-', '2026-09-02', '2026-09-10', '-', 'Terlambat', 6],
            ['Arsip', 'NB-BIASA', 'Uraian biasa', 'Pemohon biasa', 'Subbag TU', '2026-09-01', '2026-09-05', '2026-09-08', 'Dikembalikan', 3],
        ]);
        expect(tabel.keterangan[0]).toBe('Direktorat Jenderal');
        expect(tabel.total).toBe('Total: 3 peminjaman');

        const teks = JSON.stringify(tabel);
        for (const rahasia of ['NB-RAHASIA', 'Uraian rahasia', 'PEMINJAM-RAHASIA', 'UNIT-RAHASIA', 'NB-SESDITJEN', 'Uraian unit lain', 'Pemohon sesditjen']) {
            expect(teks).not.toContain(rahasia);
        }
    });

    it('staf/auditor (plafon Biasa) tidak mendapat pinjaman arsip Terbatas; Super Admin mendapat semuanya', async () => {
        const biasa = await ekspor.tabel(saringan('auditor'));
        expect(biasa.baris.map((sel) => sel[2])).toEqual(['BOX-001', 'NB-BIASA']);
        const semua = await ekspor.tabel(saringan('super_admin'));
        expect(semua.baris.map((sel) => sel[2])).toEqual(['BOX-001', 'NB-RAHASIA', 'NB-TERBATAS', 'NB-BIASA']);
    });

    it('tanpa plafon kelas hanya pinjaman boks yang keluar', async () => {
        const tabel = await ekspor.tabel({ unitKerjaId: 'ditjen', status: 'all', securityClassifications: [] });
        expect(tabel.baris.map((sel) => sel[2])).toEqual(['BOX-001']);
    });

    it.each([
        ['overdue', ['NB-TERBATAS']],
        ['borrowed', ['BOX-001']],
        ['returned', ['NB-BIASA']],
    ] as const)('penyaring status %s sama dengan tabel', async (status, harapan) => {
        const tabel = await ekspor.tabel(saringan('admin_unit', { status }));
        const layar = await reportService.getLendingReport({ unitKerjaId: 'ditjen', status, securityClassifications: kelas('admin_unit') });
        expect(tabel.baris.map((sel) => sel[2])).toEqual(harapan);
        expect(tabel.baris).toHaveLength(layar.pagination.total);
    });

    it('rentang tanggal pinjam mempersempit berkas seperti tabel', async () => {
        const tabel = await ekspor.tabel(saringan('admin_unit', { tanggalDari: '2026-09-02', tanggalSampai: '2026-09-04' }));
        expect(tabel.baris.map((sel) => sel[2])).toEqual(['NB-TERBATAS']);
        expect(tabel.keterangan[1]).toBe('Status: Semua | Periode 02-09-2026 s.d. 04-09-2026 (tanggal pinjam)');
    });

    it('unit lain hanya memuat pinjamannya sendiri, tanpa boks ditjen yang menyimpan arsip_id lama', async () => {
        const tabel = await ekspor.tabel({ unitKerjaId: 'sesditjen', status: 'all', securityClassifications: kelas('super_admin') });
        expect(tabel.baris.map((sel) => sel[2])).toEqual(['NB-SESDITJEN']);
    });
});
