# Hasil rilis frontend C70, 15 November 2026

Lanjutan `HASIL_RILIS_C76_C69_C77_2026-11-15.md`. Semua waktu dalam UTC (WIB = UTC+7).

Rilis ini hanya frontend, dari `main` `f1236ac` (PR #168). Backend tetap C77 `dpl_9jBetQBsDNME9PCUXiFvwK2ZYoLK` dan situs dokumen tidak berubah. Tidak ada migrasi, perubahan env, atau kredensial yang dicatat.

## Isi rilis

**PR #168** memperbaiki dua temuan kecil dari pemeriksaan C77/C69 dengan akun.

| Bagian | Perubahan |
|---|---|
| Audit Log | Aksi `verify_integrity`, `view`, `download`, `hold`, dan `release_hold` kini berlabel Memeriksa Integritas, Melihat, Mengunduh, Menerapkan Legal Hold, dan Melepas Legal Hold. Filter aksi memuat Menjalankan Pemindai dan Memeriksa Integritas |
| Dosir | Pilihan unit "Semua Unit Kerja" tidak lagi menyebut "hanya lihat", karena aksi per dosir mengikuti hak tulis unit milik dosir |

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge | PR #168 disetujui efanwahyu, digabung sebagai `f1236ac`. CI `push` `43717036141` sukses. Job backend PR ini sempat gagal karena worker vitest mati dengan SIGTRAP di runner, lalu lulus saat dijalankan ulang | 13:03:58 |
| Sumber rilis | `release-source.mjs prepare` pada `f1236ac`: 1.653 berkas, manifest `f900b948d25f212e0657c4b6bba9b056e14173d534e3b319d19ecd7c56caff6d`, 54 migrasi | ±13:09 |
| Target rollback | C69 `dpl_5p7y1eDfibKHyspRvoR4A4qwC2rs`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±13:09 |
| Kandidat frontend C70 | `dpl_9BUxLY7fZGQ9PjibMEAMhQMRKu7p` Ready. Verifikasi sumber lulus: 1.693 uji. Precache 159 entri (2.762,49 KiB) | 13:10–13:19 |
| Promosi | Sukses. `simsa-frontend.vercel.app` → `dpl_9BUxLY7fZGQ9PjibMEAMhQMRKu7p` | 13:19:46 |
| Smoke frontend | `release-smoke.mjs frontend` 7/7, termasuk bundel `index-wOOEII7M.js` dan proxy `/api` | ±13:20 |

## Pemeriksaan setelah promosi

- **Pemberitahuan versi baru:** tab yang masih membuka C69 menampilkan "Versi baru SIMSA tersedia. Simpan pekerjaan Anda, lalu muat ulang." dengan tombol Nanti dan Muat ulang. Halaman tidak memuat ulang sendiri, dan setelah Muat ulang ditekan tab memakai `index-wOOEII7M.js`.
- **Sesi:** sesi di tab yang menganggur lebih dari 35 menit sudah berakhir, sehingga perlu masuk lagi. Ini sesuai aturan sesi C76.
- **Audit Log** (akun Super Admin): label Memeriksa Integritas tampil 31 kali di halaman pertama, dan kode `verify_integrity` tidak tampil lagi.
- **Dosir:** pemilih unit menampilkan "Semua Unit Kerja", dan petunjuk "Pilih unit kerja terlebih dahulu untuk membuat dosir." tetap ada.
- **Konsol peramban:** tidak ada error.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_9jBetQBsDNME9PCUXiFvwK2ZYoLK` (C77) | `main` `0066ce4` | C76 `dpl_FMM7nHQRinaKn9Mpn5SVo8uFPfSE` |
| Frontend | `dpl_9BUxLY7fZGQ9PjibMEAMhQMRKu7p` (C70) | `main` `f1236ac` | C69 `dpl_5p7y1eDfibKHyspRvoR4A4qwC2rs` |
| Situs dokumen | `dpl_4kiJPaWVvFWjLY7n49W22MnvSfAM` | `main` `bf1e79a` | `dpl_CDgDgmrYZuSG2WhczPKYJkaKuF71` (13 November) |

C70 dan C69 sama-sama berjalan dengan backend C77, jadi rollback frontend tidak perlu disertai rollback backend.

## Lain-lain

Dokumen skenario UAT diselaraskan dengan perilaku produksi setelah #161 dan #163: kini 172 skenario, 106 di antaranya Wajib.
