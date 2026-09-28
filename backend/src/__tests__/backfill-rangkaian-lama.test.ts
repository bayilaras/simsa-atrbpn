// backend/src/__tests__/backfill-rangkaian-lama.test.ts
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    assertPemetaanSah,
    BASE_CTE,
    LABEL_NORM_TRIM_PATTERN,
    LABEL_NORM_SPASI_PATTERN,
    LABEL_SEED,
    labelNormSql,
    normalizeLabel,
    resolveBatasDataLama,
    resolveLabel,
    seedParams,
    tentukanBatasDataLama,
} from '../../scripts/backfill-rangkaian-lama.mjs';
import { PG_TRIM_PATTERN, PG_SEPARATOR_PATTERN } from '../services/access/visibility-spec.js';
import { createRangkaianP5Database, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

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
