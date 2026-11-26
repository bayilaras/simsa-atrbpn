# Hasil rilis backend C86: pengukuran memori pemindai saat proses turunan keluar, 26 November 2026

Lanjutan `HASIL_RILIS_FRONTEND_C90_2026-11-26.md`. Semua waktu dalam UTC (WIB = UTC+7); rilis berlangsung 26 November pagi WIB.

Rilis ini membawa backend dari `main` `8f5bbde`, yaitu PR #226. Frontend tetap C90 dan situs panduan tidak berubah. Tidak ada migrasi (journal tetap 56, terakhir `0055_surat_diimpor_at`), perubahan env, atau kredensial. Sejak `9d9737b` tidak ada perubahan di `frontend/` maupun `docs-site/`. Laporan C90 (PR #225) digabung sesudah rilis ini sebagai `ee170d2` dan hanya menambah dokumentasi, jadi produksi tetap sama dengan `main`.

## Isi rilis

Perbaikan atas gangguan pemindai pada rilis C90 (`/ready` 503 dari 00:16:39 sampai 00:19:38).

| Bagian | Sebelum | Sesudah |
|---|---|---|
| Pengawas proses ClamAV (backend) | Proses turunan yang sedang keluar terbaca dengan status berjalan tanpa baris `VmRSS` selama beberapa saat sebelum menjadi zombie. Pengawas menganggapnya pengukuran memori yang gagal (`descendant_rss_missing`) dan menghentikan seluruh run | Proses turunan seperti itu diterima sebagai sudah melepas memorinya bila ada buktinya: kernel menandainya sedang keluar (`PF_EXITING` pada `/proc/<pid>/stat`), statusnya zombie atau mati, atau prosesnya sudah hilang. Tanpa bukti itu run tetap dihentikan seperti sebelumnya |
| Operations Monitor (skrip di `main`, bukan bagian deployment) | Setelah membangunkan pemindai (`scheduled`), monitor berhenti pada probe sehat pertama, saat lease lama masih berlaku. Run monitor pada 00:16 berakhir sukses tiga detik setelah run pemindai yang dipicunya gagal | Monitor mem-probe empat kali berjarak 20 detik, dan sampai enam kali selama keadaannya belum sehat. Berlaku sejak #226 digabung pada 01:03:19 |
| Dokumen operasi antivirus | Belum menjelaskan kedua hal di atas | `docs/OPERASI_ANTIVIRUS_BITSTREAM.md` diperbarui |

Aturan `/ready` tidak diubah: run pemindai yang gagal pada deployment aktif tetap membuatnya 503.

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge #226 | Disetujui efanwahyu pada `b446765` (01:02:43) dengan semua pemeriksaan lulus, lalu digabung sebagai `8f5bbde` | 01:03:19 |
| CI `main` | Run `45733079870` lulus seluruhnya pada `8f5bbde`, pada percobaan pertama | 01:03–01:16 |
| Sumber rilis | `release-source.mjs prepare` pada `8f5bbde`: 1.807 berkas, manifest `de0aeea285c648b2b4afb7449e58b5c796f7ee445378b99ada1a2a666b9312c3`, 56 migrasi | ±01:04 |
| Target rollback | Backend C85 `dpl_4XKGQ4gcnfqwYBGgrHpTZx5SKWJU`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±01:04 |
| Kandidat backend C86 | `dpl_opshe34e7wcgfgRjP6cuCNvCahAR` Ready. Verifikasi sumber lulus: pemeriksaan tipe dan 355 berkas uji (5.215 uji lulus, 3 dilewati) | 01:04–01:17 |
| `/ready` sebelum promosi | 200 `ready`; pemindai siap dengan definisi yang berlaku sampai 27 November 00:19:38 | 01:17:27 |
| Promosi backend C86 | Sukses, alias produksi menunjuk kandidat | 01:17:36–01:17:42 |
| Uji asap | `release-smoke.mjs backend` 7/7; `release-smoke.mjs frontend` 7/7 dengan bundel `index-Bl_QTBjs.js` dan proxy `/api` | 01:17:46–01:17:49 |
| Operations Monitor | Run manual `45734822314` sukses, dengan skrip monitor yang baru. `scanner-wake` menjawab `fresh`, jadi satu probe: sehat | 01:18:07–01:18:22 |
| Log produksi | Tidak ada entri tingkat error dalam 15 menit terakhir, di proyek backend maupun frontend | ±01:18 |
| `/ready` sesudah promosi | 200 `ready` pada 01:17:49 dan 01:18:47 | 01:18:47 |
| Merge #225 | Laporan C90. Cabangnya disesuaikan dengan `main` setelah #226 masuk; persetujuan (01:02:33) tetap berlaku. Digabung sebagai `ee170d2` | 01:19:13 |

## Pemeriksaan di produksi

Tanpa login. Tidak ada data yang disimpan.

| Bagian | Hasil |
|---|---|
| Kesiapan | `/ready` 200 `ready` lewat backend langsung dan lewat proxy frontend; database, penyimpanan dokumen, dan pemindai siap |
| Rute yang dilindungi | Menjawab 401 tanpa sesi, lewat backend langsung dan lewat proxy `/api` frontend |
| Monitoring operasional | Probe monitor sehat untuk semua pemeriksaan |

Belum terbukti di produksi: pemindai belum berjalan pada deployment C86 saat laporan ini ditulis. Bukti kesiapan yang dipakai `/ready` masih berasal dari run terakhir pada C85 (00:20:04), dan `scanner-wake` menjawab `fresh` karena definisinya masih berlaku lebih dari 13 jam. Run pertama pada C86 terjadi pada unggahan berkas berikutnya, pada pemeriksaan pemindai dari halaman Monitoring Operasional, atau pada panggilan terjadwal setelah 11:19.

Jendela kernel yang diperbaiki tidak bisa dipicu dengan sengaja. Yang dapat diamati sesudah run pertama hanyalah bahwa pemindaian dan penyegaran definisi berjalan normal; buktinya sendiri ada pada uji dengan `/proc` tiruan (17 uji baru, sembilan di antaranya gagal tanpa perbaikan).

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_opshe34e7wcgfgRjP6cuCNvCahAR` (C86) | `main` `8f5bbde` | C85 `dpl_4XKGQ4gcnfqwYBGgrHpTZx5SKWJU` |
| Frontend | `dpl_BRgRJDdkn6r7fgzGD96jv6mZTaNi` (C90) | `main` `9d9737b` | C89 `dpl_9H8B3eXvZTU1n54qNsicGmZWGjiD` |
| Situs panduan | `dpl_HRb5o1C5moMbuZJo7SuFQvbbQHv9` | `main` `9d9737b` | `dpl_BhqHaVAnKAD8XAD2ZXYj6fBXrTY1` |

Rollback backend ke C85 tidak memerlukan perubahan frontend: rilis ini tidak mengubah rute, isian permintaan, jawaban, atau skema database. Perubahan skrip Operations Monitor ada di `main` dan tidak ikut dibatalkan oleh rollback backend.
