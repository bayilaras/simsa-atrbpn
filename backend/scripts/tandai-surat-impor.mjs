#!/usr/bin/env node
// backend/scripts/tandai-surat-impor.mjs
// Menandai surat hasil impor yang dibuat SEBELUM migrasi 0055 (kolom
// surat_masuk/surat_keluar.diimpor_at). Sejak 0055 impor mengisi penanda itu
// sendiri; skrip ini hanya untuk baris lama, dijalankan sekali oleh operator.
// Default dry-run (tanpa tulis). --apply hanya menerapkan rencana yang
// SHA-256-nya sama dengan dry-run yang sudah diperiksa.
//
// Bukti yang tersedia: impor tidak menulis catatan audit tingkat pekerjaan
// (tidak ada baris "impor dimulai/selesai"); setiap baris impor menulis audit
// `create` yang sama dengan pencatatan formulir, dan tidak ada kolom lain yang
// membedakannya. Yang membedakan hanyalah irama: impor membuat banyak surat
// oleh satu pengguna di satu unit dengan jarak beberapa detik, sedangkan
// pencatatan formulir berjarak menit. Maka calon = "gelombang": deretan surat
// satu unit + satu pembuat (created_by) yang jarak created_at antarbaris
// berurutan <= --jeda-detik, berisi >= --minimal-baris surat. Ambang dan
// saringan adalah argumen eksplisit, dan dry-run mencetak contoh tiap gelombang
// agar operator menilai sebelum menerapkan.
//
// Yang ditulis: diimpor_at = created_at (waktu impor) pada surat calon yang
// penandanya masih NULL dan BUKAN anggota rangkaian mana pun, plus satu baris
// audit_log per surat. Surat anggota rangkaian tidak pernah disentuh (daftar
// kerja menilainya dari rangkaiannya); updated_at tidak diubah.

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pastikanRoleRuntime, siapkanSesi } from './backfill-rangkaian-lama.mjs';

export const ACTOR = 'system:tandai-surat-impor';
export const BATCH_SIZE = 500;
export const BAWAAN = Object.freeze({ jedaDetik: 30, minimalBaris: 5, contoh: 5 });

const TABEL = Object.freeze({
  masuk: { tabel: 'surat_masuk', fk: 'surat_masuk_id', pihak: 'dari' },
  keluar: { tabel: 'surat_keluar', fk: 'surat_keluar_id', pihak: 'kepada' },
});
const UUID_POLA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_BERZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA_POLA = /^[a-f0-9]{64}$/;
const KODE_ULANG = new Set(['40P01', '40001']);

function bilanganBulat(nama, nilai, minimal, maksimal) {
  if (!/^\d+$/.test(nilai)) throw new Error(`${nama} harus bilangan bulat`);
  const angka = Number(nilai);
  if (angka < minimal || angka > maksimal) throw new Error(`${nama} harus antara ${minimal} dan ${maksimal}`);
  return angka;
}

function waktuBerzona(nama, nilai) {
  if (!ISO_BERZONA.test(nilai) || Number.isNaN(Date.parse(nilai))) {
    throw new Error(`${nama} harus ISO-8601 dengan zona waktu, mis. 2026-10-20T00:00:00+07:00`);
  }
  return new Date(nilai).toISOString();
}

export function parseArgs(argv) {
  const options = {
    apply: false, approvedSha256: null, jenis: ['masuk', 'keluar'], unit: null, pengguna: null, sejak: null, sampai: null,
    jedaDetik: BAWAAN.jedaDetik, minimalBaris: BAWAAN.minimalBaris, contoh: BAWAAN.contoh,
  };
  for (const arg of argv) {
    const nilai = arg.slice(arg.indexOf('=') + 1).trim();
    if (arg === '--apply') options.apply = true;
    else if (arg.startsWith('--approved-sha256=')) options.approvedSha256 = nilai.toLowerCase();
    else if (arg.startsWith('--jenis=')) {
      if (nilai === 'semua') options.jenis = ['masuk', 'keluar'];
      else if (nilai === 'masuk' || nilai === 'keluar') options.jenis = [nilai];
      else throw new Error('--jenis harus masuk, keluar, atau semua');
    } else if (arg.startsWith('--unit=')) {
      if (!nilai) throw new Error('--unit tidak boleh kosong');
      options.unit = nilai;
    } else if (arg.startsWith('--pengguna=')) {
      if (!UUID_POLA.test(nilai)) throw new Error('--pengguna harus UUID pengguna pembuat (created_by)');
      options.pengguna = nilai.toLowerCase();
    } else if (arg.startsWith('--sejak=')) options.sejak = waktuBerzona('--sejak', nilai);
    else if (arg.startsWith('--sampai=')) options.sampai = waktuBerzona('--sampai', nilai);
    else if (arg.startsWith('--jeda-detik=')) options.jedaDetik = bilanganBulat('--jeda-detik', nilai, 1, 3600);
    else if (arg.startsWith('--minimal-baris=')) options.minimalBaris = bilanganBulat('--minimal-baris', nilai, 2, 100000);
    else if (arg.startsWith('--contoh=')) options.contoh = bilanganBulat('--contoh', nilai, 0, 50);
    else throw new Error(`Argumen tidak dikenal: ${arg}`);
  }
  if (options.sejak && options.sampai && options.sejak >= options.sampai) throw new Error('--sejak harus sebelum --sampai');
  if (options.approvedSha256 !== null && !options.apply) throw new Error('--approved-sha256 hanya bersama --apply');
  if (options.apply && !SHA_POLA.test(options.approvedSha256 ?? '')) {
    throw new Error('--apply mewajibkan --approved-sha256=<sha256 dry-run yang sudah diperiksa>');
  }
  return options;
}

/** Parameter yang menentukan isi rencana (ikut SHA-256 dan catatan audit); --contoh hanya tampilan. */
export function parameterRencana(options) {
  return {
    jenis: [...options.jenis].sort(), unit: options.unit ?? null, pengguna: options.pengguna ?? null,
    sejak: options.sejak ?? null, sampai: options.sampai ?? null,
    jedaDetik: options.jedaDetik ?? BAWAAN.jedaDetik, minimalBaris: options.minimalBaris ?? BAWAAN.minimalBaris,
  };
}

/**
 * Gelombang dihitung atas SEMUA surat unit + pembuat dalam saringan (termasuk
 * yang sudah bertanda, terhapus, atau anggota rangkaian) agar ukuran gelombang
 * tidak bergantung pada apa yang sudah ditandai. Sesi dipatok UTC (siapkanSesi):
 * created_at bertipe timestamp tanpa zona dan ditulis aplikasi dalam UTC.
 */
function gelombangSql(jenis) {
  const { tabel, fk, pihak } = TABEL[jenis];
  return `
WITH dasar AS (
  SELECT s.id, s.unit_kerja_id, s.created_by, s.created_at, s.diimpor_at, s.is_deleted, s.nomor_surat, s.perihal, s.${pihak} AS pihak,
         s.tanggal_surat,
         extract(epoch FROM s.created_at - lag(s.created_at) OVER urut) AS jeda
    FROM ${tabel} s
   WHERE s.created_by IS NOT NULL
     AND ($1::varchar IS NULL OR s.unit_kerja_id = $1::varchar)
     AND ($2::uuid IS NULL OR s.created_by = $2::uuid)
     AND ($3::timestamptz IS NULL OR s.created_at::timestamptz >= $3::timestamptz)
     AND ($4::timestamptz IS NULL OR s.created_at::timestamptz < $4::timestamptz)
  WINDOW urut AS (PARTITION BY s.unit_kerja_id, s.created_by ORDER BY s.created_at, s.id)
),
bernomor AS (
  SELECT d.*, sum(CASE WHEN d.jeda IS NULL OR d.jeda > $5::int THEN 1 ELSE 0 END)
                OVER (PARTITION BY d.unit_kerja_id, d.created_by ORDER BY d.created_at, d.id) AS gelombang
    FROM dasar d
),
berukuran AS (
  SELECT b.*, count(*) OVER satu AS ukuran, min(b.created_at) OVER satu AS mulai, max(b.created_at) OVER satu AS selesai
    FROM bernomor b
  WINDOW satu AS (PARTITION BY b.unit_kerja_id, b.created_by, b.gelombang)
)
SELECT g.id::text AS id, g.unit_kerja_id, g.created_by::text AS created_by, g.gelombang::int AS gelombang, g.ukuran::int AS ukuran,
       to_char(g.mulai, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS mulai, to_char(g.selesai, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS selesai,
       to_char(g.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
       g.diimpor_at IS NOT NULL AS sudah_ditandai, g.is_deleted IS TRUE AS terhapus,
       EXISTS (SELECT 1 FROM rangkaian_anggota ra WHERE ra.${fk} = g.id) AS anggota_rangkaian,
       g.nomor_surat, g.perihal, g.pihak, g.tanggal_surat::text AS tanggal_surat,
       (SELECT u.email FROM users u WHERE u.id = g.created_by) AS pembuat_email
  FROM berukuran g
 WHERE g.ukuran >= $6::int
 ORDER BY g.unit_kerja_id, g.created_by, g.created_at, g.id`;
}

const potong = (teks, panjang = 60) => {
  const bersih = String(teks ?? '').replace(/\s+/g, ' ').trim();
  return bersih.length > panjang ? `${bersih.slice(0, panjang - 1)}…` : bersih;
};

/**
 * Rencana tanpa efek samping. `kandidat` = id surat yang akan ditandai; SHA-256
 * menutup parameter dan daftar id itu, jadi --apply menolak bila data atau
 * ambang berubah sejak dry-run yang diperiksa.
 */
export async function buildPlan(client, options = {}) {
  const parameter = parameterRencana({ jenis: ['masuk', 'keluar'], ...options });
  const contoh = options.contoh ?? BAWAAN.contoh;
  const rencana = { parameter, gelombang: [], perUnit: [], kandidat: { masuk: [], keluar: [] }, total: { gelombang: 0, baris: 0, sudahDitandai: 0, anggotaRangkaian: 0, akanDitandai: 0 } };
  for (const jenis of parameter.jenis) {
    const { rows } = await client.query(gelombangSql(jenis),
      [parameter.unit, parameter.pengguna, parameter.sejak, parameter.sampai, parameter.jedaDetik, parameter.minimalBaris]);
    const perGelombang = new Map();
    for (const row of rows) {
      const kunci = `${row.unit_kerja_id}|${row.created_by}|${row.gelombang}`;
      if (!perGelombang.has(kunci)) {
        perGelombang.set(kunci, {
          jenis, unit: row.unit_kerja_id, pembuat: row.created_by, pembuatEmail: row.pembuat_email ?? null,
          mulai: row.mulai, selesai: row.selesai, baris: 0, sudahDitandai: 0, anggotaRangkaian: 0, terhapus: 0, akanDitandai: 0, contoh: [],
        });
      }
      const g = perGelombang.get(kunci);
      g.baris += 1;
      if (row.terhapus) g.terhapus += 1;
      if (row.sudah_ditandai) g.sudahDitandai += 1;
      else if (row.anggota_rangkaian) g.anggotaRangkaian += 1;
      else {
        g.akanDitandai += 1;
        rencana.kandidat[jenis].push(row.id);
        if (g.contoh.length < contoh) {
          g.contoh.push({ id: row.id, dibuat: row.created_at, tanggalSurat: row.tanggal_surat, nomorSurat: potong(row.nomor_surat, 40), perihal: potong(row.perihal), pihak: potong(row.pihak, 40) });
        }
      }
    }
    const perUnit = new Map();
    for (const g of perGelombang.values()) {
      rencana.gelombang.push(g);
      const u = perUnit.get(g.unit) ?? { jenis, unit: g.unit, gelombang: 0, baris: 0, sudahDitandai: 0, anggotaRangkaian: 0, akanDitandai: 0 };
      u.gelombang += 1;
      for (const nama of ['baris', 'sudahDitandai', 'anggotaRangkaian', 'akanDitandai']) u[nama] += g[nama];
      perUnit.set(g.unit, u);
    }
    for (const u of perUnit.values()) {
      rencana.perUnit.push(u);
      for (const nama of ['gelombang', 'baris', 'sudahDitandai', 'anggotaRangkaian', 'akanDitandai']) rencana.total[nama] += u[nama];
    }
    rencana.kandidat[jenis].sort();
  }
  rencana.sha256 = createHash('sha256').update(JSON.stringify({ parameter, kandidat: rencana.kandidat })).digest('hex');
  return rencana;
}

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

/**
 * Satu pernyataan per batch: UPDATE + audit bersama-sama atau tidak sama sekali.
 * Syarat diulang di bawah kunci baris: penanda masih NULL dan surat belum
 * menjadi anggota rangkaian sejak rencana dibuat.
 */
function tandaiSql(jenis) {
  const { tabel, fk } = TABEL[jenis];
  return `
WITH ditandai AS (
  UPDATE ${tabel} s SET diimpor_at = s.created_at::timestamptz
   WHERE s.id = ANY($1::uuid[]) AND s.diimpor_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM rangkaian_anggota ra WHERE ra.${fk} = s.id)
  RETURNING s.id, s.diimpor_at
)
INSERT INTO audit_log (user_email, action, entity_type, entity_id, changes)
SELECT $2::varchar, 'update', '${tabel}', d.id,
       jsonb_build_object('sumber', 'tandai_surat_impor',
                          'before', jsonb_build_object('diimporAt', NULL),
                          'after', jsonb_build_object('diimporAt', d.diimpor_at),
                          'rencana', $3::jsonb)
  FROM ditandai d
RETURNING entity_id::text AS id`;
}

async function tandaiBatch(client, jenis, ids, rencana) {
  for (let percobaan = 1; ; percobaan += 1) {
    await client.query('BEGIN');
    try {
      const { rows } = await client.query(tandaiSql(jenis), [ids, ACTOR, JSON.stringify(rencana)]);
      await client.query('COMMIT');
      return rows.length;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (!KODE_ULANG.has(error?.code) || percobaan >= 3) throw error;
    }
  }
}

/** Menerapkan rencana yang SHA-256-nya sama dengan `approvedSha256`; idempoten (baris bertanda dilewati). */
export async function applyPlan(client, options = {}) {
  if (!SHA_POLA.test(options.approvedSha256 ?? '')) throw new Error('applyPlan membutuhkan approvedSha256 (64 heksadesimal)');
  const rencana = await dalamSnapshot(client, () => buildPlan(client, options));
  if (rencana.sha256 !== options.approvedSha256) {
    throw new Error(`Rencana berubah sejak dry-run (sha256 kini ${rencana.sha256}); jalankan dry-run ulang dan periksa lagi`);
  }
  const ringkasan = { ditandai: { masuk: 0, keluar: 0 }, dilewati: { masuk: 0, keluar: 0 } };
  const catatan = { sha256: rencana.sha256, parameter: rencana.parameter };
  for (const jenis of rencana.parameter.jenis) {
    const ids = rencana.kandidat[jenis];
    for (let awal = 0; awal < ids.length; awal += BATCH_SIZE) {
      const batch = ids.slice(awal, awal + BATCH_SIZE);
      const ditandai = await tandaiBatch(client, jenis, batch, catatan);
      ringkasan.ditandai[jenis] += ditandai;
      // Menjadi anggota rangkaian atau ditandai proses lain di antara rencana dan tulis.
      ringkasan.dilewati[jenis] += batch.length - ditandai;
    }
  }
  return ringkasan;
}

export function cetakRencana(rencana, log = console.log) {
  log(`Parameter: ${JSON.stringify(rencana.parameter)}`);
  if (rencana.gelombang.length === 0) log('Tidak ada gelombang yang memenuhi ambang.');
  for (const g of rencana.gelombang) {
    log(`\n[surat ${g.jenis}] unit=${g.unit} pembuat=${g.pembuatEmail ?? g.pembuat} ${g.mulai} s.d. ${g.selesai}: `
      + `${g.baris} baris (akan ditandai ${g.akanDitandai}, sudah bertanda ${g.sudahDitandai}, anggota rangkaian dilewati ${g.anggotaRangkaian}, terhapus ${g.terhapus})`);
    for (const c of g.contoh) log(`    contoh: dibuat ${c.dibuat} | tgl surat ${c.tanggalSurat ?? '-'} | ${c.nomorSurat || '-'} | ${c.perihal || '-'} | ${c.pihak || '-'}`);
  }
  log('\nPer unit:');
  for (const u of rencana.perUnit) {
    log(`  surat ${u.jenis} ${u.unit}: gelombang ${u.gelombang}, baris ${u.baris}, akan ditandai ${u.akanDitandai}, `
      + `sudah bertanda ${u.sudahDitandai}, anggota rangkaian dilewati ${u.anggotaRangkaian}`);
  }
  log(`Total: ${JSON.stringify(rencana.total)}`);
  log(`SHA-256 rencana: ${rencana.sha256}`);
}

// Dijalankan sebagai role runtime `simsa_api` (UPDATE surat + INSERT audit_log), seperti backfill-rangkaian-lama.mjs.
// DATABASE_URL hanya dari shell; skrip ini tidak memuat backend/.env.
async function main() {
  const urlShell = process.env.DATABASE_URL?.trim();
  if (!urlShell) {
    throw new Error('DATABASE_URL harus diset eksplisit di shell (role runtime simsa_api); skrip ini tidak memakai backend/.env');
  }
  const options = parseArgs(process.argv.slice(2));
  const client = new pg.Client({ connectionString: urlShell, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const zonaWaktu = await siapkanSesi(client);
    const { rows: [identitas] } = await client.query('SELECT current_user AS db_user, current_database() AS db_name');
    console.log(JSON.stringify({ dbUser: identitas.db_user, dbName: identitas.db_name, dbHost: client.host, zonaWaktu, apply: options.apply }));
    pastikanRoleRuntime(identitas, { apply: options.apply, host: client.host });
    const rencana = await dalamSnapshot(client, () => buildPlan(client, options));
    cetakRencana(rencana);
    if (!options.apply) {
      console.log('\nDry-run: tidak ada yang ditulis. Periksa contoh di atas; bila benar, ulangi dengan argumen yang sama ditambah');
      console.log(`  --apply --approved-sha256=${rencana.sha256}`);
      return;
    }
    const ringkasan = await applyPlan(client, options);
    console.log(`Selesai: ${JSON.stringify(ringkasan)}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Tandai surat impor gagal${error.code ? ` [${error.code}]` : ''}: ${error.message}`);
    process.exitCode = 1;
  });
}
