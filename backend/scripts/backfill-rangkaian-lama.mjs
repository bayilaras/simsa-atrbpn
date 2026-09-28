#!/usr/bin/env node
// backend/scripts/backfill-rangkaian-lama.mjs
// Backfill langkah 2 (spec §3): label bebas surat_masuk.disposisi DATA LAMA →
// peserta rangkaian data lama. Default dry-run (tanpa tulis). --apply hanya
// menerapkan rencana yang SHA-256-nya sama dengan laporan yang sudah disign-off.
//
// Bagian ini (Task 3): konstanta, pemetaan label (D6), normalisasi, validasi
// pemetaan, dan batas data lama. Bagian Task 4: rencana/dry-run (buildPlan),
// CSV, dan hash SHA-256 rencana. --apply (Task 5) menyusul di berkas yang sama.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ACTOR = 'system:backfill-rangkaian-lama';
export const BATCH_SIZE = 500;
const D6 = 'D6: label jabatan/bagian hanya label, tidak dirutekan';

export const LABEL_SEED = Object.freeze([
  { label: 'bppt', unit: 'dir_bppt', catatan: null },
  { label: 'dit. bppt', unit: 'dir_bppt', catatan: null },
  { label: 'ptep', unit: 'dir_ptep', catatan: null },
  { label: 'dit. ptep', unit: 'dir_ptep', catatan: null },
  { label: 'ktpp', unit: 'dir_ktpp', catatan: null },
  { label: 'dit. ktpp', unit: 'dir_ktpp', catatan: null },
  { label: 'plp', unit: 'dir_plp', catatan: null },
  { label: 'dit. plp', unit: 'dir_plp', catatan: null },
  { label: 'sesditjen', unit: 'sesditjen', catatan: null },
  { label: 'sekditjen', unit: 'sesditjen', catatan: null },
  { label: 'dirjen', unit: 'ditjen', catatan: null },
  { label: 'ditjen', unit: 'ditjen', catatan: null },
  { label: 'kabag program dan hukum', unit: null, catatan: D6 },
  { label: 'kabag kepegawaian keuangan dan umum', unit: null, catatan: D6 },
].map(entry => Object.freeze(entry)));

/** Sama dengan SQL: lower(regexp_replace(trim(label), '\s+', ' ', 'g')). */
export function normalizeLabel(label) {
  return String(label ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function resolveLabel(label) {
  const labelNorm = normalizeLabel(label);
  if (!labelNorm) return { labelNorm, unit: null, status: 'kosong' };
  const seed = LABEL_SEED.find(entry => entry.label === labelNorm);
  if (!seed) return { labelNorm, unit: null, status: 'tidak_dikenal' };
  return { labelNorm, unit: seed.unit, status: seed.unit ? 'terpetakan' : 'label_saja' };
}

// [P5-T3-3] `trim()`/`\s` Postgres tidak membuang whitespace Unicode yang
// dibuang JS (NBSP, U+3000, U+FEFF, ...). Kelas eksplisit ini salinan
// JS_WHITESPACE_CODEPOINTS di src/services/access/visibility-spec.ts (skrip
// .mjs tidak dapat mengimpor .ts); kesamaannya dijaga test
// backfill-rangkaian-lama.test.ts ("kelas whitespace SQL skrip sama ...").
const JS_WHITESPACE_CODEPOINTS = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];
const PG_WHITESPACE_CLASS = JS_WHITESPACE_CODEPOINTS
  .map(cp => `\\u${cp.toString(16).padStart(4, '0')}`)
  .join('');
export const LABEL_NORM_TRIM_PATTERN = `^[${PG_WHITESPACE_CLASS}]+|[${PG_WHITESPACE_CLASS}]+$`;
export const LABEL_NORM_SPASI_PATTERN = `[${PG_WHITESPACE_CLASS}]+`;

/** Padanan SQL `normalizeLabel` untuk ekspresi `expr` (konstanta kode, bukan nilai pengguna). */
export function labelNormSql(expr) {
  return `lower(regexp_replace(regexp_replace(coalesce(${expr}, ''), '${LABEL_NORM_TRIM_PATTERN}', '', 'g'), '${LABEL_NORM_SPASI_PATTERN}', ' ', 'g'))`;
}

const SEED_PARAM_COUNT = LABEL_SEED.length * 3;
export const seedParams = () => LABEL_SEED.flatMap(entry => [entry.label, entry.unit, entry.catatan]);
const seedValues = LABEL_SEED
  .map((_, i) => `($${i * 3 + 1}::varchar, $${i * 3 + 2}::varchar, $${i * 3 + 3}::text)`)
  .join(', ');

// Seed kode menang atas baris tabel dengan label yang sama; baris tabel lain ikut dipakai dan ikut di-hash.
export const PETA_CTE = `
seed(label_norm, unit_kerja_id, catatan) AS (VALUES ${seedValues}),
peta AS (
  SELECT d.label_norm::varchar AS label_norm, d.unit_kerja_id::varchar AS unit_kerja_id, d.catatan
    FROM disposisi_label_unit d
   WHERE NOT EXISTS (SELECT 1 FROM seed s WHERE s.label_norm = d.label_norm)
  UNION ALL
  SELECT s.label_norm, s.unit_kerja_id, s.catatan FROM seed s
)`;

/**
 * Parameter $${SEED_PARAM_COUNT + 1} = batas data lama (timestamptz). Hanya label bebas DATA LAMA (spec §3 langkah 2).
 * [P5-T3-2] Pasangan (surat, unit) yang sudah punya baris surat_distributions status apa pun (termasuk
 * `rejected`, dan label kompatibilitas yang ditambahkan `distribute` P3) tidak dirutekan: dilaporkan
 * `sudah_didisposisikan`.
 */
export const BASE_CTE = `${PETA_CTE},
label AS (
  SELECT sm.id AS surat_masuk_id, sm.unit_kerja_id AS pemilik, l.label AS label_asal,
         ${labelNormSql('l.label')} AS label_norm
    FROM surat_masuk sm
   CROSS JOIN LATERAL unnest(sm.disposisi) AS l(label)
   WHERE sm.is_deleted IS NOT TRUE
     AND sm.created_at < $${SEED_PARAM_COUNT + 1}::timestamptz
),
kandidat AS (
  SELECT lb.surat_masuk_id, lb.pemilik, p.unit_kerja_id, lb.label_asal,
         EXISTS (SELECT 1 FROM surat_distributions sd
                  WHERE sd.surat_masuk_id = lb.surat_masuk_id AND sd.target_unit_id = p.unit_kerja_id) AS sudah_didisposisikan
    FROM label lb
    JOIN peta p ON p.label_norm = lb.label_norm
   WHERE p.unit_kerja_id IS NOT NULL AND p.unit_kerja_id <> lb.pemilik
),
rute AS (
  SELECT surat_masuk_id, pemilik, unit_kerja_id, min(label_asal) AS label_asal
    FROM kandidat
   WHERE NOT sudah_didisposisikan
   GROUP BY surat_masuk_id, pemilik, unit_kerja_id
)`;

/** D6 fail-closed: pemetaan tidak boleh menunjuk unit tak dikenal atau unit bagian. */
export async function assertPemetaanSah(client) {
  const { rows } = await client.query(`WITH ${PETA_CTE}
    SELECT p.label_norm, p.unit_kerja_id
      FROM peta p LEFT JOIN unit_kerja uk ON uk.id = p.unit_kerja_id
     WHERE p.unit_kerja_id IS NOT NULL
       AND (uk.id IS NULL OR uk.id LIKE 'bagian\\_%' OR uk.unit_type = 'bagian')
     ORDER BY p.label_norm`, seedParams());
  if (rows.length > 0) {
    const detail = rows.map(row => `"${row.label_norm}" → ${row.unit_kerja_id}`).join(', ');
    throw new Error(`Pemetaan tidak sah (unit tidak ada atau unit bagian; D6): ${detail}`);
  }
}

const ISO_BERZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Satu definisi dengan P4 D7 (resolveBatasDataLama); tanpa env dan tanpa rangkaian non-data-lama → berhenti (fail closed). */
export async function resolveBatasDataLama(client, env = process.env) {
  const mentah = env.RANGKAIAN_DATA_LAMA_SEBELUM?.trim();
  if (mentah) {
    if (!ISO_BERZONA.test(mentah) || Number.isNaN(Date.parse(mentah))) {
      throw new Error('RANGKAIAN_DATA_LAMA_SEBELUM harus ISO-8601 dengan zona waktu, mis. 2026-10-05T00:00:00+07:00');
    }
    return new Date(mentah).toISOString();
  }
  const { rows: [row] } = await client.query(`SELECT min(created_at) AS batas FROM rangkaian_surat WHERE asal <> 'data_lama'`);
  if (!row?.batas) throw new Error('Batas data lama tidak dapat ditentukan: isi RANGKAIAN_DATA_LAMA_SEBELUM dengan waktu kode P3 aktif');
  return new Date(row.batas).toISOString();
}

/**
 * [P5-C-1, P5-C-6] `batasShell` = RANGKAIAN_DATA_LAMA_SEBELUM yang ditangkap dari shell SEBELUM dotenv.
 * Fallback DB (min(created_at)) hanya untuk dry-run; --apply wajib memakai nilai shell yang sama
 * dengan nilai Vercel (runbook Deploy P4), dan ditolak sebelum menyentuh database.
 */
export async function tentukanBatasDataLama(client, { apply, batasShell }) {
  const shell = typeof batasShell === 'string' ? batasShell.trim() : '';
  if (apply && !shell) {
    throw new Error('--apply mewajibkan RANGKAIAN_DATA_LAMA_SEBELUM di shell, sama persis dengan nilai Vercel (runbook Deploy P4)');
  }
  const batasDataLama = await resolveBatasDataLama(client, { RANGKAIAN_DATA_LAMA_SEBELUM: shell || undefined });
  return { batasDataLama, sumberBatas: shell ? 'env' : 'db' };
}

// ---------------------------------------------------------------------------
// Task 4: rencana (dry-run), CSV, dan hash SHA-256 rencana. Tanpa efek samping.
// ---------------------------------------------------------------------------

const PEMETAAN_SQL = `WITH ${BASE_CTE}
SELECT lb.label_norm,
       min(lb.label_asal) AS contoh_label,
       p.unit_kerja_id,
       CASE WHEN lb.label_norm = '' THEN 'kosong'
            WHEN p.label_norm IS NULL THEN 'tidak_dikenal'
            WHEN p.unit_kerja_id IS NULL THEN 'label_saja'
            ELSE 'terpetakan' END AS status,
       count(*)::int AS jumlah_label,
       count(DISTINCT lb.surat_masuk_id)::int AS jumlah_surat,
       (count(DISTINCT lb.surat_masuk_id)
          FILTER (WHERE p.unit_kerja_id IS NOT NULL AND p.unit_kerja_id <> lb.pemilik))::int AS jumlah_surat_dirutekan
  FROM label lb
  LEFT JOIN peta p ON p.label_norm = lb.label_norm
 GROUP BY lb.label_norm, p.label_norm, p.unit_kerja_id
 ORDER BY lb.label_norm`;

/**
 * [P5-T4-1] `target` = surat yang punya rute (rute sudah mengecualikan pasangan sudah_didisposisikan).
 * `peserta_rows` menandai, per (surat, unit) yang perlu peserta baru, apakah rangkaian tujuannya sudah
 * `diberkaskan` (terminal, tidak bisa ditambah peserta lagi) — baris itu dihitung terpisah sebagai
 * `peserta_dilewati_diberkaskan`, bukan `peserta_baru`.
 */
const TOTAL_SQL = `WITH ${BASE_CTE},
target AS (
  SELECT t.surat_masuk_id, ra.rangkaian_id
    FROM (SELECT DISTINCT surat_masuk_id FROM rute) t
    LEFT JOIN rangkaian_anggota ra ON ra.surat_masuk_id = t.surat_masuk_id
),
peserta_rows AS (
  SELECT r.surat_masuk_id, r.unit_kerja_id, t.rangkaian_id, rs.status AS rangkaian_status,
         EXISTS (SELECT 1 FROM rangkaian_peserta rp
                  WHERE rp.rangkaian_id = t.rangkaian_id
                    AND rp.unit_kerja_id = r.unit_kerja_id
                    AND rp.peran = 'disposisi_lama') AS sudah_peserta
    FROM rute r
    JOIN target t ON t.surat_masuk_id = r.surat_masuk_id
    LEFT JOIN rangkaian_surat rs ON rs.id = t.rangkaian_id
)
SELECT
  (SELECT count(*) FROM target)::int AS surat_target,
  (SELECT count(*) FROM target WHERE rangkaian_id IS NULL)::int AS rangkaian_baru,
  (SELECT count(*) FROM peserta_rows
    WHERE NOT sudah_peserta AND rangkaian_status IS DISTINCT FROM 'diberkaskan')::int AS peserta_baru,
  (SELECT count(*) FROM peserta_rows
    WHERE NOT sudah_peserta AND rangkaian_status = 'diberkaskan')::int AS peserta_dilewati_diberkaskan,
  (SELECT count(DISTINCT (surat_masuk_id, unit_kerja_id)) FROM kandidat WHERE sudah_didisposisikan)::int AS sudah_didisposisikan`;

const BALASAN_SQL = `WITH ${BASE_CTE},
target AS (SELECT DISTINCT surat_masuk_id FROM rute)
SELECT sm.id AS surat_masuk_id, sm.nomor_surat AS nomor_masuk, sm.unit_kerja_id AS unit_masuk,
       sk.id AS surat_keluar_id, sk.nomor_surat AS nomor_keluar, sk.unit_kerja_id AS unit_keluar,
       sk.approval_status,
       CASE WHEN sk.unit_kerja_id <> sm.unit_kerja_id THEN 'lintas_unit_ditinjau_tu'
            WHEN ska.id IS NOT NULL THEN 'sudah_anggota'
            WHEN sk.approval_status <> 'approved' THEN 'dilewati_belum_disetujui'
            WHEN rs.status = 'diberkaskan' THEN 'dilewati_diberkaskan'
            ELSE 'akan_ditautkan' END AS tindakan
  FROM surat_keluar sk
  JOIN surat_masuk sm ON sm.id = sk.balasan_untuk AND sm.is_deleted IS NOT TRUE
  LEFT JOIN target t ON t.surat_masuk_id = sm.id
  LEFT JOIN rangkaian_anggota sma ON sma.surat_masuk_id = sm.id
  LEFT JOIN rangkaian_surat rs ON rs.id = sma.rangkaian_id
  LEFT JOIN rangkaian_anggota ska ON ska.surat_keluar_id = sk.id
 WHERE sk.is_deleted IS NOT TRUE
   AND (t.surat_masuk_id IS NOT NULL OR sk.unit_kerja_id <> sm.unit_kerja_id)
 ORDER BY sm.id, sk.id`;

/**
 * [P5-T4-1, P5-C-2] Calon unit pengolah (spec §3 langkah 5): hanya diisi bila tepat satu unit
 * direktorat terpetakan untuk surat itu. Baris di sini adalah *kandidat*; menuliskannya ke
 * `unit_pengolah_id` adalah mode terpisah, SHA-bound, yang diputuskan pada gerbang rilis (a) — lihat
 * amandemen C-2. Tidak dieksekusi oleh Task 4.
 */
const CALON_PENGOLAH_SQL = `WITH ${BASE_CTE},
calon_count AS (
  SELECT surat_masuk_id, count(DISTINCT unit_kerja_id) AS n, min(unit_kerja_id) AS unit_kerja_id
    FROM rute
   GROUP BY surat_masuk_id
)
SELECT cc.surat_masuk_id, sm.nomor_surat, cc.unit_kerja_id AS calon_unit_pengolah
  FROM calon_count cc
  JOIN surat_masuk sm ON sm.id = cc.surat_masuk_id
 WHERE cc.n = 1
 ORDER BY cc.surat_masuk_id`;

/**
 * Rencana lengkap tanpa efek samping; SHA-256 menutup `batasDataLama`, pemetaan, balasan,
 * calonPengolah, dan total, sehingga penanda tangan gerbang rilis mengunci semuanya sekaligus.
 * `batas` WAJIB — pemanggil (CLI) menentukannya lewat `tentukanBatasDataLama` terlebih dahulu.
 */
export async function buildPlan(client, { batas } = {}) {
  if (!batas) throw new Error('buildPlan membutuhkan { batas } (lihat tentukanBatasDataLama)');
  await assertPemetaanSah(client);
  const batasDataLama = batas;
  const params = [...seedParams(), batasDataLama];
  const pemetaan = (await client.query(PEMETAAN_SQL, params)).rows;
  const balasan = (await client.query(BALASAN_SQL, params)).rows;
  const calonPengolah = (await client.query(CALON_PENGOLAH_SQL, params)).rows;
  const counted = (await client.query(TOTAL_SQL, params)).rows[0];
  const total = {
    surat_target: counted.surat_target,
    rangkaian_baru: counted.rangkaian_baru,
    peserta_baru: counted.peserta_baru,
    balasan_akan_ditautkan: balasan.filter(row => row.tindakan === 'akan_ditautkan').length,
    balasan_lintas_unit: balasan.filter(row => row.tindakan === 'lintas_unit_ditinjau_tu').length,
    sudah_didisposisikan: counted.sudah_didisposisikan,
    peserta_dilewati_diberkaskan: counted.peserta_dilewati_diberkaskan,
  };
  const sha256 = createHash('sha256')
    .update(JSON.stringify({ batasDataLama, pemetaan, balasan, calonPengolah, total }))
    .digest('hex');
  return { pemetaan, balasan, calonPengolah, total, batasDataLama, sha256 };
}

/** Escape CSV aman-spreadsheet: apostrof di depan bila diawali =+-@\t\r (formula injection), lalu kutip bila perlu. */
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows, columns) {
  return `${[columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\n')}\n`;
}

const PEMETAAN_COLUMNS = ['label_norm', 'contoh_label', 'unit_kerja_id', 'status', 'jumlah_label', 'jumlah_surat', 'jumlah_surat_dirutekan'];
const BALASAN_COLUMNS = ['surat_masuk_id', 'nomor_masuk', 'unit_masuk', 'surat_keluar_id', 'nomor_keluar', 'unit_keluar', 'approval_status', 'tindakan'];
const CALON_PENGOLAH_COLUMNS = ['surat_masuk_id', 'nomor_surat', 'calon_unit_pengolah'];

export function writePlanFiles(outDir, plan) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'pemetaan-label.csv'), toCsv(plan.pemetaan, PEMETAAN_COLUMNS));
  writeFileSync(join(outDir, 'balasan-ditinjau.csv'), toCsv(plan.balasan, BALASAN_COLUMNS));
  writeFileSync(join(outDir, 'calon-pengolah.csv'), toCsv(plan.calonPengolah, CALON_PENGOLAH_COLUMNS));
  writeFileSync(join(outDir, 'ringkasan.json'),
    `${JSON.stringify({ sha256: plan.sha256, batasDataLama: plan.batasDataLama, total: plan.total }, null, 2)}\n`);
}
