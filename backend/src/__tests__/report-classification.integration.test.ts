import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { allowedSecurityClassifications } from '../services/record-access.service';
import { bootRangkaianDatabase } from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let reportService: typeof import('../services/report.service').reportService;
let archiveLendingService: typeof import('../services/archive-lending.service').archiveLendingService;

const BORROWER = '70000000-0000-4000-8000-000000000001';
const ARSIP = {
    biasa: '71000000-0000-4000-8000-000000000001',
    terbatas: '71000000-0000-4000-8000-000000000002',
    rahasia: '71000000-0000-4000-8000-000000000003',
    sesditjen: '71000000-0000-4000-8000-000000000004',
};
const BOX = '72000000-0000-4000-8000-000000000001';

// Perihal per kelas surat keluar; NULL adalah rekaman lama = terbatas.
const KELUAR = {
    biasa: 'SK-PERIHAL-BIASA',
    terbatas: 'SK-PERIHAL-TERBATAS',
    null: 'SK-PERIHAL-NULL',
    rahasia: 'SK-PERIHAL-RAHASIA',
    sangat_rahasia: 'SK-PERIHAL-SANGAT-RAHASIA',
} as const;
const KELUAR_TERLIHAT: Record<string, string[]> = {
    super_admin: Object.values(KELUAR),
    admin_unit: [KELUAR.biasa, KELUAR.terbatas, KELUAR.null],
    admin_dirjen: [KELUAR.biasa, KELUAR.terbatas, KELUAR.null],
    admin_sesditjen: [KELUAR.biasa, KELUAR.terbatas, KELUAR.null],
    staff: [KELUAR.biasa],
    auditor: [KELUAR.biasa],
};
// Peminjam per kelas arsip unit ditjen; box tidak bergantung kelas arsip.
const PEMINJAM_TERLIHAT: Record<string, string[]> = {
    super_admin: ['Pemohon biasa', 'Pemohon terbatas', 'PRIVATE-SECRET-BORROWER', 'Pemohon box'],
    admin_unit: ['Pemohon biasa', 'Pemohon terbatas', 'Pemohon box'],
    admin_dirjen: ['Pemohon biasa', 'Pemohon terbatas', 'Pemohon box'],
    admin_sesditjen: ['Pemohon biasa', 'Pemohon terbatas', 'Pemohon box'],
    staff: ['Pemohon biasa', 'Pemohon box'],
    auditor: ['Pemohon biasa', 'Pemohon box'],
};
const ROLES = Object.keys(KELUAR_TERLIHAT);
const kelas = (role: string) => allowedSecurityClassifications({ id: 'qa-reader', role, unitKerjaId: role === 'super_admin' ? null : 'ditjen' });

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    ({ reportService } = await import('../services/report.service'));
    ({ archiveLendingService } = await import('../services/archive-lending.service'));
    await database.exec(`
        INSERT INTO unit_kerja (id, name) VALUES ('ditjen','Direktorat Jenderal'), ('sesditjen','Sekretariat Ditjen');
        INSERT INTO users (id, email, role, unit_kerja_id) VALUES ('${BORROWER}','peminjam@example.test','staff','ditjen');
        INSERT INTO surat_keluar (unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, nomor_surat, perihal, kepada, naskah_dinas, tanggal_surat) VALUES
            ('ditjen',1,2026,'biasa','ND-1/2026','${KELUAR.biasa}','Kanwil','Nota Dinas','2026-09-01'),
            ('ditjen',2,2026,'terbatas','ND-2/2026','${KELUAR.terbatas}','Kanwil','Nota Dinas','2026-09-02'),
            ('ditjen',3,2026,NULL,'ND-3/2026','${KELUAR.null}','Kanwil','Nota Dinas','2026-09-03'),
            ('ditjen',4,2026,'rahasia','ND-4/2026','${KELUAR.rahasia}','Kanwil','Nota Dinas','2026-09-04'),
            ('ditjen',5,2026,'sangat_rahasia','ND-5/2026','${KELUAR.sangat_rahasia}','Kanwil','Nota Dinas','2026-09-05');
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, keterangan) VALUES
            ('${ARSIP.biasa}','ditjen','keluar',2026,'biasa','Arsip biasa'),
            ('${ARSIP.terbatas}','ditjen','keluar',2026,'terbatas','Arsip terbatas'),
            ('${ARSIP.rahasia}','ditjen','keluar',2026,'rahasia','Arsip rahasia'),
            ('${ARSIP.sesditjen}','sesditjen','keluar',2026,'biasa','Arsip unit lain');
        INSERT INTO storage_locations (id, unit_kerja_id, code, name, level) VALUES ('${BOX}','ditjen','BOX-001','Box sintetis','box');
        INSERT INTO archive_lending (lending_type, arsip_id, storage_location_id, borrower_id, borrower_name, purpose, status, borrow_date, due_date) VALUES
            ('arsip','${ARSIP.biasa}',NULL,'${BORROWER}','Pemohon biasa','Keperluan biasa','returned','2026-09-10','2026-09-12'),
            ('arsip','${ARSIP.terbatas}',NULL,'${BORROWER}','Pemohon terbatas','Keperluan terbatas','returned','2026-09-11','2026-09-12'),
            ('arsip','${ARSIP.rahasia}',NULL,'${BORROWER}','PRIVATE-SECRET-BORROWER','PRIVATE-SECRET-PURPOSE','borrowed','2026-09-12','2026-09-15'),
            ('arsip','${ARSIP.sesditjen}',NULL,'${BORROWER}','Pemohon sesditjen','Keperluan sesditjen','returned','2026-09-13','2026-09-14'),
            -- Baris lama: pinjaman box ditjen yang juga menyimpan arsip_id milik sesditjen.
            ('box','${ARSIP.sesditjen}','${BOX}','${BORROWER}','Pemohon box','Keperluan box','borrowed','2026-09-14','2026-09-20');
    `);
}, 120_000);
afterAll(async () => { await database?.close(); });
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-16T05:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('surat keluar report follows the outgoing catalog classification policy', () => {
    it.each(ROLES)('%s', async role => {
        const securityClassifications = kelas(role);
        const expected = KELUAR_TERLIHAT[role];
        const report = await reportService.getSuratKeluarReport({ unitKerjaId: 'ditjen', year: 2026, securityClassifications });
        expect(report.data.map(row => row.perihal).sort()).toEqual([...expected].sort());
        expect(report.pagination.total).toBe(expected.length);
        expect(report.stats.summary.total).toBe(expected.length);
        expect(report.stats.monthly.find(m => m.month === 'Sep')?.count).toBe(expected.length);
        for (const hidden of Object.values(KELUAR).filter(p => !expected.includes(p))) {
            expect(JSON.stringify(report)).not.toContain(hidden);
        }

        const summary = await reportService.getSummaryReport('ditjen', 2026, securityClassifications);
        expect(summary.suratKeluar.total).toBe(expected.length);
        expect(summary.monthlyTrend.reduce((sum, m) => sum + m.keluar, 0)).toBe(expected.length);
    });
});

describe('lending report follows the lending catalog classification and unit policy', () => {
    it.each(ROLES)('%s', async role => {
        const securityClassifications = kelas(role);
        const expected = PEMINJAM_TERLIHAT[role];
        const report = await reportService.getLendingReport({ unitKerjaId: 'ditjen', securityClassifications });
        expect(report.data.map(row => row.borrowerName).sort()).toEqual([...expected].sort());
        expect(report.pagination.total).toBe(expected.length);
        if (role !== 'super_admin') expect(JSON.stringify(report)).not.toContain('PRIVATE-SECRET');

        const catalog = await archiveLendingService.getStats('ditjen', securityClassifications);
        expect(report.stats.summary.total).toBe(catalog.total);
        expect(report.stats.summary.total).toBe(expected.length);
        expect(report.stats.summary.returned).toBe(catalog.returned);
        expect(report.stats.monthly.find(m => m.month === 'Sep')?.count).toBe(expected.length);

        const summary = await reportService.getSummaryReport('ditjen', 2026, securityClassifications);
        expect(summary.peminjaman.total).toBe(catalog.total);
    });

    it('does not show a legacy ditjen box loan in the sesditjen report through its stale arsip_id', async () => {
        const securityClassifications = kelas('super_admin');
        const report = await reportService.getLendingReport({ unitKerjaId: 'sesditjen', securityClassifications });
        expect(report.data.map(row => row.borrowerName)).toEqual(['Pemohon sesditjen']);
        expect(report.stats.summary.total).toBe(1);
        expect((await reportService.getSummaryReport('sesditjen', 2026, securityClassifications)).peminjaman.total).toBe(1);
    });

    it('fails closed to box loans when a caller omits the read policy', async () => {
        const report = await reportService.getLendingReport({ unitKerjaId: 'ditjen' });
        expect(report.data.map(row => row.borrowerName)).toEqual(['Pemohon box']);
        expect((await reportService.getLendingStats('ditjen')).summary.total).toBe(1);
    });
});
