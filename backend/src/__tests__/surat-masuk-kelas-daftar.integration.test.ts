import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { kelasUntukRole, normalizeSecurityClassification } from '../services/access/visibility-spec';
import { bootRangkaianDatabase } from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    get db() { return holder.db; },
    pool: { query: async () => { throw new Error('pool tidak dipakai dalam uji ini'); } },
}));

// Setiap daftar, hitungan, laporan, pencarian, dan notifikasi surat masuk
// membaca sifat_surat dengan normalisasi yang sama seperti GET /:id
// (normalizeSecurityClassification). Sifat yang tidak menyebut kelas apa pun
// tetap tidak terbaca oleh siapa pun.
const UNIT = 'dir_uji';
const TAHUN = 2026;
const TOKEN = 'ZQXSIFATDAFTAR';
const SIFAT: Array<string | null> = [
    'biasa', 'Biasa', ' biasa', '', null,
    'Sangat Segera', 'SANGAT SEGERA', 'Sangat-Segera', 'Segera', 'Biasa/Terbuka',
    'Terbatas', 'Rahasia ', 'Sangat  Rahasia', 'Sangat Rahasia',
    'Konfidensial', '-', 'Kilat',
];
const ROLES = ['super_admin', 'admin_unit', 'staff'] as const;
const idOf = (index: number) => `66000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
const ID_SIFAT = new Map(SIFAT.map((sifat, index) => [idOf(index), sifat]));
const sorted = (ids: Iterable<string>) => [...ids].sort();
const terbaca = (role: string) => sorted(SIFAT.flatMap((sifat, index) =>
    kelasUntukRole(role).includes(normalizeSecurityClassification(sifat)) ? [idOf(index)] : []));

let database: PGlite;
let suratMasukService: typeof import('../services/surat-masuk.service').suratMasukService;
let dashboardService: typeof import('../services/dashboard.service').dashboardService;
let reportService: typeof import('../services/report.service').reportService;
let globalSearchService: typeof import('../services/global-search.service').globalSearchService;
let notificationService: typeof import('../services/notification.service').notificationService;

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    ({ suratMasukService } = await import('../services/surat-masuk.service'));
    ({ dashboardService } = await import('../services/dashboard.service'));
    ({ reportService } = await import('../services/report.service'));
    ({ globalSearchService } = await import('../services/global-search.service'));
    ({ notificationService } = await import('../services/notification.service'));
    await database.exec(`INSERT INTO unit_kerja (id, name) VALUES ('${UNIT}', 'Dit. Uji')`);
    for (const [index, sifat] of SIFAT.entries()) {
        await database.query(
            `INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari,
                tanggal_surat, status, is_archived, is_deleted)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Instansi Uji', '2026-09-01', 'belum_dibalas', false, false)`,
            [idOf(index), UNIT, index + 1, TAHUN, sifat, `SM-${index + 1}/${TAHUN}`, `${TOKEN} perihal ${index + 1}`],
        );
    }
}, 180_000);

afterAll(async () => { await database?.close(); });

describe('kelas sifat surat masuk sama di setiap daftar', () => {
    it('menampilkan sifat urgensi dan varian penulisan kelas, tetapi tidak sifat yang tidak menyebut kelas', async () => {
        const list = await suratMasukService.findAll({ unitKerjaId: UNIT, securityClassifications: kelasUntukRole('super_admin'), limit: 100 });
        const sifat = list.data.map(row => ID_SIFAT.get(row.id));
        expect(sifat).toEqual(expect.arrayContaining(['Sangat Segera', 'SANGAT SEGERA', '', ' biasa', 'Rahasia ', 'Sangat  Rahasia']));
        expect(sifat).not.toContain('Konfidensial');
        expect(sifat).not.toContain('-');
    });

    it.each(ROLES)('daftar, statistik, dan pilihan balasan surat masuk untuk %s', async role => {
        const classes = kelasUntukRole(role);
        const list = await suratMasukService.findAll({ unitKerjaId: UNIT, securityClassifications: classes, limit: 100 });
        expect(sorted(list.data.map(row => row.id))).toEqual(terbaca(role));
        expect(list.pagination.total).toBe(terbaca(role).length);
        expect((await suratMasukService.getStats(UNIT, TAHUN, classes)).total).toBe(terbaca(role).length);
        const pending = await suratMasukService.getPendingForReply(UNIT, classes);
        expect(sorted(pending.map(row => row.id))).toEqual(terbaca(role));
    });

    it.each(ROLES)('dasbor dan laporan surat masuk untuk %s', async role => {
        const classes = kelasUntukRole(role);
        expect((await dashboardService.getStats(UNIT, TAHUN, classes)).totalMasuk).toBe(terbaca(role).length);
        const report = await reportService.getSuratMasukReport({ unitKerjaId: UNIT, year: TAHUN, securityClassifications: classes, limit: 100 });
        expect(sorted(report.data.map(row => row.id))).toEqual(terbaca(role));
        expect(report.stats.summary.total).toBe(terbaca(role).length);
    });

    it.each(ROLES)('pencarian global dan notifikasi surat masuk untuk %s', async role => {
        const classes = kelasUntukRole(role);
        const search = await globalSearchService.search({
            query: TOKEN, unitKerjaId: UNIT, modules: ['surat_masuk'], securityClassifications: classes, limit: 100,
        });
        expect(sorted(search.results.map(result => result.id))).toEqual(terbaca(role));
        expect(search.counts.surat_masuk).toBe(terbaca(role).length);
        const notifications = await notificationService.getPendingSuratMasuk(UNIT, 'pembaca-uji', classes, new Set());
        expect(sorted(notifications.map(item => item.referenceId))).toEqual(terbaca(role));
    });

    it('filter sifat daftar mencocokkan kunci formulir dengan sifat yang tersimpan seperti di sumber', async () => {
        const filter = async (sifatSurat: string) => (await suratMasukService.findAll({
            unitKerjaId: UNIT, sifatSurat, securityClassifications: kelasUntukRole('super_admin'), limit: 100,
        })).data.map(row => ID_SIFAT.get(row.id)).sort();
        expect(await filter('biasa')).toEqual(['', ' biasa', 'Biasa', 'biasa', null].sort());
        expect(await filter('sangat_segera')).toEqual(['SANGAT SEGERA', 'Sangat Segera', 'Sangat-Segera'].sort());
        expect(await filter('rahasia')).toEqual(['Rahasia ']);
    });
});
