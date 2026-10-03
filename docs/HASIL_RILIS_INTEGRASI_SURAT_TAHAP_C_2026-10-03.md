# Hasil rilis integrasi surat — Tahap C (P5, C48), 3 Oktober 2026

Lanjutan `HASIL_RILIS_INTEGRASI_SURAT_TAHAP_AB_2026-10-03.md`. Tahap C dari `docs/RILIS_INTEGRASI_SURAT_P0_P5.md` §3 (langkah 10–14) selesai pada 3 Oktober 2026. Kode produksi kini **C48** = `main` `20b27872a9d350b7064aeddbd39090ce82dc1ead` (merge P5, PR #23). Tahap D (data lama) **tidak berlaku**: gerbang (e) = tidak ada data lama.

Semua waktu dalam UTC (WIB = UTC+7). Kredensial tidak pernah dicatat; semua koneksi memakai prompt tersembunyi.

## Ringkasan

| Langkah | Hasil | Waktu (UTC) |
|---|---|---|
| 10. Pra-cek 0048 (database 0047, kode C47) | `rangkaian_id IS NULL` = 0; Koreksi Berkas terbuka ganda: kosong; koreksi tidak konsisten: kosong. Gerbang (e): `surat_masuk.created_by IS NULL` = 0 → tidak ada data lama | ~09:3x |
| 11. Merge P5 | PR #23 di-merge setelah `main` digabung (PR #24, #25), CI 9/9 hijau di `e2c7d51` termasuk Security Audit (kebijakan PR #25), approve efanwahyu. C48 = `20b2787` | ~09:4x |
| 12. Backup #2 (helper C47, pra-0048) | `neon-backup-fChBuJ`, kunci `neon-recovery-key-SFyWe4`, snapshot 09:53:09.189Z, `archive_sha256` `3fdc8627b39834d530e5a4d4a804f78315b84396263cc1f5d255bee41ef66f46` | 09:53 |
| 13.1 Langkah privileged pg_trgm | `grants/0003_optional_pg_trgm.sql` dijalankan `neondb_owner` di Neon SQL Editor (baris `\set` psql dihapus; selebihnya identik). `pg_trgm` 1.6 di `public`, pemilik `neondb_owner`. Catatan: `neondb_owner` tidak punya `CREATE` pada skema `public` (milik `simsa_migrator`), tetapi `pg_trgm` bertanda *trusted* sehingga pemasangan tetap berhasil (sesuai runbook P5 §5.1) | ~10:0x |
| 13.2 Ulang pra-cek | Bersih | ~10:1x |
| 13.3 Migrasi dari C48 (`simsa_migration`) | `{"applied":3,"total":51}` (0048, 0049, 0050); `verify-runtime` OK (`simsa_api`, 51 migrasi) | ~10:1x |
| 13.4 Verifikasi skema dan Backup #3 | `simsa_api`: tanpa `DELETE`, dengan `INSERT` pada `rangkaian_surat`; 51 migrasi; `surat_distributions.rangkaian_id` NOT NULL; 6 index `*_trgm_idx`; `dir_plp` = 0. `/ready` 200 dengan kode C47. Backup #3 (helper C48): `neon-backup-3WLzhl`, kunci `neon-recovery-key-BKE9Y1`, snapshot 10:28:52.452Z, `archive_sha256` `3f578d65a23483d1741ca6102896aa8b488234a3332731afcd6112c7adbb9d9d` | 10:28 |
| 14. Deploy C48 | Kandidat `--prod --skip-domain` dari `git archive 20b2787` (1.613 file, manifest `d2752aed4b2df751162c744d3a60b9e1282a9f3ecaea2868ce04ea807ae7c823`), lalu promosi | backend 10:59:29, frontend 10:59:45 |

## Deployment

| Komponen | Domain | Deployment aktif | Rollback (C47) |
|---|---|---|---|
| Backend | `simsa-backend.vercel.app` | `dpl_Bnfs1HZhPK4dVrXLukwGZybtvi9z` | `dpl_5pgnKhajfMxctU1Q2j7zH5MQgL8j` |
| Frontend | `simsa-frontend.vercel.app` | `dpl_Fa5jRxNxffCE5ikzo3gU4C32dL7K` | `dpl_A76xrTjKMK3DC9icxMCW979LEaxj` |

Gerbang build kandidat (Vercel, `SIMSA_VERIFY_CANDIDATE_SOURCE=1`):

- Backend: `tsc` bersih; 267 berkas / **3.886 test lulus**; `SIMSA candidate backend: source checks passed`.
- Frontend: eslint bersih; 148 berkas / **1.059 test lulus**; `SIMSA candidate frontend: source checks passed`.

Smoke setelah promosi: `/health` 200; `/ready` 200 langsung dan lewat proxy frontend (database, blob, pemindai, worker siap); frontend melayani aset `index-DY-ITWsI.js`; `GET /api/rangkaian/perlu-dilengkapi/ringkasan` 200 dengan `batasDataLama` tetap `2026-10-03T03:48:44.501Z`; Lacak Surat mengembalikan hasil berkelompok tanpa galat. Vercel mencatat 0 galat runtime backend pada 30 menit setelah promosi.

Pemeriksaan `/ready` pertama tepat setelah promosi mengembalikan 503 (`database.ready: false`) karena *cold start* (koneksi database pertama ±3,6 s); lima pemeriksaan berikutnya 200.

Env produksi tidak berubah: `RANGKAIAN_DATA_LAMA_SEBELUM=2026-10-03T03:48:44.501Z`; `RANGKAIAN_AJUKAN_AKSES`, `RANGKAIAN_DISPOSISI_LAMA_READ`, `RANGKAIAN_TUTUP_MASSAL_DATA_LAMA` tidak diset.

Rollback kode ke C47 aman: skema 0048–0050 hanya menambah batasan yang dipenuhi C47 (pra-cek langkah 10), index trigram, dan penghapusan `dir_plp` yang sudah dilakukan manual. Lantai rollback adalah kode P3+.

## Gerbang tahap D

Gerbang (e) = **tidak ada data lama** (0 surat masuk tanpa pembuat). Langkah 15–20 dilewati; gerbang (a), (b), (c), (g), (h), dan CTRL-5 = "tidak berlaku". `RANGKAIAN_TUTUP_MASSAL_DATA_LAMA` dan `RANGKAIAN_DISPOSISI_LAMA_READ` tetap tidak diset.

## Catatan data

`ringkasan` setelah promosi melaporkan `disposisi_terbuka: 1`. Satu-satunya disposisi terbuka adalah bawaan surat uji "UJI RILIS C47" (dibuat 03:48:44.501Z, sumber `dir_ktpp`, tujuan `ditjen`, status `sent`, sudah ber-rangkaian; `ditjen` memiliki 2 `admin_unit` aktif). Tidak ada disposisi ke direktorat tanpa admin. Disarankan admin Ditjen menolaknya dengan alasan "surat uji rilis" agar daftar kerja tidak memuat data uji.

## Tahap E — sisa

- Pastikan backup terjadwal berikutnya (`backup-neon.yml`, 00:00 UTC, dari `main` = C48) berhasil. Secret `NEON_BACKUP_DATABASE_URL` wajib berformat endpoint direct + `sslmode=verify-full&channel_binding=require`.
- Salin bundle + kunci Backup #2 dan #3 ke penyimpanan aman di luar laptop (bundle dan kunci terpisah), cocokkan SHA-256, baru hapus salinan lokal.
- Penugasan `admin_unit` direktorat tetap ditunda; ketiga direktorat masih `can_receive_distribution = false` (lihat dokumen tahap A–B).
- Sign-off gerbang §4, catatan rilis TU, dan uji asap P4/P5 dengan data sintetis.
- Perbaikan `scripts/neon-backup.mjs restore-verify` untuk login `simsa_worker` (dokumen tahap A–B, catatan 7).
- Pengecualian audit docs-site (PR #25) kedaluwarsa 2026-11-03; tinjau sebelum tanggal itu.
