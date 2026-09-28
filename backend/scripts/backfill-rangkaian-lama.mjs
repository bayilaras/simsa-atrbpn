#!/usr/bin/env node
// backend/scripts/backfill-rangkaian-lama.mjs
// Backfill langkah 2 (spec §3): label bebas surat_masuk.disposisi DATA LAMA →
// peserta rangkaian data lama. Default dry-run (tanpa tulis). --apply hanya
// menerapkan rencana yang SHA-256-nya sama dengan laporan yang sudah disign-off.
//
// Bagian ini (Task 3): konstanta, pemetaan label (D6), normalisasi, validasi
// pemetaan, dan batas data lama. Rencana/dry-run (Task 4) dan --apply (Task 5)
// menyusul di berkas yang sama.

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
