// backend/src/__tests__/backfill-rangkaian-lama.test.ts
import type { PGlite } from '@electric-sql/pglite';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    assertPemetaanSah,
    BASE_CTE,
    buildPlan,
    LABEL_NORM_TRIM_PATTERN,
    LABEL_NORM_SPASI_PATTERN,
    LABEL_SEED,
    labelNormSql,
    normalizeLabel,
    resolveBatasDataLama,
    resolveLabel,
    seedParams,
    tentukanBatasDataLama,
    writePlanFiles,
} from '../../scripts/backfill-rangkaian-lama.mjs';
import { PG_TRIM_PATTERN, PG_SEPARATOR_PATTERN } from '../services/access/visibility-spec.js';
import { createRangkaianP5Database, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

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
            sudah_didisposisikan: 1, peserta_dilewati_diberkaskan: 0,
        });
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
