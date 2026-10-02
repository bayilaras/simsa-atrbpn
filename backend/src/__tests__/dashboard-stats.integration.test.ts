import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null as any, queries: 0 }));
vi.mock('../config/database', () => ({ db: {
    select: (fields: any) => { holder.queries++; return holder.db.select(fields); },
} }));
vi.mock('../services/arsip.service', () => ({ arsipService: {
    getExpiring: vi.fn(async () => []),
} }));

let database: PGlite;
let service: typeof import('../services/dashboard.service').dashboardService;
const year = 2026;
const month = 9;
const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
const monthLastDay = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;
const previousYear = `${year - 1}-01-01`;
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
        CREATE TABLE unit_kerja (id text PRIMARY KEY, name text, parent_id text);
        CREATE TABLE surat_masuk (
            id uuid, unit_kerja_id text, tahun integer, sifat_surat text, status text,
            tanggal_surat date, is_deleted boolean, nomor_surat text, perihal text,
            created_at timestamp
        );
        CREATE TABLE surat_keluar (
            id uuid, unit_kerja_id text, tahun integer, klasifikasi_keamanan text,
            naskah_dinas text, tanggal_surat date, is_deleted boolean,
            nomor_surat text, perihal text, created_at timestamp
        );
        CREATE TABLE arsip (id uuid, unit_kerja_id text, tahun integer,
            klasifikasi_keamanan text, jenis_arsip text);
        INSERT INTO unit_kerja VALUES ('unit-a', 'Unit A', NULL), ('unit-b', 'Unit B', NULL);
    `);
    // Include mixed security, legacy NULL, another unit/year and missing dates.
    const letters = [
        ['unit-a', year, 'biasa', monthStart],
        ['unit-a', year, 'terbatas', monthStart],
        ['unit-a', year, null, monthStart],
        ['unit-a', year, 'rahasia', monthStart],
        ['unit-a', year, 'sangat_rahasia', monthStart],
        ['unit-a', year, 'unknown', monthStart],
        ['unit-a', year - 1, 'biasa', previousYear],
        ['unit-a', year, 'biasa', null],
        ['unit-b', year, 'biasa', monthStart],
        ['unit-a', year, 'BIASA', monthLastDay],
    ];
    for (const [index, row] of letters.entries()) {
        await database.query(`INSERT INTO surat_keluar VALUES
            ($1,$2,$3,$4,'Surat Dinas',$5,false,$6,$6,$7)`,
        [uuid(index + 1), ...row, `Surat ${index + 1}`, `${year}-01-01T00:00:${String(index).padStart(2, '0')}`]);
    }
    await database.query(`INSERT INTO surat_masuk VALUES
        ($1,'unit-a',$2,'biasa','belum_dibalas',$3::date,false,'Masuk 1','Masuk 1',$3::date),
        ($4,'unit-a',$2,'segera','sudah_dibalas',$5::date,false,'Masuk 2','Masuk 2',$5::date),
        ($6,'unit-b',$2,'biasa','belum_dibalas',$3::date,false,'Masuk 3','Masuk 3',$3::date)`,
    [uuid(101), year, monthStart, uuid(102), monthLastDay, uuid(103)]);
    await database.query(`INSERT INTO arsip VALUES
        ($1,'unit-a',$2,'biasa','masuk'), ($3,'unit-a',$2,'biasa','keluar'),
        ($4,'unit-a',$2,'rahasia','masuk'), ($5,'unit-b',$2,'biasa','masuk'),
        ($6,'unit-a',$2,'biasa','lainnya')`,
    [uuid(201), year, uuid(202), uuid(203), uuid(204), uuid(205)]);
    holder.db = drizzle(database);
    ({ dashboardService: service } = await import('../services/dashboard.service'));
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(() => {
    holder.queries = 0;
    vi.stubEnv('TZ', 'Asia/Jakarta');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('dashboard statistics SQL', () => {
    it('baseline contract retains all-year totals, archive subtypes and yearly breakdowns', async () => {
        const result = await service.getStats('unit-a', year);
        expect(result).toMatchObject({ totalMasuk: 2, totalKeluar: 9,
            totalArsip: 4, arsipMasuk: 2, arsipKeluar: 1, segmenKadaluarsa: 0 });
        expect(result.monthlyTrend[month - 1]).toMatchObject({ masuk: 2, keluar: 7 });
        expect(result.statusBreakdown.keluar).toEqual([{ status: 'Surat Dinas', count: 8 }]);
    });

    it.each([
        [['biasa'], 4, 2, 3],
        [['biasa', 'terbatas'], 6, 4, 5],
        [['terbatas'], 2, 2, 2],
        [['rahasia'], 1, 1, 1],
        [['sangat_rahasia'], 1, 1, 1],
        [[], 0, 0, 0],
    ] as [string[], number, number, number][])(
        'applies outgoing security %j consistently to totals, dates and type breakdowns',
        async (classes, total, monthly, yearly) => {
            const result = await service.getStats('unit-a', year, classes);
            expect(result.totalKeluar).toBe(total);
            expect(result.keluarBulanIni).toBe(monthly);
            expect(result.monthlyTrend[month - 1].keluar).toBe(monthly);
            expect(result.statusBreakdown.keluar).toEqual(yearly ? [{ status: 'Surat Dinas', count: yearly }] : []);
        },
    );

    it('uses the monthly bucket for the last calendar day without dropping it in positive UTC offsets', async () => {
        const result = await service.getStats('unit-a', year, ['biasa']);
        expect(result.masukBulanIni).toBe(2);
        expect(result.keluarBulanIni).toBe(2);
    });

    it('keeps all-unit and year filters distinct while returning empty scopes as zero', async () => {
        const allUnits = await service.getStats(null, year, ['biasa']);
        expect(allUnits).toMatchObject({ totalMasuk: 3, totalKeluar: 5, totalArsip: 4,
            arsipMasuk: 2, arsipKeluar: 1, keluarBulanIni: 3 });
        const prior = await service.getStats('unit-a', year - 1, ['biasa']);
        expect(prior.totalKeluar).toBe(4);
        expect(prior.monthlyTrend[0].keluar).toBe(1);
        const empty = await service.getStats('missing-unit', year, ['biasa']);
        expect(empty).toMatchObject({ totalMasuk: 0, totalKeluar: 0, totalArsip: 0,
            arsipMasuk: 0, arsipKeluar: 0, masukBulanIni: 0, keluarBulanIni: 0 });
    });

    it('limits ordinary statistics to seven SQL queries plus the unchanged canonical expiry evaluation', async () => {
        await service.getStats('unit-a', year, ['biasa']);
        expect(holder.queries).toBe(7);
    });
});

describe('dashboard outgoing visibility outside statistics', () => {
    it.each([
        [['biasa'], [1, 7, 8, 10]],
        [['biasa', 'terbatas'], [1, 2, 3, 7, 8, 10]],
        [['rahasia'], [4]],
        [[], []],
    ] as [string[], number[]][])(
        'only returns recent outgoing metadata visible to %j within the unit',
        async (classes, expected) => {
            const recent = await service.getRecentActivity('unit-a', 100, classes);
            expect(recent.filter(row => row.type === 'keluar').map(row => row.id).sort())
                .toEqual(expected.map(uuid).sort());
        },
    );

    it.each([[['biasa'], 3], [['biasa', 'terbatas'], 5], [['rahasia'], 1], [[], 0]] as [string[], number][])(
        'keeps unit comparison within the same outgoing classification scope %j',
        async (classes, expected) => {
            const comparison = await service.getUnitKerjaComparison('unit-a', year, classes);
            expect(comparison).toHaveLength(1);
            expect(comparison[0]).toMatchObject({ name: 'Unit A', keluar: expected });
        },
    );
});

describe('dashboard soft-deleted letters', () => {
    beforeEach(async () => {
        await database.exec(`BEGIN;
            INSERT INTO unit_kerja VALUES
                ('deletion-unit', 'Deletion Unit', NULL), ('deleted-only', 'Deleted Only', NULL);`);
        for (const [offset, table] of ['surat_masuk', 'surat_keluar'].entries()) {
            const classificationColumn = table === 'surat_masuk' ? 'sifat_surat' : 'klasifikasi_keamanan';
            const statusColumn = table === 'surat_masuk' ? 'status' : 'naskah_dinas';
            for (const [index, unit, deleted, classification] of [
                [0, 'deletion-unit', false, 'biasa'],
                [1, 'deletion-unit', null, 'biasa'],
                [2, 'deletion-unit', true, 'biasa'],
                [3, 'deleted-only', true, 'biasa'],
                [4, 'deletion-unit', null, 'rahasia'],
            ] as [number, string, boolean | null, string][]) {
                await database.query(`INSERT INTO ${table}
                    (id, unit_kerja_id, tahun, ${classificationColumn}, ${statusColumn},
                        tanggal_surat, is_deleted, nomor_surat, perihal, created_at)
                    VALUES ($1,$2,$3,$4,'same-status',$5,$6,'Deletion fixture','Deletion fixture',$7)`,
                [uuid(300 + offset * 10 + index), unit, year, classification, monthStart, deleted,
                    `${year}-09-01T00:00:${String(index).padStart(2, '0')}`]);
            }
        }
    });
    afterEach(async () => { await database.exec('ROLLBACK'); });

    it('excludes deleted rows from every statistics bucket and preserves legacy NULL flags', async () => {
        const result = await service.getStats('deletion-unit', year, ['biasa']);
        expect(result).toMatchObject({ totalMasuk: 2, totalKeluar: 2,
            masukBulanIni: 2, keluarBulanIni: 2 });
        expect(result.monthlyTrend[month - 1]).toEqual({ month: 'Sep', masuk: 2, keluar: 2 });
        expect(result.statusBreakdown).toEqual({
            masuk: [{ status: 'same-status', count: 2 }],
            keluar: [{ status: 'same-status', count: 2 }],
        });
        expect(await service.getStats('deleted-only', year, ['biasa']))
            .toMatchObject({ totalMasuk: 0, totalKeluar: 0, masukBulanIni: 0, keluarBulanIni: 0 });
    });

    it('removes deleted recent links before limiting without hiding readable legacy rows', async () => {
        const recent = await service.getRecentActivity('deletion-unit', 2, ['biasa']);
        expect(recent.map(row => row.id).sort()).toEqual([uuid(301), uuid(311)]);
        expect(await service.getRecentActivity('deleted-only', 2, ['biasa'])).toEqual([]);
    });

    it('excludes deleted counts for scoped and authorized cross-unit comparisons', async () => {
        expect(await service.getUnitKerjaComparison('deletion-unit', year, ['biasa']))
            .toEqual([{ name: 'Deletion Unit', masuk: 2, keluar: 2, arsip: 0 }]);
        const allUnits = await service.getUnitKerjaComparison(null, year, ['biasa'], true);
        expect(allUnits.find(row => row.name === 'Deletion Unit'))
            .toEqual({ name: 'Deletion Unit', masuk: 2, keluar: 2, arsip: 0 });
        expect(allUnits.find(row => row.name === 'Deleted Only'))
            .toEqual({ name: 'Deleted Only', masuk: 0, keluar: 0, arsip: 0 });
    });
});
