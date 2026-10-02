#!/usr/bin/env node
// Pre-flight produksi P0 Integrasi Surat. HANYA BACA: semua pemeriksaan berjalan
// dalam satu transaksi READ ONLY yang selalu di-ROLLBACK. Jangan menambah
// pemeriksaan yang menulis; assertReadOnlySql menolaknya sebelum koneksi dipakai.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Client } from 'pg';

export const PREFLIGHT_TRANSACTION = 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
const MAX_ROWS_PER_CHECK = 500;

// Harus sama dengan BIASA_SIFAT_ALIASES dan JS_WHITESPACE_CODEPOINTS di
// src/services/access/visibility-spec.ts. Paritas dijaga oleh
// src/__tests__/preflight-integrasi-surat.test.ts (sifat_surat_kelas).
const BIASA_LIST = `'biasa', 'biasa/terbuka', 'terbuka', 'segera', 'sangat_segera', 'undangan', 'penting'`;
const JS_WHITESPACE_CODEPOINTS = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];
const WS = JS_WHITESPACE_CODEPOINTS.map(cp => `\\u${cp.toString(16).padStart(4, '0')}`).join('');

function kelasLamaSql(column) {
  return `CASE WHEN lower(coalesce(${column}, 'biasa')) IN (${BIASA_LIST}) THEN 'biasa' `
    + `ELSE replace(replace(lower(coalesce(${column}, 'biasa')), ' ', '_'), '-', '_') END`;
}

function kelasBaruSql(column) {
  const base = `regexp_replace(lower(regexp_replace(coalesce(nullif(${column}, ''), 'biasa'), `
    + `'^[${WS}]+|[${WS}]+$', '', 'g')), '[${WS}-]+', '_', 'g')`;
  return `CASE WHEN ${base} IN (${BIASA_LIST}) THEN 'biasa' ELSE ${base} END`;
}

export const PREFLIGHT_CHECKS = [
  {
    id: 'status_migrasi',
    judul: 'Rantai migrasi yang sudah diterapkan',
    keputusan: 'Harus jumlah_migrasi = 46 (0000-0045) dan migrasi_terakhir_when = 1789397416667. Selain itu: HENTIKAN, samakan migrasi dulu.',
    sql: `SELECT count(*)::int AS jumlah_migrasi, max(created_at)::text AS migrasi_terakhir_when
FROM drizzle.__drizzle_migrations`,
  },
  {
    id: 'unit_kerja_semua',
    judul: 'Seluruh baris unit_kerja',
    keputusan: 'Arsipkan sebagai bukti. Cocokkan nama resmi; koreksi nama lewat PUT /api/settings/unit-kerja/:id (super_admin).',
    sql: `SELECT id, name, parent_id, unit_type, can_receive_distribution
FROM unit_kerja
ORDER BY id`,
  },
  {
    id: 'unit_kerja_direktorat',
    judul: 'Keberadaan unit ditjen, sesditjen, dan dir_*',
    keputusan: 'Unit dengan ada=false akan dibuat oleh 0047 (P1). parent_id/unit_type yang sudah terisi tidak ditimpa.',
    sql: `SELECT expected.id AS unit_id, (u.id IS NOT NULL) AS ada, u.parent_id, u.unit_type, u.can_receive_distribution
FROM (VALUES ('ditjen'), ('sesditjen'), ('dir_bppt'), ('dir_ptep'), ('dir_ktpp'), ('dir_plp')) AS expected(id)
LEFT JOIN unit_kerja u ON u.id = expected.id
ORDER BY expected.id`,
  },
  {
    id: 'unit_kerja_id_direktorat_dash',
    judul: 'Unit ber-id direktorat-* (0047 fail-closed)',
    keputusan: 'Harus 0 baris. Bila ada, 0047 akan RAISE: putuskan pemetaan bersama pemilik data sebelum P1 (tidak ada rename otomatis).',
    sql: `SELECT id, name
FROM unit_kerja
WHERE id ~ '^direktorat-'
ORDER BY id`,
  },
  {
    id: 'pengguna_per_role_unit',
    judul: 'Jumlah pengguna per role dan unit',
    keputusan: 'Identifikasi calon pengawas (admin_unit di sesditjen/ditjen, admin_dirjen, admin_sesditjen). staff/auditor tidak mendapat jangkauan lintas unit (D5).',
    sql: `SELECT role, coalesce(unit_kerja_id, '(NULL)') AS unit_kerja_id, count(*)::int AS jumlah
FROM users
GROUP BY role, unit_kerja_id
ORDER BY role, unit_kerja_id`,
  },
  {
    id: 'distribusi_per_status',
    judul: 'Jumlah surat_distributions per status',
    keputusan: 'Arsipkan sebagai bukti baseline.',
    sql: `SELECT status, count(*)::int AS jumlah
FROM surat_distributions
GROUP BY status
ORDER BY status`,
  },
  {
    id: 'distribusi_status_tak_dikenal',
    judul: 'Distribusi dengan status di luar sent/received/processed/rejected',
    keputusan: 'Harus 0 baris; bila ada, precheck 0046 akan RAISE. Rekonsiliasi lewat aplikasi (terima/proses/tolak) sebelum P1.',
    sql: `SELECT id, surat_masuk_id, target_unit_id, status
FROM surat_distributions
WHERE status IS NULL OR status NOT IN ('sent', 'received', 'processed', 'rejected')
ORDER BY sent_at, id`,
  },
  {
    id: 'distribusi_aktif_ganda',
    judul: 'Distribusi non-rejected ganda per (surat_masuk_id, target_unit_id)',
    keputusan: 'Harus 0 baris; bila ada, precheck 0046 dan index unik aktif akan gagal. Rekonsiliasi: target menolak baris yang lebih baru dengan alasan.',
    sql: `SELECT surat_masuk_id, target_unit_id, count(*)::int AS jumlah,
       array_agg(id::text ORDER BY sent_at, id) AS distribusi_ids,
       array_agg(status ORDER BY sent_at, id) AS statuses
FROM surat_distributions
WHERE status <> 'rejected'
GROUP BY surat_masuk_id, target_unit_id
HAVING count(*) > 1
ORDER BY jumlah DESC, surat_masuk_id, target_unit_id`,
  },
  {
    id: 'distribusi_target_sama_dengan_sumber',
    judul: 'Distribusi dengan target = sumber',
    keputusan: 'Catat jumlahnya. P3 menolak baris baru seperti ini; baris lama tetap ikut backfill langkah 1.',
    sql: `SELECT count(*)::int AS jumlah
FROM surat_distributions
WHERE target_unit_id = source_unit_id`,
  },
  {
    id: 'index_dan_objek_bentrok',
    judul: 'Objek yang akan dibuat 0046 (index, constraint, tabel, sequence, trigger)',
    keputusan: 'idx_surat_keluar_balasan boleh true atau false (0046 memakai IF NOT EXISTS). Semua objek lain, termasuk kedua trigger, harus false; bila true, 0046 akan gagal (trigger dibuat tanpa IF NOT EXISTS/OR REPLACE).',
    sql: `SELECT o.nama, o.jenis,
       CASE o.jenis
         WHEN 'index' THEN EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = o.nama)
         WHEN 'constraint' THEN EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = o.nama)
         WHEN 'trigger' THEN EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = o.nama AND NOT t.tgisinternal)
         ELSE to_regclass('public.' || o.nama) IS NOT NULL
       END AS sudah_ada
FROM (VALUES
  ('idx_surat_keluar_balasan', 'index'),
  ('surat_masuk_nomor_norm_idx', 'index'),
  ('surat_keluar_nomor_norm_idx', 'index'),
  ('surat_distributions_active_target_uidx', 'index'),
  ('surat_distributions_target_status_idx', 'index'),
  ('surat_distributions_rangkaian_idx', 'index'),
  ('surat_distributions_status_check', 'constraint'),
  ('surat_keluar_asal_naskah_check', 'constraint'),
  ('rangkaian_surat', 'relation'),
  ('rangkaian_anggota', 'relation'),
  ('rangkaian_relasi', 'relation'),
  ('rangkaian_peserta', 'relation'),
  ('rangkaian_koreksi_berkas', 'relation'),
  ('disposisi_label_unit', 'relation'),
  ('rangkaian_surat_kode_seq', 'relation'),
  ('unit_kerja_default_pengawas', 'trigger'),
  ('surat_distributions_closed_guard', 'trigger')
) AS o(nama, jenis)
ORDER BY o.jenis, o.nama`,
  },
  {
    id: 'kolom_bentrok',
    judul: 'Kolom yang akan ditambahkan 0046',
    keputusan: 'Harus 0 baris.',
    sql: `SELECT c.table_name::text AS table_name, c.column_name::text AS column_name
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND (c.table_name::text, c.column_name::text) IN (
    ('unit_kerja', 'is_unit_pengawas'), ('surat_keluar', 'asal_naskah'),
    ('surat_distributions', 'rangkaian_id'), ('surat_distributions', 'batas_waktu'),
    ('surat_distributions', 'penanggung_jawab'), ('surat_distributions', 'processed_by'),
    ('surat_distributions', 'penyelesaian_surat_keluar_id'), ('surat_distributions', 'catatan_penyelesaian'),
    ('surat_distributions', 'ditutup_pengawas'))
ORDER BY 1, 2`,
  },
  {
    id: 'index_manual_surat',
    judul: 'Seluruh index pada tabel surat dan unit_kerja',
    keputusan: 'Arsipkan. Index yang tidak berasal dari rantai migrasi (mis. dari add_soft_delete_and_indexes.sql) dicatat sebagai index manual.',
    sql: `SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN ('surat_masuk', 'surat_keluar', 'surat_distributions', 'unit_kerja')
ORDER BY tablename, indexname`,
  },
  {
    id: 'ekstensi',
    judul: 'Ketersediaan dan instalasi pg_trgm / pgcrypto',
    keputusan: 'pg_trgm tidak memblokir P0-P4. Bila installed_version NULL, fase opsional P5 memerlukan langkah privileged satu kali.',
    sql: `SELECT e.name, e.default_version, e.installed_version
FROM pg_available_extensions e
WHERE e.name IN ('pg_trgm', 'pgcrypto')
ORDER BY e.name`,
  },
  {
    id: 'data_lama_ringkasan',
    judul: 'Ringkasan surat_masuk (indikasi data lama)',
    keputusan: 'Menjawab pertanyaan terbuka #2: bila ada sekitar 2.047 surat lama (created_by NULL, berlabel disposisi), backfill langkah 2 (P5) diperlukan.',
    sql: `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE is_deleted IS NOT TRUE)::int AS hidup,
       count(*) FILTER (WHERE created_by IS NULL)::int AS tanpa_pembuat,
       count(*) FILTER (WHERE coalesce(cardinality(disposisi), 0) > 0)::int AS berlabel_disposisi,
       count(*) FILTER (WHERE nullif(trim(perihal), '') IS NULL)::int AS perihal_kosong,
       min(tanggal_surat)::text AS tanggal_surat_min, max(tanggal_surat)::text AS tanggal_surat_max,
       min(created_at)::text AS dibuat_min, max(created_at)::text AS dibuat_max
FROM surat_masuk`,
  },
  {
    id: 'data_lama_per_unit_tahun',
    judul: 'surat_masuk per unit dan tahun',
    keputusan: 'Arsipkan sebagai baseline volume untuk P4 (target p95 Lacak) dan P5.',
    sql: `SELECT unit_kerja_id, tahun, count(*)::int AS jumlah,
       count(*) FILTER (WHERE created_by IS NULL)::int AS tanpa_pembuat
FROM surat_masuk
GROUP BY unit_kerja_id, tahun
ORDER BY unit_kerja_id, tahun`,
  },
  {
    id: 'label_disposisi',
    judul: 'Label disposisi bebas (normalisasi langkah 2)',
    keputusan: 'Masukan seed disposisi_label_unit (P5). Label kosong dicatat dan diabaikan.',
    sql: `SELECT lower(regexp_replace(trim(d.label), '\\s+', ' ', 'g')) AS label_norm, count(*)::int AS jumlah
FROM surat_masuk
CROSS JOIN LATERAL unnest(disposisi) AS d(label)
GROUP BY 1
ORDER BY jumlah DESC, label_norm`,
  },
  {
    id: 'balasan_lintas_unit',
    judul: 'balasan_untuk same-unit vs lintas unit',
    keputusan: 'Baris lintas unit tidak dimasukkan backfill langkah 2 dan ditinjau TU.',
    sql: `SELECT count(*) FILTER (WHERE sk.unit_kerja_id = sm.unit_kerja_id)::int AS balasan_same_unit,
       count(*) FILTER (WHERE sk.unit_kerja_id <> sm.unit_kerja_id)::int AS balasan_lintas_unit
FROM surat_keluar sk
JOIN surat_masuk sm ON sm.id = sk.balasan_untuk`,
  },
  {
    id: 'sifat_surat_distinct',
    judul: 'Nilai distinct surat_masuk.sifat_surat',
    keputusan: 'Regenerasi backend/src/__tests__/fixtures/sifat-surat-produksi.json dengan --format=sifat-json lalu jalankan test paritas.',
    sql: `SELECT sifat_surat AS nilai, format('%L', sifat_surat) AS literal, count(*)::int AS jumlah,
       count(*) FILTER (WHERE is_deleted IS NOT TRUE)::int AS jumlah_hidup
FROM surat_masuk
GROUP BY sifat_surat
ORDER BY jumlah DESC, literal`,
  },
  {
    id: 'klasifikasi_keamanan_keluar_distinct',
    judul: 'Nilai distinct surat_keluar.klasifikasi_keamanan',
    keputusan: 'NULL diperlakukan terbatas (spec 4.4). Nilai di luar biasa/terbatas/rahasia/sangat_rahasia dicatat untuk reklasifikasi.',
    sql: `SELECT klasifikasi_keamanan AS nilai, format('%L', klasifikasi_keamanan) AS literal, count(*)::int AS jumlah
FROM surat_keluar
GROUP BY klasifikasi_keamanan
ORDER BY jumlah DESC, literal`,
  },
  {
    id: 'sifat_surat_kelas',
    judul: 'Kelas keamanan per nilai sifat_surat: SQL lama vs normalisasi P0',
    keputusan: 'Baris dengan kelas_lama berbeda dari kelas_baru adalah surat yang tampil/berubah di kotak disposisi setelah P0.',
    sql: `SELECT s.sifat_surat AS nilai, format('%L', s.sifat_surat) AS literal,
       ${kelasLamaSql('s.sifat_surat')} AS kelas_lama,
       ${kelasBaruSql('s.sifat_surat')} AS kelas_baru,
       count(*)::int AS jumlah
FROM surat_masuk s
GROUP BY s.sifat_surat
ORDER BY jumlah DESC, literal`,
  },
  {
    id: 'distribusi_terbuka_per_kelas',
    judul: 'Distribusi sent/received per kelas (lama vs P0)',
    keputusan: 'Jumlah dengan kelas_lama berbeda dari kelas_baru = disposisi yang baru muncul di kotak disposisi setelah P0; umumkan ke direktorat. Kelas terkendali yang masih terbuka menjadi masukan kebijakan 4.12.',
    sql: `SELECT ${kelasBaruSql('sm.sifat_surat')} AS kelas_baru,
       ${kelasLamaSql('sm.sifat_surat')} AS kelas_lama,
       sd.status, count(*)::int AS jumlah
FROM surat_distributions sd
JOIN surat_masuk sm ON sm.id = sd.surat_masuk_id
WHERE sd.status IN ('sent', 'received')
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3`,
  },
];

const FORBIDDEN_SQL = /\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|comment|vacuum|analyze|reindex|cluster|copy|call|do|lock|refresh|listen|notify|set|reset|begin|start|commit|rollback|savepoint|release|prepare|execute|into|discard)\b/i;

export function assertReadOnlySql(id, sqlText) {
  const text = String(sqlText ?? '').trim();
  if (!/^(select|with)\b/i.test(text) || text.includes(';') || FORBIDDEN_SQL.test(text)) {
    throw new Error(`Pemeriksaan pre-flight "${id}" bukan satu query baca`);
  }
}

export async function runPreflight(client, checks = PREFLIGHT_CHECKS) {
  for (const check of checks) assertReadOnlySql(check.id, check.sql);
  await client.query(PREFLIGHT_TRANSACTION);
  try {
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query('SET LOCAL standard_conforming_strings = on');
    const results = [];
    for (const check of checks) {
      await client.query('SAVEPOINT preflight_check');
      try {
        const { rows } = await client.query(check.sql);
        await client.query('RELEASE SAVEPOINT preflight_check');
        results.push({ ...check, rows, error: null });
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT preflight_check');
        results.push({ ...check, rows: [], error: `${error.code ? `${error.code}: ` : ''}${error.message}` });
      }
    }
    return results;
  } finally {
    await client.query('ROLLBACK');
  }
}

function cell(value) {
  let text;
  if (value === null || value === undefined) text = 'NULL';
  else if (Array.isArray(value)) text = `{${value.map(item => (item === null ? 'NULL' : String(item))).join(', ')}}`;
  else if (value instanceof Date) text = value.toISOString();
  else text = String(value);
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function formatReport(results, generatedAt = new Date().toISOString()) {
  const failed = results.filter(result => result.error);
  const lines = [
    '# Laporan Pre-flight P0 Integrasi Surat',
    '',
    `Dibuat: ${generatedAt}`,
    'Mode: transaksi READ ONLY, REPEATABLE READ, statement_timeout 15s, diakhiri ROLLBACK.',
    '',
    `Ringkasan: ${results.length} pemeriksaan, ${failed.length} gagal.`,
    '',
  ];
  for (const result of results) {
    lines.push(`## ${result.id} — ${result.judul}`, '', `Keputusan: ${result.keputusan}`, '');
    if (result.error) {
      lines.push(`**GAGAL:** ${cell(result.error)}`, '');
      continue;
    }
    if (result.rows.length === 0) {
      lines.push('_(0 baris)_', '');
      continue;
    }
    const columns = Object.keys(result.rows[0]);
    lines.push(`| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`);
    for (const row of result.rows.slice(0, MAX_ROWS_PER_CHECK)) {
      lines.push(`| ${columns.map(column => cell(row[column])).join(' | ')} |`);
    }
    if (result.rows.length > MAX_ROWS_PER_CHECK) {
      lines.push('', `_(${result.rows.length - MAX_ROWS_PER_CHECK} baris lain tidak ditampilkan)_`);
    }
    lines.push('');
  }
  lines.push(
    '## Pengesahan',
    '',
    '- Dijalankan oleh (nama/jabatan):',
    '- Basis data (host Neon, cabang) dan waktu:',
    '- Ditinjau pemilik keamanan:',
    '- Keputusan lanjut ke P1 (ya/tidak, alasan):',
    '',
  );
  return lines.join('\n');
}

export function formatSifatFixture(results) {
  const check = results.find(result => result.id === 'sifat_surat_distinct');
  if (!check || check.error) throw new Error('Pemeriksaan sifat_surat_distinct gagal; fixture tidak dibuat');
  return `${JSON.stringify(check.rows.map(row => row.nilai), null, 2)}\n`;
}

async function main() {
  dotenv.config({ quiet: true });
  const connectionString = process.env.PREFLIGHT_DATABASE_URL?.trim();
  if (!connectionString) throw new Error('PREFLIGHT_DATABASE_URL wajib diisi (gunakan role Neon read-only)');
  const formatArg = process.argv.find(arg => arg.startsWith('--format='));
  const format = formatArg ? formatArg.slice('--format='.length) : 'markdown';
  if (!['markdown', 'sifat-json'].includes(format)) throw new Error(`Format tidak dikenal: ${format}`);
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000, application_name: 'simsa-preflight-p0' });
  try {
    await client.connect();
    const results = await runPreflight(client);
    process.stdout.write(format === 'sifat-json' ? formatSifatFixture(results) : `${formatReport(results)}\n`);
    if (results.some(result => result.error)) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Jangan mencetak connection string atau parameter.
    console.error(`Pre-flight gagal${error.code ? ` [${error.code}]` : ''}: ${error.message}`);
    process.exitCode = 1;
  });
}
