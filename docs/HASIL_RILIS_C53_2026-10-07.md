# Hasil rilis C53 dan tindak lanjut 5–7 Oktober 2026

Lanjutan `HASIL_RILIS_C52_2026-10-05.md`. Semua waktu dalam UTC (WIB = UTC+7). Kredensial tidak pernah dicatat.

## Pemindai setelah C52

| Bukti | Waktu |
|---|---|
| Monitor terjadwal memperbarui definisi lebih awal (sisa < 13 jam); lease baru s.d. 7 Okt 00:52 | 6 Okt 00:51 |
| Cron Vercel pertama memanggil `GET /api/operations/scanner-wake` (200; lease masih > 13 jam sehingga `fresh`). Jadwal 03:07, berjalan dalam jam yang sama sesuai batas paket Hobby | 6 Okt 03:39 |
| Lease diperpanjang otomatis oleh cron 15:07 dan monitor 15:16; lease baru s.d. 7 Okt 15:17 | 6 Okt 15:17 |

`/ready` backend dan frontend 200 pada setiap pantauan per jam sejak 5 Okt 14:52; tidak ada log `error`/`fatal` di jendela yang dapat dibaca (retensi log paket Hobby 1 jam).

## Store Blob publik lama

Store `simsa-files` (`store_A3HOx…`, akses **public**, iad1) masih terhubung ke `simsa-backend` di semua environment dan berisi 24 PDF yang diunggah Februari–April 2026: naskah dinas dan dokumen kepegawaian pribadi (2 berkas SKP, 1 e-Certificate). URL objeknya tanpa akhiran acak sehingga dapat ditebak dari nama berkas.

| Langkah | Hasil | Pelaksana |
|---|---|---|
| Rujukan database (semua kolom teks/JSON skema `public` yang memuat `.public.blob.vercel-storage.com`) | 0 | Operator (Neon SQL Editor) |
| Arsip ke penyimpanan lokal di luar repo | 24 berkas, 46.309.594 byte; `MANIFEST.sha256` cocok 24/24 | Claude Code (skrip), operator |
| Hapus objek | `Objek tersisa: 0` | Operator |
| Lepas dan hapus store | API Vercel `Store not found`; env `BLOB_READ_WRITE_TOKEN` lama hilang; produksi tetap `vercel-blob-private` | Operator |

Produksi tidak terdampak: alias `SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN` selalu menimpa token lama di runtime Production. Deployment Preview backend kini tidak memiliki penyimpanan berkas (di Preview pun unggah ke store publik sudah tidak berfungsi). Tidak ada log akses untuk store publik, sehingga akses pihak luar selama Februari–Oktober tidak dapat dipastikan; operator diminta melaporkannya sesuai prosedur keamanan informasi. Arsip disimpan operator di luar repo.

## Salinan offsite Backup #2 dan #3

Bundle terenkripsi Backup #2 (`neon-backup-fChBuJ`, C47) dan #3 (`neon-backup-3WLzhl`, C48) disalin ke Google Drive operator (folder `SALINAN-OFFSITE-BUNDLE-SIMSA`, ukuran setiap berkas cocok; `SHA256SUMS` dan `BACA-SAYA.txt` disertakan). Hash dump cocok dengan `archive_sha256` di dokumen rilis Tahap C. Folder kunci sempat ikut terunggah, lalu dihapus permanen termasuk dari Trash. Kunci pemulihan disimpan terpisah di flashdisk terenkripsi; salinan lokal di laptop dihapus operator.

## Advisory npm 5–6 Oktober dan PR #38

Security Audit gagal di semua PR karena advisory baru:

| Paket | Versi | Proyek | Advisory |
|---|---|---|---|
| `proxy-addr` | 2.0.7 → 2.0.8 | backend, docs-site | GHSA-jqcg-44mw-7w3h (critical; runtime backend lewat Express `trust proxy`, IP spoofing) |
| `compression` | 1.8.1 → 1.8.2 | backend, docs-site | GHSA-vc2v-76pw-4v95 (high; runtime backend, DoS) |
| `source-map-js` | 1.2.1 → 1.2.2 | backend, frontend, docs-site | GHSA-68fv-2mgg-jv7q (high) |
| `shell-quote` | 1.10.0 → 1.12.0 | docs-site | GHSA-pqg4-j6r4-53mv (critical) |

`tinypool` (GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr) dikunci `^1.0.2` oleh `@docusaurus/core` 3.10.2 (terbaru); perbaikan baru di 2.1.2. Dikecualikan sementara khusus docs-site sampai **2026-11-06**. PR #38 di-merge `615f428` (CI 9/9 hijau, approve efanwahyu).

## Rilis C53

| Langkah | Hasil | Waktu |
|---|---|---|
| Kandidat | `dpl_6xHiuwE46hNrqLMMnvYFTibBzC67` dari `git archive 615f428` (1.622 file, manifest `4684e70e157c97f66a2469b9fb5ce11d6e19e8554100f2d3784e766333801c30`); `proxy-addr@2.0.8`, `compression@1.8.2`; `tsc` bersih, 268 berkas / 3.900 test lulus | build 01:22 |
| Promosi | `simsa-backend.vercel.app` → C53 | 01:42 |

Smoke: `/ready` backend (pertama 7 s karena *cold start*) dan lewat proxy 200, `/health` 200, respons terkompresi normal, `scanner-wake` dan `probe` tanpa token 401, 0 galat runtime. Frontend tidak dirilis ulang; perubahan frontend hanya `source-map-js` yang dipakai saat build.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_6xHiuwE46hNrqLMMnvYFTibBzC67` (C53) | `main` `615f428` | C52 `dpl_2HgoJXohLLFHgQNvbLFpMmWxnKXP` |
| Frontend | `dpl_8P7cMrmofdfhLEWFFQ9YwoRov7fP` (C50) | `main` `737877e` | C49 `dpl_8ysikCmaEigc9YGeREerdkJsen53` |

Database tidak berubah (51 migrasi).

## Uji akun direktorat

Uji akun admin Dit. BPPT dan isolasi Lacak admin Dit. PTEP lulus 6 Okt 2026 (laporan operator); dicatat lewat PR #37 di `HASIL_UJI_ASAP_INTEGRASI_SURAT_2026-10-04.md`, baris P4-14 lembar sign-off disahkan Operator.

## Sisa

- Sign-off pejabat (`SIGN_OFF_RILIS_INTEGRASI_SURAT.md`) dan distribusi `CATATAN_RILIS_TU_INTEGRASI_SURAT.md`.
- Laporan insiden store publik lama; arsip 24 dokumen ke penyimpanan kantor.
- Pengecualian audit docs-site: `braces` kedaluwarsa 2026-11-03, `tinypool` 2026-11-06.
