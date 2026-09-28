// backend/src/__tests__/backfill-rangkaian-lama.test.ts
import type { PGlite } from '@electric-sql/pglite';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    applyPlan,
    assertPemetaanSah,
    BASE_CTE,
    buildPlan,
    LABEL_NORM_TRIM_PATTERN,
    LABEL_NORM_SPASI_PATTERN,
    LABEL_SEED,
    labelNormSql,
    isiPengolahPlan,
    KELAS_SIFAT_DIKENAL,
    normalizeLabel,
    parseArgs,
    pastikanRoleRuntime,
    resolveBatasDataLama,
    resolveLabel,
    seedParams,
    siapkanSesi,
    SIFAT_NORM_SEPARATOR_PATTERN,
    tentukanBatasDataLama,
    writePlanFiles,
} from '../../scripts/backfill-rangkaian-lama.mjs';
import { BIASA_SIFAT_ALIASES, PG_TRIM_PATTERN, PG_SEPARATOR_PATTERN, SECURITY_CLASSES } from '../services/access/visibility-spec.js';
import { createRangkaianP5Database, P5_IDS, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

// Hanya test gabung (Task 5 amandemen butir 7) yang memakai layanan P1 lewat Drizzle di atas PGlite.
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database.js', () => ({
    get db() { return holder.db; },
    pool: { end: async () => {} },
}));

// Batas data lama tetap dipakai semua test dry-run agar SHA deterministik (P5-T4-1).
const BATAS_UJI = '2100-01-01T00:00:00.000Z';

// Frekuensi label pada snapshot DB lama (spec §3, instruksi P5).
const LEGACY_LABELS: Array<[string, string | null, string]> = [
    ['BPPT', 'dir_bppt', 'terpetakan'],
    ['Sesditjen', 'sesditjen', 'terpetakan'],
    ['Dit. BPPT', 'dir_bppt', 'terpetakan'],
    ['Kabag Program dan Hukum', null, 'label_saja'],
    ['KTPP', 'dir_ktpp', 'terpetakan'],
    ['Kabag Kepegawaian Keuangan dan Umum', null, 'label_saja'],
    ['SekDitjen', 'sesditjen', 'terpetakan'],
    ['DIRJEN', 'ditjen', 'terpetakan'],
    ['PTEP', 'dir_ptep', 'terpetakan'],
    ['Dit. PTEP', 'dir_ptep', 'terpetakan'],
    ['Ditjen', 'ditjen', 'terpetakan'],
    ['Dit. KTPP', 'dir_ktpp', 'terpetakan'],
    ['', null, 'kosong'],
];

// Whitespace non-ASCII yang dibuang JS `trim()`/`\s` tetapi tidak oleh SQL `trim()` [P5-T3-3].
const LABEL_WHITESPACE_UNICODE = [
    ' BPPT ',
    '\tDit.　BPPT ',
    '﻿Kabag  Program dan Hukum ',
    '  ',
];

const S = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const K = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
const R8 = '00000000-0000-4000-8000-000000000308';

async function seedLegacy(db: PGlite) {
    await db.exec(`
        INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, sifat_surat, disposisi, status, is_deleted) VALUES
          ('${S(1)}', 'ditjen', 101, 2023, 'B-1/2023', 'Pengadaan tanah jalan tol', 'Biasa', ARRAY['BPPT','Dit. BPPT','Kabag Program dan Hukum'], 'sudah_dibalas', false),
          ('${S(2)}', 'ditjen', 102, 2023, 'ND-2/2023', NULL, 'Biasa', ARRAY['PTEP','KTPP'], 'belum_dibalas', false),
          ('${S(3)}', 'ditjen', 103, 2023, NULL, '   ', 'Biasa', ARRAY['  DIRJEN ','SekDitjen'], 'belum_dibalas', false),
          ('${S(4)}', 'ditjen', 104, 2023, 'B-4/2023', 'Label kosong', 'Biasa', ARRAY[''], 'belum_dibalas', false),
          ('${S(5)}', 'ditjen', 105, 2023, 'B-5/2023', 'Hanya Kabag', 'Biasa', ARRAY['Kabag Kepegawaian Keuangan dan Umum'], 'belum_dibalas', false),
          ('${S(6)}', 'ditjen', 106, 2023, 'B-6/2023', 'Label asing', 'Biasa', ARRAY['Bagian Entah'], 'belum_dibalas', false),
          ('${S(7)}', 'sesditjen', 107, 2023, 'B-7/2023', 'Milik sendiri', 'Biasa', ARRAY['Sesditjen'], 'belum_dibalas', false),
          ('${S(8)}', 'ditjen', 108, 2023, 'B-8/2023', 'Sudah dirangkai langkah 1', 'Biasa', ARRAY['BPPT'], 'belum_dibalas', false),
          ('${S(9)}', 'ditjen', 109, 2023, 'B-9/2023', 'Terhapus', 'Biasa', ARRAY['BPPT'], 'belum_dibalas', true),
          ('${S(10)}', 'ditjen', 110, 2023, 'B-10/2023', 'Label formula', 'Biasa', ARRAY['=HYPERLINK("x")'], 'belum_dibalas', false);
        INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun)
        VALUES ('${R8}', 'RS-2023-800008', 'surat_masuk', 'aktif', 'ditjen', 'Sudah dirangkai langkah 1', 2023);
        INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran)
        VALUES ('${R8}', '${S(8)}', 'ditjen', 'induk');
        INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id)
        VALUES ('${S(8)}', 'ditjen', 'dir_bppt', 'sent', '${R8}');
        INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, nomor_surat, balasan_untuk, approval_status) VALUES
          ('${K(1)}', 'ditjen', 201, 2023, 'KEL-1/2023', '${S(1)}', 'approved'),
          ('${K(2)}', 'dir_ptep', 202, 2023, 'KEL-2/2023', '${S(1)}', 'approved'),
          ('${K(3)}', 'ditjen', 203, 2023, 'KEL-3/2023', '${S(2)}', 'draft'),
          ('${K(4)}', 'ditjen', 204, 2023, 'KEL-4/2023', '${S(7)}', 'approved');
    `);
}

const TABLES = ['rangkaian_surat', 'rangkaian_anggota', 'rangkaian_relasi', 'rangkaian_peserta', 'disposisi_label_unit', 'audit_log', 'surat_masuk'];
async function counts(db: PGlite) {
    const out: Record<string, number> = {};
    for (const table of TABLES) out[table] = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    return out;
}

let database: PGlite;
beforeAll(async () => {
    database = await createRangkaianP5Database();
    await seedRangkaianBase(database);
}, 180_000);
afterAll(async () => { await database?.close(); });

describe('pemetaan label disposisi lama', () => {
    it.each(LEGACY_LABELS)('%s → %s (%s)', (label, unit, status) => {
        expect(resolveLabel(label)).toMatchObject({ unit, status });
    });

    it('D6: label Kabag tetap label-saja dan tidak ada seed yang menunjuk unit bagian', () => {
        const kabag = LABEL_SEED.filter((entry: any) => entry.label.startsWith('kabag'));
        expect(kabag).toHaveLength(2);
        expect(kabag.every((entry: any) => entry.unit === null && /D6/.test(entry.catatan))).toBe(true);
        expect(LABEL_SEED.some((entry: any) => String(entry.unit).startsWith('bagian'))).toBe(false);
        expect(Object.isFrozen(LABEL_SEED)).toBe(true);
    });

    it('normalisasi JS identik dengan normalisasi SQL spec', async () => {
        for (const [label] of [...LEGACY_LABELS, ['  Dit.   BPPT  ', null, ''] as [string, null, string]]) {
            const { rows } = await database.query<{ norm: string }>(
                `SELECT lower(regexp_replace(trim($1::text), '\\s+', ' ', 'g')) AS norm`, [label]);
            expect(normalizeLabel(label)).toBe(rows[0].norm);
        }
    });

    it('normalisasi SQL skrip identik dengan JS, termasuk whitespace Unicode [P5-T3-3]', async () => {
        const labels = [...LEGACY_LABELS.map(([label]) => label), '  Dit.   BPPT  ', ' BPPT ', ...LABEL_WHITESPACE_UNICODE];
        for (const label of labels) {
            const { rows } = await database.query<{ norm: string }>(
                `SELECT ${labelNormSql('$1::text')} AS norm`, [label]);
            expect(normalizeLabel(label)).toBe(rows[0].norm);
        }
        expect(resolveLabel(' BPPT ')).toMatchObject({ unit: 'dir_bppt', status: 'terpetakan' });
    });

    it('kelas whitespace SQL skrip sama dengan visibility-spec P2', () => {
        expect(LABEL_NORM_TRIM_PATTERN).toBe(PG_TRIM_PATTERN);
        expect(LABEL_NORM_SPASI_PATTERN).toBe(PG_SEPARATOR_PATTERN.replace('-]+', ']+'));
        expect(SIFAT_NORM_SEPARATOR_PATTERN).toBe(PG_SEPARATOR_PATTERN);
        expect([...KELAS_SIFAT_DIKENAL].sort()).toEqual([...new Set([...BIASA_SIFAT_ALIASES, ...SECURITY_CLASSES])].sort());
    });

    it('baris tabel pemetaan perlu_verifikasi=true yang merutekan ditolak (fail closed, dilaporkan)', async () => {
        await database.exec(`INSERT INTO disposisi_label_unit (label_norm, unit_kerja_id, perlu_verifikasi) VALUES
            ('dit. plp baru', 'dir_plp', true), ('kabag baru', NULL, true);`);
        try {
            await expect(assertPemetaanSah(database)).rejects.toThrow(/perlu_verifikasi.*"dit\. plp baru" → dir_plp/);
            // Baris label-saja (unit NULL) tidak merutekan, jadi tidak ikut ditolak.
            const galat = await assertPemetaanSah(database).catch((error: Error) => error);
            expect(String((galat as Error).message)).not.toContain('kabag baru');
            await expect(buildPlan(database, { batas: BATAS_UJI })).rejects.toThrow(/perlu_verifikasi/);
        } finally {
            await database.exec(`DELETE FROM disposisi_label_unit WHERE label_norm IN ('dit. plp baru', 'kabag baru')`);
        }
        await expect(assertPemetaanSah(database)).resolves.toBeUndefined();
    });

    it('sesi skrip mematok TimeZone UTC sebelum membandingkan batas data lama', async () => {
        await database.exec(`SET TIME ZONE 'Asia/Jakarta'`);
        expect(await siapkanSesi(database)).toBe('UTC');
        expect((await database.query<{ TimeZone: string }>('SHOW TimeZone')).rows[0]).toEqual({ TimeZone: 'UTC' });
    });

    it('pemetaan yang menunjuk unit bagian atau unit tak dikenal ditolak sebelum dry-run', async () => {
        await expect(assertPemetaanSah(database)).resolves.toBeUndefined();
        await database.exec(`
            INSERT INTO unit_kerja (id, name, unit_type, can_receive_distribution)
            VALUES ('bagian_umum', 'Bagian Umum', 'bagian', false) ON CONFLICT (id) DO NOTHING;
            INSERT INTO disposisi_label_unit (label_norm, unit_kerja_id) VALUES ('bagian umum', 'bagian_umum');`);
        await expect(assertPemetaanSah(database)).rejects.toThrow(/D6\).*"bagian umum" → bagian_umum/);
        await database.exec(`DELETE FROM disposisi_label_unit WHERE label_norm = 'bagian umum'`);
        await expect(assertPemetaanSah(database)).resolves.toBeUndefined();
    });
});

describe('lingkup BASE_CTE [P5-T3-2]', () => {
    it('hanya surat sebelum batas; label ke unit pemilik, Kabag (D6), dan duplikat tidak menjadi rute', async () => {
        await database.query(
            `INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat, disposisi, created_at, is_deleted)
             VALUES
               ('00000000-0000-4000-8000-00000000a301', 'sesditjen', 901, 2026, 'biasa', 'SM-L1', 'Lama', 'Kanwil', '2026-01-02',
                ARRAY['BPPT', 'Dit. BPPT ', 'Sesditjen', 'Kabag Program dan Hukum', 'Bagian Umum', ''], '2026-01-02T00:00:00Z', false),
               ('00000000-0000-4000-8000-00000000a302', 'sesditjen', 902, 2026, 'biasa', 'SM-L2', 'Baru', 'Kanwil', '2026-07-02',
                ARRAY['PTEP'], '2026-07-02T00:00:00Z', false),
               ('00000000-0000-4000-8000-00000000a303', 'sesditjen', 903, 2026, 'biasa', 'SM-L3', 'Terhapus', 'Kanwil', '2026-01-03',
                ARRAY['KTPP'], '2026-01-03T00:00:00Z', true)`);
        try {
            const { rows } = await database.query<{ surat_masuk_id: string; unit_kerja_id: string; label_asal: string }>(
                `WITH ${BASE_CTE} SELECT surat_masuk_id, unit_kerja_id, label_asal FROM rute ORDER BY surat_masuk_id, unit_kerja_id`,
                [...seedParams(), '2026-06-01T00:00:00+07:00']);
            expect(rows).toEqual([
                { surat_masuk_id: '00000000-0000-4000-8000-00000000a301', unit_kerja_id: 'dir_bppt', label_asal: 'BPPT' },
            ]);
            const awal = await database.query(`WITH ${BASE_CTE} SELECT 1 FROM rute`, [...seedParams(), '2026-01-01T00:00:00Z']);
            expect(awal.rows).toHaveLength(0);
        } finally {
            await database.exec(`DELETE FROM surat_masuk WHERE id::text LIKE '00000000-0000-4000-8000-00000000a3%'`);
        }
    });
});

describe('batas data lama [P5-G-5, P5-C-1, P5-C-6]', () => {
    it('nilai env yang bukan ISO-8601 berzona ditolak', async () => {
        for (const mentah of ['2026-10-05', '2026-10-05T00:00:00', 'kemarin', '2026-13-45T00:00:00+07:00']) {
            await expect(resolveBatasDataLama(database, { RANGKAIAN_DATA_LAMA_SEBELUM: mentah }))
                .rejects.toThrow(/RANGKAIAN_DATA_LAMA_SEBELUM harus ISO-8601 dengan zona waktu/);
        }
    });

    it('nilai env berzona dinormalisasi ke ISO UTC', async () => {
        await expect(resolveBatasDataLama(database, { RANGKAIAN_DATA_LAMA_SEBELUM: ' 2026-10-05T00:00:00+07:00 ' }))
            .resolves.toBe('2026-10-04T17:00:00.000Z');
    });

    it('tanpa env dan tanpa rangkaian non-data-lama → berhenti (fail closed)', async () => {
        const { rows } = await database.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM rangkaian_surat WHERE asal <> 'data_lama'`);
        expect(rows[0].n).toBe(0);
        await expect(resolveBatasDataLama(database, {}))
            .rejects.toThrow(/Batas data lama tidak dapat ditentukan/);
    });

    it('fallback DB memakai min(created_at) rangkaian non-data-lama', async () => {
        const client = {
            query: async (text: string) => {
                expect(text).toMatch(/min\(created_at\).*asal <> 'data_lama'/s);
                return { rows: [{ batas: new Date('2026-10-01T02:03:04.000Z') }] };
            },
        };
        await expect(resolveBatasDataLama(client, {})).resolves.toBe('2026-10-01T02:03:04.000Z');
    });

    it('--apply tanpa RANGKAIAN_DATA_LAMA_SEBELUM di shell ditolak, walau DB punya fallback (C-1)', async () => {
        let queried = false;
        const client = {
            query: async () => { queried = true; return { rows: [{ batas: new Date('2026-10-01T00:00:00Z') }] }; },
        };
        for (const batasShell of [undefined, '', '   ']) {
            await expect(tentukanBatasDataLama(client, { apply: true, batasShell }))
                .rejects.toThrow(/--apply mewajibkan RANGKAIAN_DATA_LAMA_SEBELUM di shell/);
        }
        expect(queried).toBe(false);
    });

    it('dry-run boleh memakai fallback DB dan melaporkan sumberBatas db; shell dilaporkan env', async () => {
        const client = { query: async () => ({ rows: [{ batas: new Date('2026-10-01T00:00:00Z') }] }) };
        await expect(tentukanBatasDataLama(client, { apply: false, batasShell: undefined }))
            .resolves.toEqual({ batasDataLama: '2026-10-01T00:00:00.000Z', sumberBatas: 'db' });
        await expect(tentukanBatasDataLama(client, { apply: true, batasShell: '2026-10-05T00:00:00+07:00' }))
            .resolves.toEqual({ batasDataLama: '2026-10-04T17:00:00.000Z', sumberBatas: 'env' });
    });
});

// peserta_baru = SM1→dir_bppt, SM2→dir_ptep, SM2→dir_ktpp, SM3→sesditjen = 4.
// SM8→dir_bppt sudah_didisposisikan (distribusi eksplisit ke dir_bppt). rangkaian_baru = SM1, SM2, SM3.
describe('dry-run', () => {
    // Fixture legacy dimasukkan di sini, bukan beforeAll global: R8 (asal='surat_masuk') akan
    // mengubah hasil test "tanpa rangkaian non-data-lama → berhenti" di atas bila dimasukkan lebih awal.
    beforeAll(async () => { await seedLegacy(database); }, 180_000);

    it('tidak menulis apa pun dan menghasilkan rencana deterministik', async () => {
        const before = await counts(database);
        const first = await buildPlan(database, { batas: BATAS_UJI });
        const second = await buildPlan(database, { batas: BATAS_UJI });
        expect(await counts(database)).toEqual(before);
        expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(second.sha256).toBe(first.sha256);
        expect(first.batasDataLama).toBe(BATAS_UJI);
        expect(first.total).toEqual({
            surat_target: 3, rangkaian_baru: 3, peserta_baru: 4,
            balasan_akan_ditautkan: 1, balasan_lintas_unit: 2,
            sudah_didisposisikan: 1, peserta_dilewati_diberkaskan: 0, sifat_tak_dikenal: 0,
        });
    });

    // P5-D-10: SM target dengan kelas sifat_surat tak dikenal (tetap tersamar bagi peserta meski flag menyala)
    // dilaporkan di total dan ikut SHA (gerbang rilis P5-h).
    it('melaporkan sifat_tak_dikenal pada surat target dan mengikatnya ke SHA', async () => {
        const awal = await buildPlan(database, { batas: BATAS_UJI });
        try {
            await database.exec(`UPDATE surat_masuk SET sifat_surat = ' Sangat-Rahasia ' WHERE id = '${S(1)}';
                                 UPDATE surat_masuk SET sifat_surat = 'Rahasia Negara' WHERE id = '${S(2)}';
                                 UPDATE surat_masuk SET sifat_surat = 'Kilat' WHERE id = '${S(6)}';`);
            const ubah = await buildPlan(database, { batas: BATAS_UJI });
            // SM1 'sangat_rahasia' dikenal; SM2 tak dikenal; SM6 tak dikenal tetapi bukan target (label tak terpetakan).
            expect(ubah.total.sifat_tak_dikenal).toBe(1);
            expect(ubah.sha256).not.toBe(awal.sha256);
        } finally {
            await database.exec(`UPDATE surat_masuk SET sifat_surat = 'Biasa' WHERE id IN ('${S(1)}', '${S(2)}', '${S(6)}')`);
        }
        expect((await buildPlan(database, { batas: BATAS_UJI })).sha256).toBe(awal.sha256);
    });

    it('melaporkan label → unit → jumlah termasuk label kosong, label-saja, dan tak dikenal', async () => {
        const { pemetaan } = await buildPlan(database, { batas: BATAS_UJI });
        const row = (norm: string) => pemetaan.find((item: any) => item.label_norm === norm);
        expect(row('bppt')).toMatchObject({ unit_kerja_id: 'dir_bppt', status: 'terpetakan', jumlah_surat: 2, jumlah_surat_dirutekan: 2 });
        expect(row('dirjen')).toMatchObject({ unit_kerja_id: 'ditjen', status: 'terpetakan', jumlah_surat_dirutekan: 0 });
        expect(row('kabag program dan hukum')).toMatchObject({ unit_kerja_id: null, status: 'label_saja', jumlah_surat_dirutekan: 0 });
        expect(row('')).toMatchObject({ status: 'kosong', jumlah_surat: 1 });
        expect(row('bagian entah')).toMatchObject({ status: 'tidak_dikenal' });
        expect(pemetaan.some((item: any) => item.label_norm === 'bppt' && item.jumlah_label === 3)).toBe(false);
    });

    it('menandai balasan lintas unit untuk ditinjau TU dan draf lama dilewati', async () => {
        const { balasan } = await buildPlan(database, { batas: BATAS_UJI });
        const byKeluar = Object.fromEntries(balasan.map((item: any) => [item.surat_keluar_id, item.tindakan]));
        expect(byKeluar).toEqual({
            [K(1)]: 'akan_ditautkan',
            [K(2)]: 'lintas_unit_ditinjau_tu',
            [K(3)]: 'dilewati_belum_disetujui',
            [K(4)]: 'lintas_unit_ditinjau_tu',
        });
    });

    it('calon unit pengolah hanya bila tepat satu unit direktorat terpetakan (spec §3 langkah 5)', async () => {
        const { calonPengolah } = await buildPlan(database, { batas: BATAS_UJI });
        const bySurat = Object.fromEntries(calonPengolah.map((item: any) => [item.surat_masuk_id, item.calon_unit_pengolah]));
        expect(bySurat[S(1)]).toBe('dir_bppt');
        // S3 rutenya hanya sesditjen (bukan direktorat) → tidak ada calon (Task 5 amandemen butir 1).
        expect(bySurat[S(3)]).toBeUndefined();
        expect(bySurat[S(2)]).toBeUndefined(); // dua unit (dir_ptep, dir_ktpp) → tidak ada calon tunggal
    });

    it('calon unit pengolah: rute campuran direktorat + sesditjen menghasilkan unit direktorat, bukan sesditjen', async () => {
        const S3B = '00000000-0000-4000-8000-000000000199';
        await database.exec(`
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, sifat_surat, disposisi, status, is_deleted)
            VALUES ('${S3B}', 'ditjen', 199, 2023, 'B-199/2023', 'Rute campuran', 'Biasa', ARRAY['BPPT','SekDitjen'], 'belum_dibalas', false);
        `);
        try {
            const { calonPengolah } = await buildPlan(database, { batas: BATAS_UJI });
            const bySurat = Object.fromEntries(calonPengolah.map((item: any) => [item.surat_masuk_id, item.calon_unit_pengolah]));
            expect(bySurat[S3B]).toBe('dir_bppt');
        } finally {
            await database.exec(`DELETE FROM surat_masuk WHERE id = '${S3B}'`);
        }
    });

    it('calon unit pengolah: SM yang sudah punya rangkaian_anggota tidak menghasilkan baris meski rutenya tunggal-direktorat', async () => {
        const S_SUDAH_RANGKAI = '00000000-0000-4000-8000-000000000198';
        await database.exec(`
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, sifat_surat, disposisi, status, is_deleted)
            VALUES ('${S_SUDAH_RANGKAI}', 'ditjen', 198, 2023, 'B-198/2023', 'Sudah punya rangkaian tapi belum didisposisikan', 'Biasa', ARRAY['PTEP'], 'belum_dibalas', false);
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran)
            VALUES ('${R8}', '${S_SUDAH_RANGKAI}', 'ditjen', 'anggota');
        `);
        try {
            const { calonPengolah } = await buildPlan(database, { batas: BATAS_UJI });
            const bySurat = Object.fromEntries(calonPengolah.map((item: any) => [item.surat_masuk_id, item.calon_unit_pengolah]));
            // Rutenya (dir_ptep) tunggal-direktorat dan belum didisposisikan, tapi SM sudah punya
            // rangkaian_anggota → bukan rangkaian BARU, jadi tidak boleh menghasilkan baris calon.
            expect(bySurat[S_SUDAH_RANGKAI]).toBeUndefined();
        } finally {
            await database.exec(`DELETE FROM rangkaian_anggota WHERE surat_masuk_id = '${S_SUDAH_RANGKAI}'`);
            await database.exec(`DELETE FROM surat_masuk WHERE id = '${S_SUDAH_RANGKAI}'`);
        }
    });

    it('menulis CSV yang aman dari formula spreadsheet', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rangkaian-lama-'));
        const plan = await buildPlan(database, { batas: BATAS_UJI });
        writePlanFiles(dir, plan);
        const csv = readFileSync(join(dir, 'pemetaan-label.csv'), 'utf8');
        expect(csv.split('\n')[0]).toBe('label_norm,contoh_label,unit_kerja_id,status,jumlah_label,jumlah_surat,jumlah_surat_dirutekan');
        expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
        const ringkasan = JSON.parse(readFileSync(join(dir, 'ringkasan.json'), 'utf8'));
        expect(ringkasan).toMatchObject({ sha256: plan.sha256, batasDataLama: BATAS_UJI });
        expect(readFileSync(join(dir, 'balasan-ditinjau.csv'), 'utf8')).toContain('lintas_unit_ditinjau_tu');
        expect(readFileSync(join(dir, 'calon-pengolah.csv'), 'utf8').split('\n')[0])
            .toBe('surat_masuk_id,nomor_surat,calon_unit_pengolah');
    });

    it('hanya surat sebelum batas data lama yang dirutekan; batas ikut menentukan SHA', async () => {
        const awal = await buildPlan(database, { batas: '2000-01-01T00:00:00.000Z' });
        expect(awal.total).toMatchObject({ surat_target: 0, rangkaian_baru: 0, peserta_baru: 0 });
        expect(awal.sha256).not.toBe((await buildPlan(database, { batas: BATAS_UJI })).sha256);
    });
});

// Urutan test di describe ini MENGIKAT (C-12): tiap test memakai hasil apply sebelumnya, dan test
// "sudah diberkaskan" wajib terakhir karena memberkaskan rangkaian S1.
describe('apply', () => {
    const TARGET_HIDUP = '00000000-0000-4000-8000-0000000003a1';
    const SM_HIDUP = '00000000-0000-4000-8000-0000000001a1';
    const induk = async (suratMasukId: string) => (await database.query<{ id: string }>(
        `SELECT rangkaian_id AS id FROM rangkaian_anggota WHERE surat_masuk_id = $1`, [suratMasukId])).rows[0]?.id;

    beforeAll(async () => {
        // -t "apply" saja melewati beforeAll describe('dry-run'); fixture legacy tetap dipasang sekali.
        const { rows } = await database.query(`SELECT 1 FROM surat_masuk WHERE id = '${S(1)}'`);
        if (rows.length === 0) await seedLegacy(database);
    }, 180_000);

    it('menolak tanpa SHA, dengan SHA berbeda, atau bila langkah 1 belum tuntas', async () => {
        await expect(applyPlan(database, { approvedSha256: null, batas: BATAS_UJI })).rejects.toThrow(/--approved-sha256/);
        await expect(applyPlan(database, { approvedSha256: 'f'.repeat(64), batas: BATAS_UJI }))
            .rejects.toThrow(/Rencana berubah sejak sign-off/);
        await expect(applyPlan(database, { approvedSha256: 'a'.repeat(64) })).rejects.toThrow(/batas/);
        const stepOneIncomplete = { query: async () => ({ rows: [{ n: 3 }] }) };
        await expect(applyPlan(stepOneIncomplete, { approvedSha256: 'a'.repeat(64), batas: BATAS_UJI }))
            .rejects.toThrow(/Backfill langkah 1 belum tuntas: 3 baris/);
        expect((await database.query(`SELECT count(*)::int AS n FROM rangkaian_surat WHERE asal = 'data_lama'`)).rows[0])
            .toEqual({ n: 0 });
    });

    it('menerapkan rencana yang disetujui tanpa menulis ulang status surat masuk', async () => {
        const statusBefore = (await database.query('SELECT id, status FROM surat_masuk ORDER BY id')).rows;
        const plan = await buildPlan(database, { batas: BATAS_UJI });
        const summary = await applyPlan(database, { approvedSha256: plan.sha256, batas: BATAS_UJI });
        expect(summary).toEqual({
            suratDiproses: 3, rangkaianBaru: 3, pesertaBaru: 4, balasanDitautkan: 1,
            balasanDilewatiDiberkaskan: 0, pesertaDilewatiDiberkaskan: 0,
        });
        expect((await database.query('SELECT id, status FROM surat_masuk ORDER BY id')).rows).toEqual(statusBefore);

        const rangkaian = (await database.query<any>(`
            SELECT ra.surat_masuk_id, rs.asal, rs.status, rs.selesai_manual, rs.unit_pencatat_id, rs.unit_pengolah_id, rs.judul, ra.sumber
              FROM rangkaian_surat rs JOIN rangkaian_anggota ra ON ra.rangkaian_id = rs.id AND ra.peran = 'induk'
             WHERE rs.asal = 'data_lama' ORDER BY ra.surat_masuk_id`)).rows;
        expect(rangkaian).toEqual([
            { surat_masuk_id: S(1), asal: 'data_lama', status: 'selesai', selesai_manual: false, unit_pencatat_id: 'ditjen', unit_pengolah_id: null, judul: 'Pengadaan tanah jalan tol', sumber: 'data_lama' },
            { surat_masuk_id: S(2), asal: 'data_lama', status: 'selesai', selesai_manual: false, unit_pencatat_id: 'ditjen', unit_pengolah_id: null, judul: 'ND-2/2023', sumber: 'data_lama' },
            { surat_masuk_id: S(3), asal: 'data_lama', status: 'selesai', selesai_manual: false, unit_pencatat_id: 'ditjen', unit_pengolah_id: null, judul: '(tanpa perihal)', sumber: 'data_lama' },
        ]);
        const peserta = (await database.query<any>(`
            SELECT ra.surat_masuk_id, rp.unit_kerja_id, rp.label_asal FROM rangkaian_peserta rp
              JOIN rangkaian_anggota ra ON ra.rangkaian_id = rp.rangkaian_id AND ra.peran = 'induk'
             ORDER BY ra.surat_masuk_id, rp.unit_kerja_id`)).rows;
        expect(peserta.map((row) => `${row.surat_masuk_id.slice(-2)}:${row.unit_kerja_id}`))
            .toEqual(['01:dir_bppt', '02:dir_ktpp', '02:dir_ptep', '03:sesditjen']);
        expect((await database.query(`SELECT status, unit_pengolah_id FROM rangkaian_surat WHERE id = '${R8}'`)).rows)
            .toEqual([{ status: 'aktif', unit_pengolah_id: null }]);
        expect((await database.query(`SELECT jenis_relasi FROM rangkaian_relasi`)).rows).toEqual([{ jenis_relasi: 'balasan' }]);
        expect((await database.query(`SELECT count(*)::int AS n FROM rangkaian_anggota WHERE surat_keluar_id IN ('${K(2)}','${K(3)}','${K(4)}')`)).rows[0]).toEqual({ n: 0 });
        expect((await database.query(`SELECT label_norm, unit_kerja_id FROM disposisi_label_unit WHERE label_norm LIKE 'kabag%' ORDER BY 1`)).rows)
            .toEqual([
                { label_norm: 'kabag kepegawaian keuangan dan umum', unit_kerja_id: null },
                { label_norm: 'kabag program dan hukum', unit_kerja_id: null },
            ]);
        expect((await database.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE user_email = 'system:backfill-rangkaian-lama'`)).rows[0].n)
            .toBeGreaterThanOrEqual(3 + 4 + 1);
        // [P5-T5-1] pengolah turunan label tidak ditulis; hanya dicatat sebagai calon di audit.
        const { rows: [auditS1] } = await database.query<{ changes: any }>(
            `SELECT changes FROM audit_log WHERE user_email = 'system:backfill-rangkaian-lama' AND action = 'create'
                AND entity_type = 'rangkaian_surat' AND changes->>'suratMasukId' = '${S(1)}'`);
        expect(auditS1.changes).toMatchObject({ unitPengolahId: null, calonUnitPengolah: 'dir_bppt' });
    });

    it('idempoten: dijalankan dua kali, jumlah baris identik', async () => {
        const before = await counts(database);
        const plan = await buildPlan(database, { batas: BATAS_UJI });
        expect(plan.total).toMatchObject({ rangkaian_baru: 0, peserta_baru: 0, balasan_akan_ditautkan: 0 });
        expect(await applyPlan(database, { approvedSha256: plan.sha256, batas: BATAS_UJI })).toEqual({
            suratDiproses: 3, rangkaianBaru: 0, pesertaBaru: 0, balasanDitautkan: 0,
            balasanDilewatiDiberkaskan: 0, pesertaDilewatiDiberkaskan: 0,
        });
        expect(await counts(database)).toEqual(before);
    });

    it('G-LOCK per transaksi batch: semua surat_keluar → semua surat_masuk → semua rangkaian_surat, id menaik [P5-G-4]', async () => {
        const RANK: Record<string, number> = { surat_keluar: 0, surat_masuk: 1, rangkaian_surat: 2 };
        const transaksi: Array<Array<{ tabel: string; params: unknown[] | undefined }>> = [];
        let aktif: Array<{ tabel: string; params: unknown[] | undefined }> | null = null;
        const client = {
            query: async (text: string, params?: unknown[]) => {
                if (/^\s*BEGIN\s*$/.test(text)) { aktif = []; transaksi.push(aktif); }
                if (/^\s*(COMMIT|ROLLBACK)\s*$/.test(text)) aktif = null;
                const kunci = /FROM\s+(surat_keluar|surat_masuk|rangkaian_surat)\b[\s\S]*FOR UPDATE/.exec(text);
                if (aktif && kunci) aktif.push({ tabel: kunci[1], params });
                return database.query(text, params);
            },
        };
        const plan = await buildPlan(database, { batas: BATAS_UJI });
        const sudahAda = (await database.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM rangkaian_surat WHERE asal = 'data_lama'`)).rows[0].n > 0;
        await applyPlan(client, { approvedSha256: plan.sha256, batas: BATAS_UJI });
        const batch = transaksi.filter((kunci) => kunci.length > 0);
        expect(batch.length).toBeGreaterThan(0);
        for (const kunci of batch) {
            // Satu pernyataan kunci per tabel per transaksi, dalam urutan SK → SM → R.
            const urutan = kunci.map((entry) => RANK[entry.tabel]);
            expect(urutan).toEqual([...urutan].sort((a, b) => a - b));
            expect(new Set(kunci.map((entry) => entry.tabel)).size).toBe(kunci.length);
            for (const entry of kunci) {
                const ids = entry.params?.[0] as string[];
                expect(Array.isArray(ids)).toBe(true);
                expect(ids).toEqual([...ids].sort());
            }
        }
        // Batch memuat S1 (balasan K1/K2); dalam urutan C-12 tiga rangkaian data lamanya sudah ada.
        expect(batch[0].map((entry) => entry.tabel))
            .toEqual(sudahAda ? ['surat_keluar', 'surat_masuk', 'rangkaian_surat'] : ['surat_keluar', 'surat_masuk']);
    });

    it('tidak menghidupkan kembali peserta yang sudah dicabut', async () => {
        await database.exec(`UPDATE rangkaian_peserta SET berakhir_at = now(),
            berakhir_by = '00000000-0000-4000-8000-0000000005a1', alasan_berakhir = 'Bukan penerima disposisi sebenarnya'
            WHERE unit_kerja_id = 'dir_ptep'`);
        const plan = await buildPlan(database, { batas: BATAS_UJI });
        await applyPlan(database, { approvedSha256: plan.sha256, batas: BATAS_UJI });
        expect((await database.query(`SELECT count(*)::int AS n, bool_and(berakhir_at IS NOT NULL) AS dicabut
            FROM rangkaian_peserta WHERE unit_kerja_id = 'dir_ptep'`)).rows).toEqual([{ n: 1, dicabut: true }]);
    });

    it('batch deadlock/serialization diulang; penghitung hanya dari transaksi yang commit', async () => {
        let gagal = 0;
        const client = {
            query: async (text: string, params?: unknown[]) => {
                if (gagal === 0 && /FROM surat_keluar sk\s+WHERE sk\.balasan_untuk/.test(text)) {
                    gagal += 1;
                    throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
                }
                return database.query(text, params);
            },
        };
        const before = await counts(database);
        const plan = await buildPlan(database, { batas: BATAS_UJI });
        expect(await applyPlan(client, { approvedSha256: plan.sha256, batas: BATAS_UJI }))
            .toMatchObject({ suratDiproses: 3, rangkaianBaru: 0, pesertaBaru: 0 });
        expect(gagal).toBe(1);
        expect(await counts(database)).toEqual(before);
    });

    it('parseArgs hanya menerima argumen yang dikenal', () => {
        expect(parseArgs(['--apply', `--approved-sha256=${'A'.repeat(64)}`, '--out=laporan-x']))
            .toMatchObject({ apply: true, approvedSha256: 'a'.repeat(64) });
        expect(parseArgs([])).toMatchObject({ apply: false, isiPengolah: false, approvedSha256: null, outDir: null });
        expect(parseArgs(['--isi-pengolah'])).toMatchObject({ apply: false, isiPengolah: true });
        expect(() => parseArgs(['--force'])).toThrow(/Argumen tidak dikenal/);
        expect(() => parseArgs([`--approved-sha256=${'a'.repeat(64)}`])).toThrow(/hanya bersama --apply/);
    });

    it('mode tulis hanya sebagai role runtime simsa_api kecuali dikecualikan eksplisit (C-1)', () => {
        expect(() => pastikanRoleRuntime({ db_user: 'simsa_maintenance' }, { apply: true, env: {} }))
            .toThrow(/simsa_api/);
        expect(() => pastikanRoleRuntime({ db_user: 'simsa_api' }, { apply: true, env: {} })).not.toThrow();
        expect(() => pastikanRoleRuntime({ db_user: 'postgres' }, { apply: false, env: {} })).not.toThrow();
        // ALLOW_NON_RUNTIME_ROLE hanya untuk database lokal.
        for (const host of ['localhost', '127.0.0.1', '::1', '[::1]']) {
            expect(() => pastikanRoleRuntime({ db_user: 'postgres' }, { apply: true, host, env: { ALLOW_NON_RUNTIME_ROLE: '1' } })).not.toThrow();
        }
        for (const host of ['ep-abc.ap-southeast-1.aws.neon.tech', 'localhost.evil.test', '10.0.0.5', undefined]) {
            expect(() => pastikanRoleRuntime({ db_user: 'postgres' }, { apply: true, host, env: { ALLOW_NON_RUNTIME_ROLE: '1' } }))
                .toThrow(/lokal/);
        }
    });

    describe('mode isi pengolah [P5-C-2]', () => {
        it('rencana isi-pengolah terikat mode dan hanya memuat rangkaian data lama selesai tanpa pengolah', async () => {
            const biasa = await buildPlan(database, { batas: BATAS_UJI });
            const isi = await buildPlan(database, { batas: BATAS_UJI, isiPengolah: true });
            expect(isi.sha256).not.toBe(biasa.sha256);
            expect(isi.calonPengolah).toEqual([
                { surat_masuk_id: S(1), nomor_surat: 'B-1/2023', calon_unit_pengolah: 'dir_bppt', rangkaian_id: await induk(S(1)) },
            ]);
            expect(isi.total).toMatchObject({ pengolah_akan_diisi: 1 });
            // Minor 7: CSV isi-pengolah memuat rangkaian_id yang akan ditulis.
            const dir = mkdtempSync(join(tmpdir(), 'rangkaian-lama-isi-'));
            writePlanFiles(dir, isi);
            const [header, baris] = readFileSync(join(dir, 'calon-pengolah.csv'), 'utf8').split('\n');
            expect(header).toBe('surat_masuk_id,nomor_surat,calon_unit_pengolah,rangkaian_id');
            expect(baris).toBe(`${S(1)},B-1/2023,dir_bppt,${await induk(S(1))}`);
            await expect(isiPengolahPlan(database, { approvedSha256: biasa.sha256, batas: BATAS_UJI }))
                .rejects.toThrow(/Rencana berubah sejak sign-off/);
            await expect(isiPengolahPlan(database, { approvedSha256: null, batas: BATAS_UJI }))
                .rejects.toThrow(/--approved-sha256/);
        });

        it('baris yang berubah setelah sign-off dilewati di bawah kunci (tidak ditimpa)', async () => {
            const rs1 = await induk(S(1));
            const plan = await buildPlan(database, { batas: BATAS_UJI, isiPengolah: true });
            let disela = false;
            const client = {
                query: async (text: string, params?: unknown[]) => {
                    if (!disela && text === 'BEGIN') {
                        disela = true;
                        await database.query(`UPDATE rangkaian_surat SET unit_pengolah_id = 'dir_ktpp' WHERE id = $1`, [rs1]);
                    }
                    return database.query(text, params);
                },
            };
            try {
                expect(await isiPengolahPlan(client, { approvedSha256: plan.sha256, batas: BATAS_UJI }))
                    .toEqual({ pengolahDiisi: 0, pengolahDilewati: 1 });
                expect((await database.query(`SELECT unit_pengolah_id FROM rangkaian_surat WHERE id = $1`, [rs1])).rows)
                    .toEqual([{ unit_pengolah_id: 'dir_ktpp' }]);
            } finally {
                await database.query(`UPDATE rangkaian_surat SET unit_pengolah_id = NULL WHERE id = $1`, [rs1]);
            }
        });

        it('S1 mendapat dir_bppt dengan audit; run kedua tidak mengubah apa pun', async () => {
            const rs1 = await induk(S(1));
            const plan = await buildPlan(database, { batas: BATAS_UJI, isiPengolah: true });
            expect(await isiPengolahPlan(database, { approvedSha256: plan.sha256, batas: BATAS_UJI }))
                .toEqual({ pengolahDiisi: 1, pengolahDilewati: 0 });
            expect((await database.query(`SELECT unit_pengolah_id, status FROM rangkaian_surat WHERE id = $1`, [rs1])).rows)
                .toEqual([{ unit_pengolah_id: 'dir_bppt', status: 'selesai' }]);
            const { rows: audit } = await database.query<{ action: string; changes: any }>(
                `SELECT action, changes FROM audit_log WHERE entity_id = $1 AND changes ? 'aksesBaru'`, [rs1]);
            expect(audit).toEqual([{
                action: 'update',
                changes: {
                    before: { unitPengolahId: null }, after: { unitPengolahId: 'dir_bppt' },
                    sumber: 'backfill-rangkaian-lama', aksesBaru: ['dir_bppt'], suratMasukId: S(1),
                },
            }]);

            const before = await counts(database);
            const lagi = await buildPlan(database, { batas: BATAS_UJI, isiPengolah: true });
            expect(lagi.calonPengolah).toEqual([]);
            expect(await isiPengolahPlan(database, { approvedSha256: lagi.sha256, batas: BATAS_UJI }))
                .toEqual({ pengolahDiisi: 0, pengolahDilewati: 0 });
            expect(await counts(database)).toEqual(before);
        });
    });

    it('gabung rangkaian data lama ke rangkaian hidup: target tetap aktif (gerbang rilis g) dan peserta dicabut tidak hidup lagi', async () => {
        holder.db = drizzle(database);
        const { rangkaianService } = await import('../services/rangkaian.service.js');
        await database.exec(`
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, sifat_surat, status)
            VALUES ('${SM_HIDUP}', 'ditjen', 301, 2026, 'B-301/2026', 'Rangkaian hidup', 'Biasa', 'belum_dibalas');
            INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun, selesai_at)
            VALUES ('${TARGET_HIDUP}', 'RS-2026-900301', 'surat_masuk', 'selesai', 'ditjen', 'Rangkaian hidup', 2026, now());
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran)
            VALUES ('${TARGET_HIDUP}', '${SM_HIDUP}', 'ditjen', 'induk');
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id)
            VALUES ('${SM_HIDUP}', 'ditjen', 'dir_ktpp', 'processed', '${TARGET_HIDUP}');`);
        const rs2 = await induk(S(2));
        const actor = { userId: P5_IDS.superA, userEmail: 'super-a@example.test' };
        const hasil = await holder.db.transaction((tx: any) => rangkaianService.gabung(
            tx, { targetId: TARGET_HIDUP, sumberId: rs2, alasan: 'Uji gabung data lama ke rangkaian hidup' }, actor));
        expect(hasil.targetStatus).toBe('aktif');
        const [ulang] = await holder.db.transaction((tx: any) => rangkaianService.recomputeStatus(tx, [TARGET_HIDUP], actor));
        expect(ulang).toMatchObject({ after: 'aktif', changed: false });
        // Fakta P1 surat_masuk_belum_ditangani menghitung anggota SM sumber='data_lama' (gerbang rilis g).
        const { rows: [fakta] } = await database.query<{ n: number }>(`
            SELECT count(*)::int AS n FROM rangkaian_anggota a JOIN surat_masuk sm ON sm.id = a.surat_masuk_id
             WHERE a.rangkaian_id = '${TARGET_HIDUP}' AND a.sumber = 'data_lama' AND sm.is_deleted IS NOT TRUE
               AND NOT EXISTS (SELECT 1 FROM surat_distributions d WHERE d.rangkaian_id = a.rangkaian_id
                                AND d.surat_masuk_id = sm.id AND d.status = 'processed')`);
        expect(fakta.n).toBeGreaterThanOrEqual(1);

        // Peserta dir_ptep yang dicabut tertinggal di rangkaian sumber (digabung); backfill ulang tidak
        // boleh membuatnya lagi di rangkaian tujuan.
        const before = await counts(database);
        const plan = await buildPlan(database, { batas: BATAS_UJI });
        expect(plan.total).toMatchObject({ rangkaian_baru: 0, peserta_baru: 0 });
        expect(await applyPlan(database, { approvedSha256: plan.sha256, batas: BATAS_UJI }))
            .toMatchObject({ rangkaianBaru: 0, pesertaBaru: 0 });
        expect(await counts(database)).toEqual(before);
        expect((await database.query(`SELECT count(*)::int AS n FROM rangkaian_peserta
            WHERE rangkaian_id = '${TARGET_HIDUP}' AND unit_kerja_id = 'dir_ptep'`)).rows[0]).toEqual({ n: 0 });
    }, 60_000);

    it('tidak menambah peserta ke rangkaian yang sudah diberkaskan (fail closed, RB P1 butir 9)', async () => {
        const { rows: [rs1] } = await database.query<{ id: string }>(`
            SELECT ra.rangkaian_id AS id FROM rangkaian_anggota ra WHERE ra.surat_masuk_id = '${S(1)}' AND ra.peran = 'induk'`);
        await database.exec(`
            UPDATE surat_masuk SET disposisi = array_append(disposisi, 'PLP') WHERE id = '${S(1)}';
            UPDATE rangkaian_surat SET status = 'diberkaskan', unit_pengolah_id = 'ditjen', klasifikasi_item_id = (SELECT min(id) FROM klasifikasi_arsip),
                   diberkaskan_at = now(), diberkaskan_by = '${P5_IDS.superA}' WHERE id = '${rs1.id}';`);
        const plan = await buildPlan(database, { batas: BATAS_UJI });
        expect(plan.total).toMatchObject({ peserta_baru: 0, peserta_dilewati_diberkaskan: 1 });
        const summary = await applyPlan(database, { approvedSha256: plan.sha256, batas: BATAS_UJI });
        expect(summary).toMatchObject({ pesertaBaru: 0, pesertaDilewatiDiberkaskan: 1 });
        expect((await database.query(`SELECT count(*)::int AS n FROM rangkaian_peserta WHERE rangkaian_id = '${rs1.id}' AND unit_kerja_id = 'dir_plp'`)).rows[0]).toEqual({ n: 0 });
        // Mode isi-pengolah tidak pernah menyentuh rangkaian yang diberkaskan.
        expect((await buildPlan(database, { batas: BATAS_UJI, isiPengolah: true })).calonPengolah).toEqual([]);
    });
});
