#!/usr/bin/env node
// Backfill langkah 1 (P3, tanpa gerbang sign-off): setiap surat masuk yang punya
// baris surat_distributions tanpa rangkaian_id mendapat rangkaian asal
// 'surat_masuk' + anggota induk, lalu SEMUA baris distribusinya (termasuk
// rejected) diisi rangkaian_id. Batch per transaksi, idempoten, diaudit.
//
// Penulis P2 masih aktif sampai kode P3 dideploy; karena itu runbook
// menjalankan ulang skrip (idempoten) segera SETELAH deploy P3 dan
// memverifikasi sisaTanpaRangkaian: 0 sesudahnya. [T2-2]
//
// Urutan kunci (G-LOCK, dipersempit untuk skrip berdiri sendiri ini): baris
// surat_masuk (FOR UPDATE OF sm, ORDER BY sm.id, per batch) -> baris
// rangkaian_surat tempat surat itu menjadi ANGGOTA (peran apa pun, bukan hanya
// induk; FOR UPDATE, satu per surat — surat itu sendiri sudah terkunci
// sehingga keanggotaannya tidak dapat dipindah gabung bersamaan) ->
// surat_distributions. [G-LOCK, C-M8]
//
// Terhadap kode P3 urutan ini bebas deadlock (setiap penulis distribusi P3
// mengunci surat_masuk lebih dulu). Terhadap kode P2 yang masih live SEBELUM
// deploy, receive/process/reject P2 mengunci baris distribusi lalu trigger 0046
// mengambil FOR SHARE rangkaian (kebalikan R -> D di sini), sehingga run
// pra-deploy dapat gagal 40P01/40001 dan keluar kode 1 dengan batch berjalan
// digulung balik. Skrip idempoten: jalankan ulang saja (runbook §4). [C-M3]
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

/** Sama dengan judulRangkaian P1: COALESCE(NULLIF(trim(perihal),''), nomor_surat, '(tanpa perihal)'). */
function judulDari(surat) {
  const perihal = typeof surat.perihal === 'string' ? surat.perihal.trim() : '';
  const nomor = typeof surat.nomor_surat === 'string' ? surat.nomor_surat.trim() : '';
  return perihal || nomor || '(tanpa perihal)';
}

export async function backfillRangkaianDisposisi(client, { batchSize = 500, log = () => {} } = {}) {
  // Log identitas koneksi SEBELUM batch pertama: operator produksi harus
  // bisa melihat langsung role dan database yang sedang ditulis skrip ini,
  // supaya salah role/DB (mis. lupa set DATABASE_URL ke NEON_RUNTIME_DATABASE_URL
  // dan jatuh ke backend/.env) langsung terlihat sebelum menyimpulkan
  // `sisaTanpaRangkaian: 0` dari database yang salah. [F3]
  const { rows: [identitas] } = await client.query(
    'SELECT current_user AS db_user, current_database() AS db_name');
  log({ dbUser: identitas.db_user, dbName: identitas.db_name });
  let rangkaianDibuat = 0;
  let distribusiDiisi = 0;
  const dilewati = [];
  let cursor = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    await client.query('BEGIN');
    try {
      const { rows: batch } = await client.query(
        `SELECT sm.id, sm.unit_kerja_id, sm.tahun, sm.nomor_surat, sm.perihal, sm.sifat_surat
           FROM surat_masuk sm
          WHERE sm.id > $2
            AND EXISTS (SELECT 1 FROM surat_distributions d WHERE d.surat_masuk_id = sm.id AND d.rangkaian_id IS NULL)
          ORDER BY sm.id
          LIMIT $1
          FOR UPDATE OF sm`,
        [batchSize, cursor],
      );
      if (batch.length === 0) {
        await client.query('COMMIT');
        break;
      }
      for (const surat of batch) {
        const { rows: [anggota] } = await client.query(
          'SELECT rangkaian_id FROM rangkaian_anggota WHERE surat_masuk_id = $1', [surat.id]);
        let rangkaianId = anggota?.rangkaian_id ?? null;
        if (rangkaianId) {
          // RB:90 surat -> rangkaian -> distribusi: kunci rangkaian sebelum
          // menyentuh baris distribusinya. Trigger 0046 menolak UPDATE pada
          // surat_distributions bila rangkaian anggotanya (dicari lewat
          // surat_masuk_id, bukan hanya rangkaian_id baris itu) berstatus
          // 'diberkaskan' — lewati surat ini daripada membiarkan batch gagal
          // 23514 dan menghentikan seluruh backfill. 'digabung' juga dilewati
          // karena rangkaian itu bukan lagi tujuan penulisan yang sah. [C-6]
          const { rows: [rs] } = await client.query(
            'SELECT status FROM rangkaian_surat WHERE id = $1 FOR UPDATE', [rangkaianId]);
          if (rs.status !== 'aktif' && rs.status !== 'selesai') {
            dilewati.push({ suratMasukId: surat.id, rangkaianId, status: rs.status });
            cursor = surat.id;
            continue;
          }
        }
        if (!rangkaianId) {
          const { rows: [agg] } = await client.query(
            `SELECT bool_or(status IN ('sent','received')) AS terbuka,
                    count(DISTINCT target_unit_id) FILTER (WHERE status <> 'rejected') AS jumlah_target,
                    min(target_unit_id) FILTER (WHERE status <> 'rejected') AS target_tunggal
               FROM surat_distributions WHERE surat_masuk_id = $1`, [surat.id]);
          const { rows: [{ kode }] } = await client.query(
            `SELECT 'RS-' || $1::int::text || '-' || lpad(nextval('rangkaian_surat_kode_seq')::text, 6, '0') AS kode`,
            [surat.tahun]);
          const status = agg.terbuka ? 'aktif' : 'selesai';
          const pengolah = Number(agg.jumlah_target) === 1 ? agg.target_tunggal : null;
          const { rows: [created] } = await client.query(
            // $2::varchar di kedua pemakaian: VALUES menyimpulkan varchar(20)
            // (kolom rangkaian_surat.status), sedangkan `$2 = 'selesai'` tanpa
            // cast menyimpulkan text lewat operator text=text — Postgres
            // menolak parameter yang sama dengan dua tipe berbeda (42P08
            // "inconsistent types deduced for parameter $2"). [F1]
            `INSERT INTO rangkaian_surat (kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun, selesai_at)
             VALUES ($1, 'surat_masuk', $2::varchar, $3, $4, $5, $6, CASE WHEN $2::varchar = 'selesai' THEN now() END)
             RETURNING id`,
            [kode, status, surat.unit_kerja_id, pengolah, judulDari(surat), surat.tahun]);
          rangkaianId = created.id;
          await client.query(
            `INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
             VALUES ($1, $2, $3, 'induk', 'aplikasi')`, [rangkaianId, surat.id, surat.unit_kerja_id]);
          await client.query(
            `INSERT INTO audit_log (action, entity_type, entity_id, changes)
             VALUES ('create', 'rangkaian_surat', $1, $2::jsonb)`,
            [rangkaianId, JSON.stringify({ langkah: 'backfill-1', kode, suratMasukId: surat.id, status, unitPengolahId: pengolah })]);
          rangkaianDibuat += 1;
        }
        const updated = await client.query(
          'UPDATE surat_distributions SET rangkaian_id = $1, updated_at = now() WHERE surat_masuk_id = $2 AND rangkaian_id IS NULL',
          [rangkaianId, surat.id]);
        distribusiDiisi += updated.rowCount ?? 0;
        cursor = surat.id;
      }
      await client.query('COMMIT');
      log({ batch: batch.length, rangkaianDibuat, distribusiDiisi, dilewati: dilewati.length });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  const { rows: [{ sisa }] } = await client.query(
    'SELECT count(*)::int AS sisa FROM surat_distributions WHERE rangkaian_id IS NULL');
  return { rangkaianDibuat, distribusiDiisi, sisaTanpaRangkaian: sisa, dilewati };
}

async function main() {
  // Sengaja diperiksa SEBELUM dotenv.config(): skrip ini menyentuh produksi
  // lewat runbook (docs/RUNBOOK_INTEGRASI_SURAT_P3.md §4), jadi DATABASE_URL
  // harus sudah diset eksplisit di shell (dari NEON_RUNTIME_DATABASE_URL,
  // pola prompt tersembunyi) sebelum npm dipanggil. Berbeda dari db:migrate,
  // skrip ini TIDAK jatuh ke fallback backend/.env — kalau lupa set, jatuh
  // ke .env bisa diam-diam membackfill database dev, atau produksi lewat
  // role bukan-runtime (melanggar T2-3), dan operator akan salah membaca
  // `sisaTanpaRangkaian: 0` dari database yang salah. [F3]
  const sudahEksplisit = Boolean(process.env.DATABASE_URL?.trim());
  dotenv.config({ quiet: true });
  if (!sudahEksplisit) {
    throw new Error(
      'DATABASE_URL harus diset eksplisit di shell sebelum menjalankan db:backfill:rangkaian-disposisi ' +
      '(skrip ini TIDAK memakai fallback backend/.env). Ikuti pola prompt tersembunyi di ' +
      'docs/RUNBOOK_INTEGRASI_SURAT_P3.md §4 untuk mengisi DATABASE_URL dari NEON_RUNTIME_DATABASE_URL ' +
      '(role runtime simsa_api).',
    );
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const hasil = await backfillRangkaianDisposisi(client, { log: (p) => console.log(JSON.stringify(p)) });
    console.log(JSON.stringify(hasil));
    if (hasil.dilewati.length > 0) {
      console.error(`${hasil.dilewati.length} surat masuk dilewati (rangkaian induknya tidak aktif/selesai):`);
      for (const item of hasil.dilewati) console.error(JSON.stringify(item));
    }
    if (hasil.sisaTanpaRangkaian !== 0 || hasil.dilewati.length > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
