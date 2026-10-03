# Hasil rilis integrasi surat — Tahap A dan B (C47), 3 Oktober 2026

Tahap A (skema 0046/0047 dan backfill langkah 1) dan tahap B (deploy kode C47, kriteria keluar P3, batas data lama) dari `docs/RILIS_INTEGRASI_SURAT_P0_P5.md` §3 selesai pada 3 Oktober 2026. Kode produksi kini **C47** = `main` `7c1896407b26c4a31051f575f77e780fb86490c0` (merge P4, PR #22). P5 belum di-merge (CTRL-2; tahap C).

Semua waktu dalam UTC (WIB = UTC+7). Kredensial tidak pernah dicatat; semua koneksi memakai prompt tersembunyi.

## Ringkasan

| Langkah | Hasil | Waktu (UTC) |
|---|---|---|
| Pre-flight P0 (read-only, role `simsa_backup`) | 21 pemeriksaan, 0 gagal; test paritas PASS. Laporan: `HASIL_PREFLIGHT_INTEGRASI_SURAT_P0_2026-10-03.md` | 01:36:52 |
| 1. Backup #1 (helper C45 = `51679d3`, rantai 0045) | `status: passed`; bundle `neon-backup-PcJdxj`, snapshot 01:52:41.797Z, `archive_sha256` `948b13d48b375f98e9023136d9c54355262bdcb124fb39607e55377d40e0bd6f`; `restore_verified: false` | 01:52 |
| 2. Pemeriksaan read-only RUNBOOK_P1 langkah 2, RUNBOOK_P3 §1.2/§1.4 | Semua sesuai (status/ganda/direktorat-* kosong; FRa 0; C-10 kosong, tidak ada disposisi) | ~02:0x |
| 3. Migrasi 0046/0047 dari C47 (`simsa_migration`) | `{"applied":2,"total":48}`; `verify-runtime` OK (`simsa_api`, 48 migrasi); hak `rangkaian_surat` dan unit pengawas sesuai | ~02:1x |
| 4. Backfill langkah 1 run pertama (`simsa_api`) | `rangkaianDibuat 0, distribusiDiisi 0, sisaTanpaRangkaian 0, dilewati []` | ~02:2x |
| 5. Deploy C47 frontend + backend | Kandidat dibangun `--prod --skip-domain` dari `git archive 7c18964` (1.579 file, manifest `b346712f673ddfe38ed1476a6cb7716fd03a3bed249a1e719b5a5c6ea6419b40`), lalu dipromosikan | backend 03:30:27, frontend 03:30:58 |
| 6. `/ready` = 200 | Setelah pemindai on-demand dibangunkan dengan satu surat uji berlampiran PDF (lolos antivirus) | ~03:5x |
| 7. Backfill langkah 1 run kedua | `sisaTanpaRangkaian 0, dilewati []`; `count(*) WHERE rangkaian_id IS NULL` = 0 | ~03:4x |
| 8. Smoke dan pencatatan | Go-live P3 = **03:30:27Z** (10:30 WIB). `ringkasan` 200, `batasDataLama` = `2026-10-03T03:48:44.501Z`. TimeZone sesi ad-hoc `GMT` (setara UTC); sesi aplikasi dipaksa `-c timezone=UTC` (`backend/src/config/database.ts`) | |
| 9. Sematkan batas data lama | `RANGKAIAN_DATA_LAMA_SEBELUM=2026-10-03T03:48:44.501Z` (Production, sensitive), redeploy backend; `ringkasan` tetap `2026-10-03T03:48:44.501Z` | |

## Deployment

| Komponen | Domain | Deployment aktif | Rollback |
|---|---|---|---|
| Backend | `simsa-backend.vercel.app` | `dpl_5pgnKhajfMxctU1Q2j7zH5MQgL8j` (redeploy C47 + env batas data lama). Kandidat asal: `dpl_4RJ32g22ewDpvrWZLi9jg8ZfDQef` | `dpl_44SiYQsYisCMnhVHtuG8fPnox6ga` |
| Frontend | `simsa-frontend.vercel.app` | `dpl_A76xrTjKMK3DC9icxMCW979LEaxj` | `dpl_Hg3D9BYbUYPNhftZC7D8GaCdVZsL` |

Gerbang build kandidat (Vercel, `SIMSA_VERIFY_CANDIDATE_SOURCE=1`):

- Backend: `tsc` bersih; 257 berkas / **3.760 test lulus**; `SIMSA candidate backend: source checks passed`.
- Frontend: eslint bersih; 145 berkas / **1.032 test lulus**; `SIMSA candidate frontend: source checks passed`.

Rollback kode aman kapan pun: skema 0047 bersifat aditif dan kode lama berjalan di atasnya (diverifikasi: backend lama melaporkan `database.ready: true` setelah migrasi).

## Catatan yang perlu dibaca

1. **Percobaan frontend pertama gagal** (`dpl_DB5TAa89sPG2uSDz65T7fEGUXwdx`): 1/1.032 test gagal karena race render di `TambahSuratKeluar.modes.test.jsx` (lokasi router berubah sebelum elemen rute baru dirender; lokal 8/8 lulus, CI hijau). Perbaikan test (juga satu race identik di `TambahSuratMasuk.registrasi.test.jsx`) ada di PR #24 (`df79bfd`). Atas keputusan pengguna, kandidat diulang dari sumber beku yang sama dan lulus penuh.
2. **PR #24 tertahan oleh Security Audit**: advisori high baru tanpa versi patch, `braces` GHSA-vfj7-8cjw-p6xm (≤3.0.3) dan `http-cache-semantics` GHSA-ch52-4w7c-c8xp (≤4.2.0). Dependensi produksi backend, frontend, dan Spark bersih (`--omit=dev`); docs-site terdampak (situs statis, hanya saat build). Gerbang ini kini gagal untuk semua PR sampai upstream merilis patch atau kebijakan audit CI diubah.
3. **Koreksi temuan 2 Oktober tentang deploy otomatis frontend.** Deploy production otomatis dari merge P0/P1 hanya memindahkan alias sekunder `simsa-frontend-bayilaras-projects.vercel.app` (dilindungi Vercel Authentication). Domain kanonik `simsa-frontend.vercel.app` tetap di `dpl_Hg3D9BYbUYPNhftZC7D8GaCdVZsL` sampai promosi C47; pengguna tidak pernah melihat frontend P1. Ignored Build Step tetap dipasang sebagai pengaman, dan terbukti tidak menghalangi deploy kandidat CLI (sumber `git archive` tanpa metadata git).
4. **Kredensial yang dirotasi**: password `simsa_backup` dirotasi (sempat terekspos di sesi kerja) dan secret GitHub `NEON_BACKUP_DATABASE_URL` diperbarui. Helper backup mewajibkan `sslmode=verify-full&channel_binding=require` dan endpoint direct; pastikan secret memakai format itu. Password `simsa_migration` dipakai dari salinan operator.
5. **Backup terjadwal**: database kini di 0047, sama dengan `main`, sehingga backup harian dapat berjalan lagi bila format secret benar.
6. **Surat uji**: satu surat masuk sintetis berlampiran PDF ("UJI RILIS C47") dibuat untuk membangunkan pemindai; rangkaiannya menjadi rangkaian pertama (03:48:44.501Z) dan menentukan `batasDataLama`. Tidak ada surat lain dibuat antara go-live (03:30:27Z) dan batas itu.

## Belum selesai

- Penugasan `admin_unit` untuk `dir_bppt`, `dir_ptep`, `dir_ktpp`, `dir_plp` (0047 membuat unit itu dapat dipilih sebagai target disposisi). Sampai ada penugasan, TU tidak mengirim disposisi ke direktorat.
- Gerbang §2/§4 dokumen rilis: sign-off baris gerbang, uji asap P4 (dapat dijalankan di produksi dengan data sintetis), catatan rilis TU, blok Pengesahan laporan pre-flight.
- Uji pemulihan (`restore-verify`) bundle Backup #1 dan salinan offsite bundle + kunci.
- Tahap C (P5: pra-cek 0048, merge PR #23, `grants/0003` pg_trgm, migrasi 0048/0049, deploy C48).
- Keputusan kebijakan Security Audit CI (lihat catatan 2) agar PR #24 dan PR berikutnya dapat di-merge.
