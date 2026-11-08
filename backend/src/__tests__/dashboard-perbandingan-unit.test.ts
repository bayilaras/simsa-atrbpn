import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ db: { select: (fields: any) => holder.db.select(fields) } }));
vi.mock('../services/arsip.service', () => ({ arsipService: { getExpiring: vi.fn(async () => []) } }));

let database: PGlite;
let service: typeof import('../services/dashboard.service').dashboardService;
const TAHUN = 2026;
const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
        CREATE TABLE unit_kerja (id text PRIMARY KEY, name text, parent_id text);
        CREATE TABLE surat_masuk (id uuid, unit_kerja_id text, tahun integer, sifat_surat text, is_deleted boolean);
        CREATE TABLE surat_keluar (id uuid, unit_kerja_id text, tahun integer, klasifikasi_keamanan text, is_deleted boolean);
        CREATE TABLE arsip (id uuid, unit_kerja_id text, tahun integer, klasifikasi_keamanan text);
        INSERT INTO unit_kerja VALUES
            ('ditjen', 'Direktorat Jenderal', NULL),
            ('sesditjen', 'Sekretariat Ditjen', 'ditjen'),
            ('dir_ptep', 'Direktorat PTEP', 'ditjen'),
            ('dir_bppt', 'Direktorat BPPT', 'ditjen'),
            ('bagian_umum', 'Bagian Umum', 'sesditjen'),
            ('unit_lain', 'Unit Lain', NULL),
            ('unit_yatim', 'Unit Yatim', 'induk_tidak_ada');
    `);
    // Jumlah sengaja berbeda dari urutan hierarki agar urutan tidak mengikuti volume.
    const masuk: Array<[string, number]> = [
        ['ditjen', TAHUN],
        ['sesditjen', TAHUN], ['sesditjen', TAHUN], ['sesditjen', TAHUN],
        ['dir_bppt', TAHUN], ['dir_bppt', TAHUN], ['dir_bppt', TAHUN], ['dir_bppt', TAHUN], ['dir_bppt', TAHUN],
        ['dir_ptep', TAHUN], ['dir_ptep', TAHUN - 1], ['dir_ptep', TAHUN - 1],
        ['bagian_umum', TAHUN], ['bagian_umum', TAHUN],
    ];
    for (const [index, [unit, tahun]] of masuk.entries()) {
        await database.query(`INSERT INTO surat_masuk VALUES ($1, $2, $3, 'biasa', false)`, [uuid(index + 1), unit, tahun]);
    }
    await database.query(`INSERT INTO surat_keluar VALUES ($1, 'sesditjen', $2, 'biasa', false)`, [uuid(101), TAHUN]);
    await database.query(`INSERT INTO arsip VALUES ($1, 'sesditjen', $2, 'biasa')`, [uuid(201), TAHUN]);
    holder.db = drizzle(database);
    ({ dashboardService: service } = await import('../services/dashboard.service'));
}, 60_000);
afterAll(async () => { await database?.close(); });

const baris = (name: string, masuk = 0, keluar = 0, arsip = 0) => ({ name, masuk, keluar, arsip });

describe('perbandingan unit kerja di Dashboard', () => {
    it('Semua Unit Kerja menampilkan induk lalu anak-anaknya dengan hitungan sendiri tanpa roll-up', async () => {
        const hasil = await service.getUnitKerjaComparison(null, TAHUN, null, true);
        expect(hasil).toEqual([
            baris('Direktorat Jenderal', 1),
            baris('Direktorat BPPT', 5),
            baris('Direktorat PTEP', 1),
            baris('Sekretariat Ditjen', 3, 1, 1),
            baris('Bagian Umum', 2),
            baris('Unit Lain'),
            baris('Unit Yatim'),
        ]);
        // Urutan sama pada pemanggilan berikutnya.
        expect(await service.getUnitKerjaComparison(null, TAHUN, null, true)).toEqual(hasil);
    });

    it('satu unit terpilih tetap membandingkan saudaranya dan diurut menurut surat masuk', async () => {
        expect(await service.getUnitKerjaComparison('dir_bppt', TAHUN, null, true)).toEqual([
            baris('Direktorat BPPT', 5),
            baris('Sekretariat Ditjen', 3, 1, 1),
            baris('Direktorat PTEP', 1),
        ]);
    });

    it('pengguna dengan cakupan unit hanya melihat unitnya sendiri', async () => {
        expect(await service.getUnitKerjaComparison('sesditjen', TAHUN, null, false)).toEqual([
            baris('Sekretariat Ditjen', 3, 1, 1),
        ]);
        expect(await service.getUnitKerjaComparison(null, TAHUN, null, false)).toEqual([]);
    });
});
