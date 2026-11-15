import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { bootRangkaianDatabase } from './helpers/rangkaian-pglite';

// Laporan > Peminjaman memakai predikat yang sama dengan daftar Peminjaman:
// terlambat = belum kembali dan jatuh tempo sebelum hari ini menurut WIB.
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let reportService: typeof import('../services/report.service').reportService;
let archiveLendingService: typeof import('../services/archive-lending.service').archiveLendingService;

const BORROWER = '73000000-0000-4000-8000-000000000001';
const ARSIP = [1, 2, 3, 4, 5].map(n => `74000000-0000-4000-8000-00000000000${n}`);
const KELAS = ['biasa'];

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    ({ reportService } = await import('../services/report.service'));
    ({ archiveLendingService } = await import('../services/archive-lending.service'));
    await database.exec(`
        INSERT INTO unit_kerja (id, name) VALUES ('ditjen','Direktorat Jenderal');
        INSERT INTO users (id, email, role, unit_kerja_id) VALUES ('${BORROWER}','peminjam@example.test','staff','ditjen');
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, keterangan) VALUES
            ${ARSIP.map(id => `('${id}','ditjen','keluar',2026,'biasa','Arsip uji')`).join(',\n')};
        INSERT INTO archive_lending (lending_type, arsip_id, borrower_id, borrower_name, purpose, status, borrow_date, due_date, return_date) VALUES
            ('arsip','${ARSIP[0]}','${BORROWER}','Pemohon terlambat','Uji','borrowed','2026-09-01','2026-09-15',NULL),
            -- Jatuh tempo 16 September: sudah lewat menurut WIB (17 September), belum menurut UTC.
            ('arsip','${ARSIP[1]}','${BORROWER}','Pemohon batas WIB','Uji','borrowed','2026-09-02','2026-09-16',NULL),
            ('arsip','${ARSIP[2]}','${BORROWER}','Pemohon jatuh tempo hari ini','Uji','borrowed','2026-09-03','2026-09-17',NULL),
            ('arsip','${ARSIP[3]}','${BORROWER}','Pemohon status lama','Uji','overdue','2026-08-01','2026-09-01',NULL),
            ('arsip','${ARSIP[4]}','${BORROWER}','Pemohon kembali','Uji','returned','2026-08-05','2026-09-10','2026-09-09');
    `);
}, 120_000);
afterAll(async () => { await database?.close(); });
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 17 September 2026 pukul 03.00 WIB, masih 16 September menurut UTC.
    vi.setSystemTime(new Date('2026-09-16T20:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

const nama = (rows: Array<{ borrowerName: string }>) => rows.map(row => row.borrowerName).sort();

describe('Laporan Peminjaman memakai predikat terlambat daftar Peminjaman', () => {
    it.each([
        ['overdue', ['Pemohon batas WIB', 'Pemohon status lama', 'Pemohon terlambat']],
        ['borrowed', ['Pemohon jatuh tempo hari ini']],
        ['returned', ['Pemohon kembali']],
    ] as const)('filter %s', async (status, harapan) => {
        const report = await reportService.getLendingReport({ unitKerjaId: 'ditjen', status, securityClassifications: KELAS });
        expect(nama(report.data)).toEqual(harapan);
        expect(report.pagination.total).toBe(harapan.length);
        expect(report.data.every(row => row.status === status)).toBe(true);

        const daftar = await archiveLendingService.findAll({ unitKerjaId: 'ditjen', status, securityClassifications: KELAS });
        expect(nama(daftar.data)).toEqual(harapan);
    });

    it('lencana status tiap baris sama dengan daftar Peminjaman', async () => {
        const report = await reportService.getLendingReport({ unitKerjaId: 'ditjen', securityClassifications: KELAS });
        const status = Object.fromEntries(report.data.map(row => [row.borrowerName, row.status]));
        expect(status).toEqual({
            'Pemohon terlambat': 'overdue',
            'Pemohon batas WIB': 'overdue',
            'Pemohon jatuh tempo hari ini': 'borrowed',
            'Pemohon status lama': 'overdue',
            'Pemohon kembali': 'returned',
        });
        const daftar = await archiveLendingService.findAll({ unitKerjaId: 'ditjen', securityClassifications: KELAS });
        expect(Object.fromEntries(daftar.data.map(row => [row.borrowerName, row.status]))).toEqual(status);
    });

    it('ringkasan terlambat dan dipinjam sama dengan statistik Peminjaman', async () => {
        const { summary } = await reportService.getLendingStats('ditjen', KELAS);
        expect(summary).toMatchObject({ total: 5, borrowed: 4, overdue: 3, returned: 1 });
        const katalog = await archiveLendingService.getStats('ditjen', KELAS);
        expect(summary).toMatchObject({ borrowed: katalog.borrowed, overdue: katalog.overdue, returned: katalog.returned });
    });
});
