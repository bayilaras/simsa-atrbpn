import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    PREFLIGHT_CHECKS,
    PREFLIGHT_TRANSACTION,
    assertReadOnlySql,
    formatReport,
    formatSifatFixture,
    runPreflight,
} from '../../scripts/preflight-integrasi-surat.mjs';
import { normalizeSecurityClassification } from '../services/record-access.service';
import { BIASA_SIFAT_ALIASES, SECURITY_CLASSES } from '../services/access/visibility-spec';

const uuid = (prefix: number, n: number) =>
    `${String(prefix).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Himpunan \s ECMAScript dihitung langsung dari mesin JS, bukan disalin.
const JS_WHITESPACE = Array.from({ length: 0x10000 }, (_, cp) => cp)
    .filter(cp => (cp < 0xd800 || cp > 0xdfff) && /\s/.test(String.fromCharCode(cp)));

// L1..L4 di bawah berasumsi indeks 0-3 tetap 4 nilai ini pada urutan ini; nilai
// tambahan untuk cakupan drift alias masuk SETELAH blok ini, bukan disisipkan.
const BASE_SIFAT_VALUES: Array<string | null> = [
    'Sangat Segera', 'biasa', 'Rahasia', 'Terbatas', '', null, ' Biasa ', 'sangat-segera', 'Biasa/Terbuka',
];

// F2: nilai spasi-saja (tanpa karakter lain sama sekali) tidak diuji langsung
// di manapun sebelum ini -- ' Biasa ' di atas menguji trim di SEKITAR isi,
// bukan trim yang menghabiskan seluruh nilai. kelasBaruSql men-trim DULU,
// baru menganggap hasil kosong sebagai 'biasa' (idempoten dengan
// normalizeSecurityClassification('')==='biasa'); bila urutan itu dibalik
// (coalesce/replace dulu, trim belakangan), nilai spasi-saja lolos sebagai
// literal '_' bukan 'biasa'. Ditaruh SETELAH BASE_SIFAT_VALUES sebagai
// daftarnya sendiri (bukan disisipkan ke BASE_SIFAT_VALUES) supaya indeks
// 0-3 (L1..L4) di atas tidak tergeser.
const WHITESPACE_ONLY_VALUES: Array<string> = [' ', '\t'];

const PRODUCTION_SIFAT_VALUES = JSON.parse(
    readFileSync(new URL('./fixtures/sifat-surat-produksi.json', import.meta.url), 'utf8'),
) as Array<string | null>;

// Cakupan drift alias: setiap nilai BIASA_SIFAT_ALIASES/SECURITY_CLASSES dan
// setiap nilai fixture produksi harus diuji langsung terhadap BIASA_LIST di
// preflight-integrasi-surat.mjs, bukan hanya tiga contoh acak — bila salah
// satu daftar itu berubah tanpa BIASA_LIST diperbarui, test ini harus gagal.
const ALIAS_DRIFT_VALUES: Array<string | null> = [
    ...new Set<string | null>([
        ...BIASA_SIFAT_ALIASES,
        ...SECURITY_CLASSES,
        ...PRODUCTION_SIFAT_VALUES,
    ]),
].filter(value => !BASE_SIFAT_VALUES.includes(value));

const SIFAT_VALUES: Array<string | null> = [
    ...BASE_SIFAT_VALUES,
    ...WHITESPACE_ONLY_VALUES,
    ...ALIAS_DRIFT_VALUES,
    ...JS_WHITESPACE.map(cp => {
        const ch = String.fromCharCode(cp);
        // PGlite (diverifikasi pada 0.5.7 dan 0.5.8) memotong satu karakter U+FEFF (BOM)
        // bila karakter itu menjadi karakter PERTAMA nilai text yang dikembalikan SELECT
        // (kuirk decoding pada sisi PGlite, bukan pada Postgres/pg.Client produksi).
        // Untuk 0xfeff, jangan taruh ch di posisi pertama; kode titik itu tetap tercakup
        // lewat kemunculan di tengah dan di akhir string.
        if (cp === 0xfeff) return `Sangat${ch}Segera${ch}`;
        return `${ch}Sangat${ch}Segera${ch}`;
    }),
];

const L1 = uuid(1, 1); // 'Sangat Segera'
const L2 = uuid(1, 2); // 'biasa', perihal NULL
const L3 = uuid(1, 3); // 'Rahasia'
const L4 = uuid(1, 4); // 'Terbatas'

const SCHEMA = `
CREATE SCHEMA drizzle;
CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
CREATE TABLE unit_kerja (id varchar(50) PRIMARY KEY, name varchar(255) NOT NULL, parent_id varchar(50),
    unit_type varchar(30), can_receive_distribution boolean DEFAULT true);
CREATE TABLE users (id uuid PRIMARY KEY, role varchar(50) NOT NULL, unit_kerja_id varchar(50));
CREATE TABLE surat_masuk (id uuid PRIMARY KEY, unit_kerja_id varchar(50) NOT NULL, tahun integer NOT NULL,
    sifat_surat varchar(50), perihal text, disposisi text[], tanggal_surat date, is_deleted boolean DEFAULT false,
    created_by uuid, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE surat_keluar (id uuid PRIMARY KEY, unit_kerja_id varchar(50) NOT NULL, balasan_untuk uuid,
    klasifikasi_keamanan varchar(30));
CREATE INDEX idx_surat_keluar_balasan ON surat_keluar (balasan_untuk) WHERE balasan_untuk IS NOT NULL;
CREATE TABLE surat_distributions (id uuid PRIMARY KEY, surat_masuk_id uuid NOT NULL, source_unit_id varchar(50) NOT NULL,
    target_unit_id varchar(50) NOT NULL, status varchar(20) NOT NULL DEFAULT 'sent', sent_at timestamp NOT NULL DEFAULT now());
-- Trigger yang sudah ada SEBELUM 0046 dijalankan (mis. dari deployment lama atau
-- migrasi manual), simulasi bentrok nama trigger yang akan dibuat 0046.
CREATE FUNCTION preflight_test_noop_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RETURN NEW; END $$;
CREATE TRIGGER unit_kerja_default_pengawas
BEFORE INSERT ON unit_kerja
FOR EACH ROW EXECUTE FUNCTION preflight_test_noop_trigger();
`;

let database: PGlite;
let results: Awaited<ReturnType<typeof runPreflight>>;
const byId = (id: string) => {
    const result = results.find(item => item.id === id);
    if (!result) throw new Error(`pemeriksaan ${id} tidak ada`);
    return result;
};

beforeAll(async () => {
    database = new PGlite();
    await database.exec(SCHEMA);
    await database.exec(`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
            SELECT 'h' || g, CASE WHEN g = 45 THEN 1789397416667 ELSE g END FROM generate_series(0, 45) AS g;
        INSERT INTO unit_kerja (id, name) VALUES ('ditjen', 'Ditjen'), ('sesditjen', 'Sesditjen'),
            ('dir_bppt', 'Dit. BPPT'), ('direktorat-ptep', 'Direktorat PTEP');
        INSERT INTO users (id, role, unit_kerja_id) VALUES
            ('${uuid(9, 1)}', 'admin_unit', 'sesditjen'), ('${uuid(9, 2)}', 'admin_sesditjen', NULL);
    `);
    for (const [index, sifat] of SIFAT_VALUES.entries()) {
        await database.query(
            `INSERT INTO surat_masuk (id, unit_kerja_id, tahun, sifat_surat, perihal, tanggal_surat)
             VALUES ($1, 'ditjen', 2026, $2, $3, '2026-09-01')`,
            [uuid(1, index + 1), sifat, index === 1 ? null : `Perihal ${index + 1}`],
        );
    }
    await database.exec(`
        UPDATE surat_masuk SET disposisi = ARRAY['BPPT', ' Dit.  BPPT ', ''] WHERE id = '${L1}';
        INSERT INTO surat_distributions (id, surat_masuk_id, source_unit_id, target_unit_id, status) VALUES
            ('${uuid(2, 1)}', '${L1}', 'ditjen', 'dir_bppt', 'sent'),
            ('${uuid(2, 2)}', '${L1}', 'ditjen', 'dir_bppt', 'received'),
            ('${uuid(2, 3)}', '${L2}', 'ditjen', 'dir_bppt', 'rejected'),
            ('${uuid(2, 4)}', '${L2}', 'ditjen', 'dir_bppt', 'sent'),
            ('${uuid(2, 5)}', '${L3}', 'ditjen', 'dir_bppt', 'terkirim'),
            ('${uuid(2, 6)}', '${L4}', 'ditjen', 'ditjen', 'processed');
        INSERT INTO surat_keluar (id, unit_kerja_id, balasan_untuk, klasifikasi_keamanan) VALUES
            ('${uuid(3, 1)}', 'ditjen', '${L1}', 'biasa'),
            ('${uuid(3, 2)}', 'dir_bppt', '${L2}', NULL);
    `);
    results = await runPreflight(database);
}, 60_000);

afterAll(async () => { await database?.close(); });

describe('pre-flight P0 integrasi surat di PGlite', () => {
    it('menjalankan setiap pemeriksaan tanpa galat', () => {
        expect(results.filter(result => result.error).map(result => [result.id, result.error])).toEqual([]);
        expect(results.map(result => result.id)).toEqual(PREFLIGHT_CHECKS.map(check => check.id));
    });

    it('melaporkan status migrasi, unit kerja, dan pengguna', () => {
        expect(byId('status_migrasi').rows).toEqual([{ jumlah_migrasi: 46, migrasi_terakhir_when: '1789397416667' }]);
        const direktorat = Object.fromEntries(byId('unit_kerja_direktorat').rows.map((row: any) => [row.unit_id, row.ada]));
        expect(direktorat).toMatchObject({ ditjen: true, sesditjen: true, dir_bppt: true, dir_ptep: false, dir_ktpp: false });
        expect(direktorat).not.toHaveProperty('dir_plp');
        expect(byId('unit_kerja_id_direktorat_dash').rows).toEqual([{ id: 'direktorat-ptep', name: 'Direktorat PTEP' }]);
        expect(byId('pengguna_per_role_unit').rows).toEqual([
            { role: 'admin_sesditjen', unit_kerja_id: '(NULL)', jumlah: 1 },
            { role: 'admin_unit', unit_kerja_id: 'sesditjen', jumlah: 1 },
        ]);
    });

    it('mendeteksi distribusi aktif ganda, status tak dikenal, dan target = sumber', () => {
        expect(byId('distribusi_aktif_ganda').rows).toEqual([expect.objectContaining({
            surat_masuk_id: L1, target_unit_id: 'dir_bppt', jumlah: 2, statuses: ['sent', 'received'],
        })]);
        expect(byId('distribusi_status_tak_dikenal').rows).toEqual([
            { id: uuid(2, 5), surat_masuk_id: L3, target_unit_id: 'dir_bppt', status: 'terkirim' },
        ]);
        expect(byId('distribusi_target_sama_dengan_sumber').rows).toEqual([{ jumlah: 1 }]);
        expect(byId('distribusi_per_status').rows).toEqual([
            { status: 'processed', jumlah: 1 }, { status: 'received', jumlah: 1 }, { status: 'rejected', jumlah: 1 },
            { status: 'sent', jumlah: 2 }, { status: 'terkirim', jumlah: 1 },
        ]);
    });

    it('menandai index manual dan trigger yang sudah ada, dan tidak menemukan bentrok objek 0046 lainnya', () => {
        const objects = Object.fromEntries(byId('index_dan_objek_bentrok').rows.map((row: any) => [row.nama, row.sudah_ada]));
        expect(objects.idx_surat_keluar_balasan).toBe(true);
        // Trigger 0046 `unit_kerja_default_pengawas` (pada unit_kerja) sudah ada di fixture
        // di atas untuk mensimulasikan bentrok nama trigger sebelum 0046 dijalankan;
        // `surat_distributions_closed_guard` belum ada dan harus tetap false.
        expect(objects.unit_kerja_default_pengawas).toBe(true);
        expect(objects.surat_distributions_closed_guard).toBe(false);
        const bolehTrue = new Set(['idx_surat_keluar_balasan', 'unit_kerja_default_pengawas']);
        expect(Object.entries(objects).filter(([nama, ada]) => !bolehTrue.has(nama) && ada)).toEqual([]);
        expect(byId('kolom_bentrok').rows).toEqual([]);
        expect(byId('index_manual_surat').rows).toContainEqual(expect.objectContaining({
            tablename: 'surat_keluar', indexname: 'idx_surat_keluar_balasan',
        }));
    });

    it('meringkas data lama, label disposisi, dan balasan lintas unit', () => {
        expect(byId('data_lama_ringkasan').rows[0]).toMatchObject({
            total: SIFAT_VALUES.length, hidup: SIFAT_VALUES.length, tanpa_pembuat: SIFAT_VALUES.length,
            berlabel_disposisi: 1, perihal_kosong: 1,
        });
        expect(byId('label_disposisi').rows).toEqual(expect.arrayContaining([
            { label_norm: 'bppt', jumlah: 1 }, { label_norm: 'dit. bppt', jumlah: 1 }, { label_norm: '', jumlah: 1 },
        ]));
        expect(byId('balasan_lintas_unit').rows).toEqual([{ balasan_same_unit: 1, balasan_lintas_unit: 1 }]);
    });

    it('menghitung kelas baru yang identik dengan normalizeSecurityClassification untuk setiap nilai', () => {
        const rows = byId('sifat_surat_kelas').rows as Array<{ nilai: string | null; kelas_lama: string; kelas_baru: string }>;
        expect(rows).toHaveLength(SIFAT_VALUES.length);
        const mismatches = rows
            .filter(row => row.kelas_baru !== normalizeSecurityClassification(row.nilai))
            .map(row => ({ nilai: row.nilai, sql: row.kelas_baru, ts: normalizeSecurityClassification(row.nilai) }));
        expect(mismatches).toEqual([]);
        expect(rows.find(row => row.nilai === 'Sangat Segera')).toMatchObject({ kelas_lama: 'sangat_segera', kelas_baru: 'biasa' });
    });

    // F2: nilai spasi-saja (' ' dan '\t') harus dinormalisasi ke 'biasa' lewat
    // urutan trim-DULU-baru-anggap-kosong milik kelasBaruSql. Test generik di
    // atas sudah mencakup nilai ini lewat SIFAT_VALUES/mismatches, tapi test
    // ini menegaskannya secara langsung dan sengaja tidak bisa lolos vakum:
    // membalik urutan trim di kelasBaruSql (coalesce/replace dulu, trim
    // belakangan) membuat nilai ini menjadi literal '_', bukan 'biasa'.
    it.each(WHITESPACE_ONLY_VALUES)('nilai spasi-saja %j dinormalisasi idempoten menjadi biasa (trim dulu, baru anggap kosong)', (nilai) => {
        const rows = byId('sifat_surat_kelas').rows as Array<{ nilai: string | null; kelas_baru: string }>;
        const row = rows.find(item => item.nilai === nilai);
        expect(row).toBeDefined();
        expect(row?.kelas_baru).toBe('biasa');
        expect(normalizeSecurityClassification(nilai)).toBe('biasa');
    });

    it('menghitung disposisi terbuka per kelas lama dan baru', () => {
        expect(byId('distribusi_terbuka_per_kelas').rows).toEqual([
            { kelas_baru: 'biasa', kelas_lama: 'biasa', status: 'sent', jumlah: 1 },
            { kelas_baru: 'biasa', kelas_lama: 'sangat_segera', status: 'received', jumlah: 1 },
            { kelas_baru: 'biasa', kelas_lama: 'sangat_segera', status: 'sent', jumlah: 1 },
        ]);
    });

    it('menghasilkan fixture JSON berisi semua nilai distinct sifat_surat', () => {
        expect(new Set(JSON.parse(formatSifatFixture(results)))).toEqual(new Set(SIFAT_VALUES));
    });
});

describe('disiplin transaksi dan penjaga baca-saja', () => {
    it('membuka satu transaksi READ ONLY, mengisolasi kegagalan per pemeriksaan, dan selalu ROLLBACK', async () => {
        const statements: string[] = [];
        const client = {
            async query(text: string) {
                statements.push(text);
                if (text === 'SELECT 1 AS gagal') throw Object.assign(new Error('boom'), { code: '42P01' });
                return { rows: text === 'SELECT 2 AS ok' ? [{ ok: 2 }] : [] };
            },
        };
        const out = await runPreflight(client, [
            { id: 'a', judul: 'A', keputusan: 'x', sql: 'SELECT 1 AS gagal' },
            { id: 'b', judul: 'B', keputusan: 'y', sql: 'SELECT 2 AS ok' },
        ]);
        expect(statements.slice(0, 3)).toEqual([
            PREFLIGHT_TRANSACTION,
            "SET LOCAL statement_timeout = '15s'",
            'SET LOCAL standard_conforming_strings = on',
        ]);
        expect(statements).toContain('ROLLBACK TO SAVEPOINT preflight_check');
        expect(statements.at(-1)).toBe('ROLLBACK');
        expect(out.map(result => [result.id, result.error])).toEqual([['a', '42P01: boom'], ['b', null]]);
        expect(out[1].rows).toEqual([{ ok: 2 }]);
    });

    it.each([
        'DELETE FROM surat_distributions',
        'SELECT 1; DROP TABLE unit_kerja',
        'WITH x AS (UPDATE unit_kerja SET name = name RETURNING id) SELECT * FROM x',
        'SELECT * INTO salinan FROM unit_kerja',
        'CREATE TABLE t (id int)',
        'VALUES (1)',
    ])('menolak SQL non-baca sebelum membuka transaksi: %s', async (sqlText) => {
        const statements: string[] = [];
        const client = { async query(text: string) { statements.push(text); return { rows: [] }; } };
        await expect(runPreflight(client, [{ id: 'jahat', judul: 'J', keputusan: '-', sql: sqlText }]))
            .rejects.toThrow(/jahat/);
        expect(statements).toEqual([]);
    });

    it('semua pemeriksaan bawaan lolos penjaga baca-saja dan ber-id unik', () => {
        for (const check of PREFLIGHT_CHECKS) expect(() => assertReadOnlySql(check.id, check.sql)).not.toThrow();
        expect(new Set(PREFLIGHT_CHECKS.map(check => check.id)).size).toBe(PREFLIGHT_CHECKS.length);
    });

    it('menulis laporan markdown dengan sel yang di-escape dan blok pengesahan', () => {
        const text = formatReport([
            { id: 'contoh', judul: 'Contoh', keputusan: 'Harus 0 baris', sql: 'SELECT 1', rows: [{ nilai: 'a|b', daftar: ['x', null], kosong: null }], error: null },
            { id: 'rusak', judul: 'Rusak', keputusan: '-', sql: 'SELECT 1', rows: [], error: '42P01: relation missing' },
        ], '2026-09-26T00:00:00.000Z');
        expect(text).toContain('# Laporan Pre-flight P0 Integrasi Surat');
        expect(text).toContain('Ringkasan: 2 pemeriksaan, 1 gagal.');
        expect(text).toContain('| nilai | daftar | kosong |');
        expect(text).toContain('| a\\|b | {x, NULL} | NULL |');
        expect(text).toContain('**GAGAL:** 42P01: relation missing');
        expect(text).toContain('## Pengesahan');
    });
});
