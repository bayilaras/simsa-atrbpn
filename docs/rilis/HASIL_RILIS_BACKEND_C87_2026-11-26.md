# Hasil rilis backend C87: pelepasan legal hold, 26 November 2026

Lanjutan `HASIL_RILIS_BACKEND_C86_2026-11-26.md`. Semua waktu dalam UTC (WIB = UTC+7); rilis berlangsung 26 November pagi WIB.

Rilis ini membawa backend dari `main` `aa9257ac`, yaitu PR #228. Frontend tetap C90 dan situs panduan tidak berubah. Tidak ada migrasi (journal tetap 56, terakhir `0055_surat_diimpor_at`), perubahan env, atau kredensial. Sejak `9d9737b` tidak ada perubahan di `frontend/` maupun `docs-site/`. Setelah rilis ini produksi sama dengan `main`.

## Isi rilis

Cacat ini ditemukan dari pembacaan kode saat menyusun prosedur pembersihan data UAT, lalu dipastikan dengan uji terhadap database uji. Tidak ada arsip produksi yang terkena: satu-satunya arsip di produksi tidak sedang ditahan.

| Bagian | Sebelum | Sesudah |
|---|---|---|
| Melepas legal hold (`PUT /api/retention/:id/release`) | Selalu dijawab 404 "Arsip tidak ditemukan". Rutenya mensyaratkan arsip boleh diubah, sedangkan arsip yang ditahan tidak pernah boleh diubah. Legal hold yang sudah diterapkan karena itu tidak bisa dilepas lewat aplikasi | Dijawab 200 bagi pengelola arsipnya; legal hold dilepas dan tercatat di Audit Log |
| Menerapkan legal hold pada arsip yang sudah ditahan | Dijawab 404 | Dijawab 409 "Arsip sudah dalam status legal hold." |
| Menerapkan legal hold pada arsip yang sedang diusulkan untuk penyusutan | Dijawab 404 | Diterima, sesuai aturan di layanan; hanya arsip yang penyusutannya sudah dieksekusi yang ditolak (409). Modul Penyusutan nonaktif di produksi, jadi saat ini tidak ada arsip dalam keadaan itu |

Kedua rute legal hold kini memeriksa hak kelola pemilik tanpa melihat keadaan rekod (`canManageRegardlessOfState`), dan menyerahkan pemeriksaan keadaan ke layanan. Yang tidak berubah: arsip yang ditahan tetap terkunci untuk Ubah Metadata, pembatalan tunjuk silang, dan penyusutan. Batas unit, peran baca-saja, dan syarat persetujuan kelola untuk kelas Terbatas ke atas tetap berlaku.

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge #228 | Disetujui efanwahyu pada `2804560` (02:43:14) dengan semua pemeriksaan lulus, lalu digabung sebagai `aa9257ac` | 02:43:46 |
| CI `main` | Run `45744343052` lulus seluruhnya pada `aa9257ac`, pada percobaan pertama | 02:43–02:55 |
| Sumber rilis | `release-source.mjs prepare` pada `aa9257ac`: 1.810 berkas, manifest `545b3d002e16a2da8e0356e0441be6db444cb697e8fc64ab6fce4f3558d1a58f`, 56 migrasi | ±02:44 |
| Target rollback | Backend C86 `dpl_opshe34e7wcgfgRjP6cuCNvCahAR`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±02:44 |
| Kandidat backend C87 | `dpl_3WijRbbhExvKECRneLU1pmvpU2BM` Ready. Verifikasi sumber lulus: pemeriksaan tipe dan 356 berkas uji (5.224 uji lulus, 3 dilewati), termasuk uji legal hold yang baru | 02:44–02:57 |
| `/ready` sebelum promosi | 200 `ready` | 02:57:44 |
| Promosi backend C87 | Sukses, alias produksi menunjuk kandidat | 02:57:44–02:57:50 |
| Uji asap | `release-smoke.mjs backend` 7/7; `release-smoke.mjs frontend` 7/7 dengan bundel `index-Bl_QTBjs.js` dan proxy `/api` | 02:57:54–02:57:58 |
| Operations Monitor | Run manual `45745865951` sukses. `scanner-wake` menjawab `fresh`, jadi satu probe: sehat | 02:58:08–02:58:22 |
| Log produksi | Tidak ada entri tingkat error dalam 15 menit terakhir, di proyek backend maupun frontend | ±02:58 |
| `/ready` sesudah promosi | 200 `ready` pada 02:57:58 dan 02:58:46 | 02:58:46 |

## Pemeriksaan di produksi

Tanpa login. Tidak ada data yang disimpan.

| Bagian | Hasil |
|---|---|
| Kesiapan | `/ready` 200 `ready` lewat backend langsung dan lewat proxy frontend |
| Rute yang dilindungi | Menjawab 401 tanpa sesi, lewat backend langsung dan lewat proxy `/api` frontend |
| Monitoring operasional | Probe monitor sehat untuk semua pemeriksaan |

Belum dicoba di produksi: menerapkan lalu melepas legal hold pada arsip nyata. Produksi hanya punya satu arsip, yaitu arsip QA yang dipakai skenario UAT, dan percobaan itu tercatat di Audit Log atas akun yang menjalankannya. Buktinya saat ini adalah uji rute di atas database uji, yang juga dijalankan saat build kandidat ini.

Pemindai dokumen belum berjalan pada deployment C87. Bukti kesiapannya berasal dari run pada C86 (01:28:03) dan berlaku sampai 27 November 01:16:37.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_3WijRbbhExvKECRneLU1pmvpU2BM` (C87) | `main` `aa9257ac` | C86 `dpl_opshe34e7wcgfgRjP6cuCNvCahAR` |
| Frontend | `dpl_BRgRJDdkn6r7fgzGD96jv6mZTaNi` (C90) | `main` `9d9737b` | C89 `dpl_9H8B3eXvZTU1n54qNsicGmZWGjiD` |
| Situs panduan | `dpl_HRb5o1C5moMbuZJo7SuFQvbbQHv9` | `main` `9d9737b` | `dpl_BhqHaVAnKAD8XAD2ZXYj6fBXrTY1` |

Rollback backend ke C86 tidak memerlukan perubahan frontend: rilis ini tidak mengubah rute, isian permintaan, jawaban, atau skema database. Sebelum rollback, lepas dulu setiap legal hold yang diterapkan selama C87 aktif; pada C86 permintaan pelepasan kembali dijawab 404.
