# Hasil rilis C52 dan pantauan 4–5 Oktober 2026

Lanjutan `HASIL_RILIS_C50_C51_2026-10-04.md`. Semua waktu dalam UTC (WIB = UTC+7). Kredensial tidak pernah dicatat; `CRON_SECRET` dibuat dan dipasang oleh operator lewat Vercel CLI tanpa nilainya ditampilkan.

## Pantauan 4–5 Oktober

Pantauan read-only per jam (`/ready`, status pemindai, workflow GitHub, galat runtime) selama laptop operator menyala, dari 4 Okt 16:03 sampai 5 Okt 13:37:

- `/ready` backend dan frontend selalu 200; 0 log `error`/`fatal` di setiap jendela satu jam.
- Recovery terjadwal 5 Okt sukses 05:34 dari `fd60845`, run terjadwal pertama dengan helper PR #30. Fixity terjadwal sukses 06:14.
- Jadwal GitHub Actions tertunda berjam-jam: monitor per jam hanya berjalan 19:41, 23:16, dan 02:08, lalu tidak berjalan sampai dijalankan manual 09:18; recovery terjadwal 00:15 baru berjalan 05:34 dan fixity 00:45 baru berjalan 06:14. Bukti backup (36 jam) dan tenggang fixity (26 jam) menampung keterlambatan ini.

## Temuan: wake pemindai tidak memperpanjang masa berlaku

Monitor manual 09:18 membangunkan pemindai (`lastSeenAt` 09:18:41), tetapi `definitionsExpiresAt` tetap 14:44. Penyebab: Freshclam hanya berjalan setelah lease 24 jam habis, dan definisi bawaan build C51 (14:44 tanggal 4) baru berumur kurang dari 24 jam. Aturan wake "sisa < 6 jam" dari PR #32 karenanya tidak efektif sebelum lease habis. Ditambah jadwal GitHub yang tertunda, `/ready` dapat menjadi 503 setelah lease habis sampai ada wake berikutnya.

## PR #35 dan rilis C52

| Langkah | Hasil | Waktu |
|---|---|---|
| PR #35 | Refresh definisi bila sisa lease < 13 jam (`MALWARE_DEFINITION_REFRESH_BEFORE_MS`); refresh dini yang gagal memakai definisi yang masih sah dan menunda percobaan 1 jam; `GET /api/operations/scanner-wake` untuk Vercel Cron (`Bearer $CRON_SECRET`); dua cron harian 03:07 dan 15:07 UTC di `backend/vercel.json`. CI 9/9 hijau, approve efanwahyu, merge `ad52a56` | 5 Okt |
| `CRON_SECRET` | Ditambahkan operator (Production, sensitive); diverifikasi berdasarkan nama dan tipe saja | ~13:1x |
| Kandidat C52 | `dpl_2HgoJXohLLFHgQNvbLFpMmWxnKXP` dari `git archive ad52a56` (1.621 file, manifest `125e58ba458345031f506eff5f4709fe421cc05dfb649034c0d824aa2916aeeb`); `tsc` bersih, 268 berkas / 3.900 test lulus | build 13:32 |
| Promosi | `simsa-backend.vercel.app` → C52 | 13:36 |

Smoke: `/ready` backend dan lewat proxy 200 (pertama 3,5 s karena *cold start*), `/health` 200, `GET`/`POST /api/operations/scanner-wake` tanpa token atau dengan token salah 401, 0 galat runtime.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_2HgoJXohLLFHgQNvbLFpMmWxnKXP` (C52) | `main` `ad52a56` | C51 `dpl_BCwR7GLsZSgfiYq9MuYLVaJuJTkd` |
| Frontend | `dpl_8P7cMrmofdfhLEWFFQ9YwoRov7fP` (C50) | `main` `737877e` | C49 `dpl_8ysikCmaEigc9YGeREerdkJsen53` |

Database tidak berubah (51 migrasi).

## Belum terverifikasi saat dokumen ini disusun

- Lease definisi C51/C52 habis 5 Okt 14:44. Pemicu berikutnya: monitor yang dijadwalkan operator 14:50 dan **cron Vercel pertama 15:07**. Bukti yang diharapkan: `definitionsExpiresAt` bergeser ke sekitar 6 Okt 15:xx dan log `GET /api/operations/scanner-wake` 202 dari cron.
- Daftar cron di Vercel → simsa-backend → Settings → Cron Jobs memuat dua entri `/api/operations/scanner-wake` (`7 3 * * *`, `7 15 * * *`).

## Sisa

- Dua uji akun direktorat (`HASIL_UJI_ASAP_INTEGRASI_SURAT_2026-10-04.md`), sign-off, dan catatan rilis TU.
- Store Blob lama `simsa-files` (publik, 24 objek): periksa rujukan database lalu putuskan arsip/hapus dan putuskan sambungan dari `simsa-backend`.
- Salin Backup #2 dan #3 ke luar laptop.
- Pengecualian audit `braces` kedaluwarsa 2026-11-03.
