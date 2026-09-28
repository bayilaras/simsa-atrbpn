#!/usr/bin/env node
// backend/scripts/backfill-rangkaian-lama.mjs
// Backfill langkah 2 (spec §3): label bebas surat_masuk.disposisi DATA LAMA →
// peserta rangkaian data lama. Default dry-run (tanpa tulis). --apply hanya
// menerapkan rencana yang SHA-256-nya sama dengan laporan yang sudah disign-off.
//
// Bagian Task 3: konstanta, pemetaan label (D6), normalisasi, validasi pemetaan,
// dan batas data lama. Bagian Task 4: rencana/dry-run (buildPlan), CSV, dan hash
// SHA-256 rencana. Bagian Task 5: --apply bergerbang SHA (applyPlan), mode
// --isi-pengolah (isiPengolahPlan, P5-C-2), parseArgs, dan main().

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

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
 * [Task 5] Peserta `disposisi_lama` untuk (rangkaian, unit) dianggap SUDAH ADA bila pernah ada baris
 * (termasuk yang sudah dicabut lewat `berakhir_at`) di rangkaian itu ATAU di rangkaian mana pun yang
 * (berantai) digabung ke rangkaian itu. P1 `gabung` hanya memindahkan peserta yang masih aktif;
 * tanpa garis gabung, peserta yang dicabut di rangkaian sumber akan dibuat ulang di rangkaian tujuan.
 * `rangkaianExpr`/`unitExpr` adalah ekspresi SQL konstanta kode (kolom atau `$n`), bukan nilai pengguna.
 */
export function pesertaPernahAdaSql(rangkaianExpr, unitExpr) {
  return `EXISTS (
    WITH RECURSIVE garis(id) AS (
      SELECT ${rangkaianExpr}
      UNION
      SELECT rs_g.id FROM rangkaian_surat rs_g JOIN garis g ON rs_g.digabung_ke_id = g.id
    )
    SELECT 1 FROM rangkaian_peserta rp_g
      JOIN garis g ON g.id = rp_g.rangkaian_id
     WHERE rp_g.unit_kerja_id = ${unitExpr} AND rp_g.peran = 'disposisi_lama')`;
}

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
         ${pesertaPernahAdaSql('t.rangkaian_id', 'r.unit_kerja_id')} AS sudah_peserta
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
 * [P5-T4-1, P5-C-2] Calon unit pengolah (spec §3 langkah 5, plan applySurat plan:1596; aturan
 * mengikat: Task 5 amandemen butir 1, dirujuk Task 4 amandemen 1): satu baris per rangkaian BARU
 * (SM tanpa rangkaian_anggota) yang rutenya berisi tepat satu unit ber-`unit_type = 'direktorat'`.
 * Unit non-direktorat (mis. sesditjen) tidak dihitung sebagai kandidat dan tidak mengganggu hitungan
 * "tepat satu". Baris di sini adalah *kandidat*; menuliskannya ke `unit_pengolah_id` adalah mode
 * terpisah, SHA-bound, yang diputuskan pada gerbang rilis (a) — lihat amandemen C-2. Tidak
 * dieksekusi oleh Task 4.
 */
const CALON_PENGOLAH_SQL = `WITH ${BASE_CTE},
rute_direktorat AS (
  SELECT r.surat_masuk_id, r.unit_kerja_id
    FROM rute r
    JOIN unit_kerja uk ON uk.id = r.unit_kerja_id
   WHERE uk.unit_type = 'direktorat'
),
calon_count AS (
  SELECT surat_masuk_id, count(DISTINCT unit_kerja_id) AS n, min(unit_kerja_id) AS unit_kerja_id
    FROM rute_direktorat
   GROUP BY surat_masuk_id
)
SELECT cc.surat_masuk_id, sm.nomor_surat, cc.unit_kerja_id AS calon_unit_pengolah
  FROM calon_count cc
  JOIN surat_masuk sm ON sm.id = cc.surat_masuk_id
  LEFT JOIN rangkaian_anggota ra ON ra.surat_masuk_id = cc.surat_masuk_id
 WHERE cc.n = 1 AND ra.surat_masuk_id IS NULL
 ORDER BY cc.surat_masuk_id`;

/**
 * [P5-C-2] Mode --isi-pengolah (run terpisah SETELAH --apply dan keputusan gerbang rilis (a) "isi"):
 * kriteria calon sama (tepat satu unit direktorat pada rute), tetapi untuk rangkaian data lama yang
 * SUDAH dibuat backfill dan masih `selesai` tanpa pengolah. Rangkaian diberkaskan, digabung, atau
 * yang sudah berpengolah tidak ikut.
 */
const CALON_PENGOLAH_ISI_SQL = `WITH ${BASE_CTE},
rute_direktorat AS (
  SELECT r.surat_masuk_id, r.unit_kerja_id
    FROM rute r
    JOIN unit_kerja uk ON uk.id = r.unit_kerja_id
   WHERE uk.unit_type = 'direktorat'
),
calon_count AS (
  SELECT surat_masuk_id, count(DISTINCT unit_kerja_id) AS n, min(unit_kerja_id) AS unit_kerja_id
    FROM rute_direktorat
   GROUP BY surat_masuk_id
)
SELECT cc.surat_masuk_id, sm.nomor_surat, cc.unit_kerja_id AS calon_unit_pengolah, rs.id AS rangkaian_id
  FROM calon_count cc
  JOIN surat_masuk sm ON sm.id = cc.surat_masuk_id
  JOIN rangkaian_anggota ra ON ra.surat_masuk_id = cc.surat_masuk_id AND ra.peran = 'induk' AND ra.sumber = 'data_lama'
  JOIN rangkaian_surat rs ON rs.id = ra.rangkaian_id
 WHERE cc.n = 1 AND rs.asal = 'data_lama' AND rs.status = 'selesai' AND rs.unit_pengolah_id IS NULL
 ORDER BY rs.id`;

/**
 * Rencana lengkap tanpa efek samping; SHA-256 menutup `batasDataLama`, pemetaan, balasan,
 * calonPengolah, dan total, sehingga penanda tangan gerbang rilis mengunci semuanya sekaligus.
 * `batas` WAJIB — pemanggil (CLI) menentukannya lewat `tentukanBatasDataLama` terlebih dahulu.
 */
export async function buildPlan(client, { batas, isiPengolah = false } = {}) {
  if (!batas) throw new Error('buildPlan membutuhkan { batas } (lihat tentukanBatasDataLama)');
  await assertPemetaanSah(client);
  const batasDataLama = batas;
  const params = [...seedParams(), batasDataLama];
  const pemetaan = (await client.query(PEMETAAN_SQL, params)).rows;
  const balasan = (await client.query(BALASAN_SQL, params)).rows;
  const calonPengolah = (await client.query(isiPengolah ? CALON_PENGOLAH_ISI_SQL : CALON_PENGOLAH_SQL, params)).rows;
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
  // [P5-C-2] Mode isi-pengolah ikut di-hash: SHA rencana biasa tidak pernah membuka mode ini.
  const payload = { batasDataLama, pemetaan, balasan, calonPengolah, total };
  if (isiPengolah) {
    total.pengolah_akan_diisi = calonPengolah.length;
    payload.mode = MODE_ISI_PENGOLAH;
  }
  const sha256 = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return { pemetaan, balasan, calonPengolah, total, batasDataLama, sha256, ...(isiPengolah ? { mode: MODE_ISI_PENGOLAH } : {}) };
}

const MODE_ISI_PENGOLAH = 'isi-pengolah';

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
    `${JSON.stringify({ sha256: plan.sha256, batasDataLama: plan.batasDataLama, ...(plan.mode ? { mode: plan.mode } : {}), total: plan.total }, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Task 5: --apply bergerbang SHA, idempoten, diaudit; mode --isi-pengolah (P5-C-2).
//
// Urutan kunci (G-LOCK, P5-G-4) per TRANSAKSI batch, per fase (kunciBatch): semua surat_keluar
// balasan (FOR UPDATE ORDER BY id) -> semua surat_masuk (ORDER BY id) -> semua rangkaian_surat
// (ORDER BY id). Skrip tidak pernah menulis surat_distributions. Id dibaca tanpa kunci, dikunci,
// lalu dibaca ulang. Satu batch = satu transaksi, diulang maksimal 3x untuk 40P01/40001; penghitung ringkasan hanya
// dijumlahkan setelah COMMIT.
// ---------------------------------------------------------------------------

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const KODE_ULANG = new Set(['40P01', '40001']);
const SHA_POLA = /^[a-f0-9]{64}$/;

const BATCH_SQL = `WITH ${BASE_CTE},
batch AS (
  SELECT DISTINCT surat_masuk_id FROM rute
   WHERE surat_masuk_id > $${SEED_PARAM_COUNT + 2}::uuid
   ORDER BY 1 LIMIT ${BATCH_SIZE}
)
SELECT r.surat_masuk_id, r.pemilik, r.unit_kerja_id, r.label_asal, uk.unit_type
  FROM rute r
  JOIN batch b ON b.surat_masuk_id = r.surat_masuk_id
  JOIN unit_kerja uk ON uk.id = r.unit_kerja_id
 ORDER BY r.surat_masuk_id, r.unit_kerja_id`;

async function inTransaction(client, work, percobaan = 3) {
  for (let ke = 1; ; ke += 1) {
    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('simsa:backfill-rangkaian-lama', 0))");
      const result = await work();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (ke < percobaan && KODE_ULANG.has(error?.code)) continue;
      throw error;
    }
  }
}

/** Rencana dibaca dalam satu snapshot agar pemetaan, balasan, dan total konsisten satu sama lain. */
async function dalamSnapshot(client, work) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function audit(client, action, entityType, entityId, changes) {
  await client.query(
    `INSERT INTO audit_log (user_email, action, entity_type, entity_id, changes)
     VALUES ($1::varchar, $2::varchar, $3::varchar, $4::uuid, $5::jsonb)`,
    [ACTOR, action, entityType, entityId, JSON.stringify(changes)]);
}

async function seedLabelTable(client) {
  const { rows } = await client.query(
    `INSERT INTO disposisi_label_unit (label_norm, unit_kerja_id, perlu_verifikasi, catatan)
     SELECT label_norm, unit_kerja_id, false, catatan FROM (VALUES ${seedValues}) AS seed(label_norm, unit_kerja_id, catatan)
     ON CONFLICT (label_norm) DO UPDATE
       SET unit_kerja_id = EXCLUDED.unit_kerja_id, perlu_verifikasi = EXCLUDED.perlu_verifikasi, catatan = EXCLUDED.catatan
     WHERE (disposisi_label_unit.unit_kerja_id, disposisi_label_unit.perlu_verifikasi, disposisi_label_unit.catatan)
           IS DISTINCT FROM (EXCLUDED.unit_kerja_id, EXCLUDED.perlu_verifikasi, EXCLUDED.catatan)
     RETURNING label_norm, unit_kerja_id`, seedParams());
  for (const row of rows) {
    await audit(client, 'update', 'disposisi_label_unit', null, { labelNorm: row.label_norm, unitKerjaId: row.unit_kerja_id });
  }
}

const galatUlang = (pesan) => Object.assign(new Error(pesan), { code: '40001' });

/**
 * G-LOCK per transaksi batch (P5-G-4, spec:809). Kunci diambil per FASE untuk seluruh batch,
 * bukan per surat, sehingga transaksi tidak pernah memegang SM/R suatu surat lalu meminta SK
 * surat berikutnya (siklus dengan P3 tautanKeSurat: SK ORDER BY id -> SM -> R):
 *   1. semua calon balasan surat_keluar batch, satu FOR UPDATE ORDER BY id;
 *   2. semua surat_masuk batch, satu FOR UPDATE ORDER BY id;
 *   3. keanggotaan dibaca tanpa kunci, semua rangkaian_surat yang ada dikunci ORDER BY id,
 *      lalu keanggotaan dibaca ulang; bila berubah -> galat 40001 (batch diulang).
 * Setelah itu applySurat hanya menulis; ia tidak mengambil kunci baris sendiri.
 */
async function kunciBatch(client, suratIds) {
  const { rows: calonBalasan } = await client.query(
    `SELECT sk.id FROM surat_keluar sk
      WHERE sk.balasan_untuk = ANY($1::uuid[]) AND sk.is_deleted IS NOT TRUE AND sk.approval_status = 'approved'
      ORDER BY sk.id`, [suratIds]);
  const skTerkunci = calonBalasan.length === 0 ? [] : (await client.query(
    'SELECT id FROM surat_keluar WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [calonBalasan.map(row => row.id)])).rows.map(row => row.id);

  const idUrut = [...suratIds].sort();
  const { rows: smRows } = await client.query(
    `SELECT id, unit_kerja_id, tahun,
            COALESCE(NULLIF(regexp_replace(perihal, '${LABEL_NORM_TRIM_PATTERN}', '', 'g'), ''), nomor_surat, '(tanpa perihal)') AS judul
       FROM surat_masuk WHERE id = ANY($1::uuid[]) AND is_deleted IS NOT TRUE ORDER BY id FOR UPDATE`, [idUrut]);
  const suratMasuk = new Map(smRows.map(row => [row.id, row]));

  const terkunciSm = smRows.map(row => row.id);
  const keanggotaan = async () => new Map((await client.query(
    `SELECT id AS anggota_id, rangkaian_id, surat_masuk_id FROM rangkaian_anggota
      WHERE surat_masuk_id = ANY($1::uuid[])`, [terkunciSm])).rows.map(row => [row.surat_masuk_id, row]));
  const awal = await keanggotaan();
  const rangkaianIds = [...new Set([...awal.values()].map(row => row.rangkaian_id))].sort();
  const rangkaian = new Map(rangkaianIds.length === 0 ? [] : (await client.query(
    'SELECT id, status FROM rangkaian_surat WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [rangkaianIds])).rows.map(row => [row.id, row]));
  const lagi = await keanggotaan();
  // Surat sudah terkunci, jadi keanggotaannya tidak dapat dipindah; bila tetap berubah, ulang batch.
  const induk = new Map();
  for (const suratId of new Set([...awal.keys(), ...lagi.keys()])) {
    const a = awal.get(suratId);
    const rs = a && rangkaian.get(a.rangkaian_id);
    if (!a || !rs || lagi.get(suratId)?.rangkaian_id !== a.rangkaian_id) {
      throw galatUlang(`Keanggotaan surat ${suratId} berubah; batch diulang`);
    }
    induk.set(suratId, { anggota_id: a.anggota_id, rangkaian_id: rs.id, status: rs.status });
  }
  return { suratMasuk, induk, skTerkunci };
}

async function applySurat(client, suratId, routes, hitung, terkunci) {
  // Semua kunci sudah diambil oleh kunciBatch (G-LOCK per transaksi); di sini hanya baca + tulis.
  const sm = terkunci.suratMasuk.get(suratId);
  if (!sm) return;
  hitung.suratDiproses += 1;

  let induk = terkunci.induk.get(suratId) ?? null;
  if (!induk) {
    const direktorat = [...new Set(routes.filter(route => route.unit_type === 'direktorat').map(route => route.unit_kerja_id))];
    const calonPengolah = direktorat.length === 1 ? direktorat[0] : null;
    const { rows: [rangkaian] } = await client.query(
      `INSERT INTO rangkaian_surat (kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun, selesai_at, selesai_manual)
       VALUES ('RS-' || $1::int || '-' || lpad(nextval('rangkaian_surat_kode_seq')::text, 6, '0'),
               'data_lama', 'selesai', $2::varchar, NULL, $3::text, $1::int, now(), false)
       RETURNING id, kode`, [sm.tahun, sm.unit_kerja_id, sm.judul]);
    const { rows: [anggota] } = await client.query(
      `INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
       VALUES ($1::uuid, $2::uuid, $3::varchar, 'induk', 'data_lama') RETURNING id`,
      [rangkaian.id, suratId, sm.unit_kerja_id]);
    await audit(client, 'create', 'rangkaian_surat', rangkaian.id, {
      kode: rangkaian.kode, asal: 'data_lama', status: 'selesai', suratMasukId: suratId,
      unitPengolahId: null, calonUnitPengolah: calonPengolah, // spec:356: pengolah memberi jangkauan tanpa flag; ditunda sampai sign-off (gerbang rilis P5)
    });
    induk = { anggota_id: anggota.id, rangkaian_id: rangkaian.id, status: 'selesai' };
    hitung.rangkaianBaru += 1;
  }
  // Hanya rangkaian terbuka yang menerima peserta/anggota; diberkaskan terminal (RB P1 butir 9). [P5-T5-3]
  const tertutup = induk.status !== 'aktif' && induk.status !== 'selesai';

  for (const route of routes) {
    // Semua baris, termasuk yang berakhir dan yang tertinggal di rangkaian sumber gabung:
    // peserta yang dicabut tidak dihidupkan lagi.
    const { rows: [{ ada }] } = await client.query(
      `SELECT ${pesertaPernahAdaSql('$1::uuid', '$2::varchar')} AS ada`, [induk.rangkaian_id, route.unit_kerja_id]);
    if (ada) continue;
    if (tertutup) { hitung.pesertaDilewatiDiberkaskan += 1; continue; }
    const { rows: inserted } = await client.query(
      `INSERT INTO rangkaian_peserta (rangkaian_id, unit_kerja_id, peran, label_asal)
       SELECT $1::uuid, $2::varchar, 'disposisi_lama', $3::text
        WHERE NOT ${pesertaPernahAdaSql('$1::uuid', '$2::varchar')}
       RETURNING id`, [induk.rangkaian_id, route.unit_kerja_id, route.label_asal]);
    if (inserted.length > 0) {
      await audit(client, 'update', 'rangkaian_surat', induk.rangkaian_id, {
        pesertaDisposisiLama: route.unit_kerja_id, labelAsal: route.label_asal, memberiAksesSaatFlagMati: false,
      });
      hitung.pesertaBaru += 1;
    }
  }

  const { rows: balasan } = await client.query(
    `SELECT sk.id, sk.unit_kerja_id FROM surat_keluar sk
      WHERE sk.balasan_untuk = $1::uuid AND sk.unit_kerja_id = $2::varchar
        AND sk.is_deleted IS NOT TRUE AND sk.approval_status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM rangkaian_anggota ra WHERE ra.surat_keluar_id = sk.id)
        AND sk.id = ANY($3::uuid[]) -- hanya SK yang dikunci kunciBatch; sisanya ditaut run berikutnya
      ORDER BY sk.id`, [suratId, sm.unit_kerja_id, terkunci.skTerkunci]);
  for (const sk of balasan) {
    if (tertutup) { hitung.balasanDilewatiDiberkaskan += 1; continue; }
    const { rows: [anggota] } = await client.query(
      `INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, peran, sumber)
       VALUES ($1::uuid, $2::uuid, $3::varchar, 'anggota', 'data_lama') RETURNING id`,
      [induk.rangkaian_id, sk.id, sk.unit_kerja_id]);
    const { rows: [relasi] } = await client.query(
      `INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi, keterangan)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'balasan', 'Data lama: balasan_untuk') RETURNING id`,
      [induk.rangkaian_id, anggota.id, induk.anggota_id]);
    await audit(client, 'create', 'rangkaian_relasi', relasi.id, {
      rangkaianId: induk.rangkaian_id, suratKeluarId: sk.id, suratMasukId: suratId, jenisRelasi: 'balasan', sumber: 'data_lama',
    });
    hitung.balasanDitautkan += 1;
  }
}

function periksaSha(approvedSha256) {
  if (!SHA_POLA.test(approvedSha256 ?? '')) {
    throw new Error('--apply membutuhkan --approved-sha256=<sha256 dari ringkasan.json dry-run yang sudah disetujui>');
  }
}

async function rencanaDisetujui(client, { approvedSha256, batas, isiPengolah }) {
  const plan = await dalamSnapshot(client, () => buildPlan(client, { batas, isiPengolah }));
  if (plan.sha256 !== approvedSha256) {
    throw new Error(`Rencana berubah sejak sign-off (sha256 kini ${plan.sha256}); jalankan dry-run ulang dan minta sign-off baru`);
  }
  return plan;
}

const summaryKosong = () => ({
  suratDiproses: 0, rangkaianBaru: 0, pesertaBaru: 0, balasanDitautkan: 0,
  balasanDilewatiDiberkaskan: 0, pesertaDilewatiDiberkaskan: 0,
});

export async function applyPlan(client, { approvedSha256, batas } = {}) {
  periksaSha(approvedSha256);
  if (!batas) throw new Error('applyPlan membutuhkan { batas } (lihat tentukanBatasDataLama)');
  const { rows: [pending] } = await client.query('SELECT count(*)::int AS n FROM surat_distributions WHERE rangkaian_id IS NULL');
  if (pending.n !== 0) throw new Error(`Backfill langkah 1 belum tuntas: ${pending.n} baris surat_distributions tanpa rangkaian_id`);
  await rencanaDisetujui(client, { approvedSha256, batas, isiPengolah: false });

  const summary = summaryKosong();
  await inTransaction(client, () => seedLabelTable(client));
  let after = ZERO_UUID;
  for (;;) {
    const { rows } = await client.query(BATCH_SQL, [...seedParams(), batas, after]);
    if (rows.length === 0) break;
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.surat_masuk_id)) grouped.set(row.surat_masuk_id, []);
      grouped.get(row.surat_masuk_id).push(row);
    }
    const hitung = await inTransaction(client, async () => {
      const lokal = summaryKosong();
      const terkunci = await kunciBatch(client, [...grouped.keys()]);
      for (const [suratId, routes] of grouped) await applySurat(client, suratId, routes, lokal, terkunci);
      return lokal;
    });
    for (const key of Object.keys(summary)) summary[key] += hitung[key];
    after = [...grouped.keys()].at(-1);
  }
  return summary;
}

/**
 * [P5-C-2] Mode isi-pengolah: menulis `calon_unit_pengolah` dari rencana isi-pengolah yang SHA-nya
 * disetujui, hanya untuk rangkaian yang di bawah kunci masih data_lama + selesai + tanpa pengolah.
 * Akses pengolah TIDAK dikendalikan flag RANGKAIAN_DISPOSISI_LAMA_READ.
 */
export async function isiPengolahPlan(client, { approvedSha256, batas } = {}) {
  periksaSha(approvedSha256);
  if (!batas) throw new Error('isiPengolahPlan membutuhkan { batas } (lihat tentukanBatasDataLama)');
  const plan = await rencanaDisetujui(client, { approvedSha256, batas, isiPengolah: true });
  const summary = { pengolahDiisi: 0, pengolahDilewati: 0 };
  for (let i = 0; i < plan.calonPengolah.length; i += BATCH_SIZE) {
    const potongan = plan.calonPengolah.slice(i, i + BATCH_SIZE);
    const hitung = await inTransaction(client, async () => {
      const lokal = { pengolahDiisi: 0, pengolahDilewati: 0 };
      const { rows } = await client.query(
        `SELECT id, asal, status, unit_pengolah_id FROM rangkaian_surat
          WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [potongan.map(calon => calon.rangkaian_id)]);
      const terkunci = new Map(rows.map(row => [row.id, row]));
      for (const calon of potongan) {
        const rs = terkunci.get(calon.rangkaian_id);
        if (!rs || rs.asal !== 'data_lama' || rs.status !== 'selesai' || rs.unit_pengolah_id !== null) {
          lokal.pengolahDilewati += 1;
          continue;
        }
        await client.query(
          'UPDATE rangkaian_surat SET unit_pengolah_id = $2::varchar, updated_at = now() WHERE id = $1::uuid',
          [rs.id, calon.calon_unit_pengolah]);
        await audit(client, 'update', 'rangkaian_surat', rs.id, {
          before: { unitPengolahId: null }, after: { unitPengolahId: calon.calon_unit_pengolah },
          sumber: 'backfill-rangkaian-lama', aksesBaru: [calon.calon_unit_pengolah], suratMasukId: calon.surat_masuk_id,
        });
        lokal.pengolahDiisi += 1;
      }
      return lokal;
    });
    summary.pengolahDiisi += hitung.pengolahDiisi;
    summary.pengolahDilewati += hitung.pengolahDilewati;
  }
  return summary;
}

export function parseArgs(argv) {
  const options = { apply: false, isiPengolah: false, approvedSha256: null, outDir: null };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--isi-pengolah') options.isiPengolah = true;
    else if (arg.startsWith('--approved-sha256=')) options.approvedSha256 = arg.slice('--approved-sha256='.length).trim().toLowerCase();
    else if (arg.startsWith('--out=')) options.outDir = resolve(arg.slice('--out='.length));
    else throw new Error(`Argumen tidak dikenal: ${arg}`);
  }
  if (options.approvedSha256 !== null && !options.apply) {
    throw new Error('--approved-sha256 hanya bersama --apply');
  }
  return options;
}

/** [P5-C-1] Mode tulis hanya sebagai role runtime; pengecualian eksplisit untuk dev lokal. */
export function pastikanRoleRuntime(identitas, { apply, env = process.env }) {
  if (apply && identitas?.db_user !== 'simsa_api' && env.ALLOW_NON_RUNTIME_ROLE !== '1') {
    throw new Error(`Mode tulis harus dijalankan sebagai role runtime simsa_api (kini ${identitas?.db_user}); `
      + 'set ALLOW_NON_RUNTIME_ROLE=1 hanya untuk database lokal');
  }
}

// Dijalankan sebagai role runtime `simsa_api`: DATABASE_URL diisi dari NEON_RUNTIME_DATABASE_URL lewat prompt
// tersembunyi (docs/RUNBOOK_INTEGRASI_SURAT_P1.md). Jangan memakai simsa_maintenance/simsa_operator: tanpa grant
// rangkaian_*, dan menambah grant mengubah hash grants/0002 serta pin Neon (RB P1 butir 5, P3 T2-3).
async function main() {
  // [F3] pola P3: nilai diambil dari shell saja; skrip ini tidak memuat backend/.env sama sekali. [P5-C-1]
  const urlShell = process.env.DATABASE_URL?.trim();
  const batasShell = process.env.RANGKAIAN_DATA_LAMA_SEBELUM;
  if (!urlShell) {
    throw new Error('DATABASE_URL harus diset eksplisit di shell (NEON_RUNTIME_DATABASE_URL, role simsa_api); skrip ini tidak memakai backend/.env');
  }
  const options = parseArgs(process.argv.slice(2));
  const client = new pg.Client({ connectionString: urlShell, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const { rows: [identitas] } = await client.query('SELECT current_user AS db_user, current_database() AS db_name');
    const { batasDataLama, sumberBatas } = await tentukanBatasDataLama(client, { apply: options.apply, batasShell });
    console.log(JSON.stringify({
      dbUser: identitas.db_user, dbName: identitas.db_name, batasDataLama, sumberBatas,
      mode: options.isiPengolah ? MODE_ISI_PENGOLAH : 'backfill', apply: options.apply,
    }));
    pastikanRoleRuntime(identitas, { apply: options.apply });
    const outDir = options.outDir ?? mkdtempSync(join(tmpdir(), 'laporan-rangkaian-lama-'));
    const plan = await dalamSnapshot(client, () => buildPlan(client, { batas: batasDataLama, isiPengolah: options.isiPengolah }));
    writePlanFiles(outDir, plan);
    console.log(`Dry-run selesai. Laporan: ${outDir}`);
    console.log(`Total: ${JSON.stringify(plan.total)}`);
    console.log(`SHA-256 rencana (untuk sign-off): ${plan.sha256}`);
    if (options.apply && options.isiPengolah) {
      const summary = await isiPengolahPlan(client, { approvedSha256: options.approvedSha256, batas: batasDataLama });
      console.log(`Isi pengolah selesai: ${JSON.stringify(summary)}`);
      console.log('Akses unit pengolah TIDAK dikendalikan flag RANGKAIAN_DISPOSISI_LAMA_READ.');
    } else if (options.apply) {
      const summary = await applyPlan(client, { approvedSha256: options.approvedSha256, batas: batasDataLama });
      console.log(`Apply selesai: ${JSON.stringify(summary)}`);
      console.log('Peserta data lama BELUM memberi akses sampai RANGKAIAN_DISPOSISI_LAMA_READ=true disetujui.');
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Backfill rangkaian lama gagal${error.code ? ` [${error.code}]` : ''}: ${error.message}`);
    process.exitCode = 1;
  });
}
