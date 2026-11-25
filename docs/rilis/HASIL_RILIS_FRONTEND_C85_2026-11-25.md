# Hasil rilis frontend C85: baris per halaman Surat Keluar dan kalimat peringatan, 25 November 2026

Lanjutan `HASIL_RILIS_C83_C84_2026-11-24.md`. Semua waktu dalam UTC (WIB = UTC+7); rilis berlangsung 25 November pagi WIB.

Rilis ini membawa frontend dari `main` `6610eea`, yaitu PR #215 dan PR #212. Backend tetap C83 dan situs panduan tidak berubah. Tidak ada migrasi (journal tetap 55, terakhir `0054_tanggal_diterima_nomor_urut_hidup`), perubahan env, atau kredensial. Sejak `ec42ea1` tidak ada perubahan di luar `frontend/`. Setelah rilis ini produksi sama dengan `main`.

## Isi rilis

| Bagian | Sebelum | Sesudah |
|---|---|---|
| Daftar Surat Keluar (PR #215) | Saat kembali dari halaman detail, filter, pencarian, dan nomor halaman dipulihkan, tetapi pilihan "Baris per halaman" kembali ke 10. Nomor halaman yang dipulihkan lalu menampilkan baris yang berbeda | Pilihan "Baris per halaman" ikut disimpan dan dipulihkan. Nilai tersimpan yang bukan salah satu pilihan (10, 25, 50, 100) diabaikan |
| Kalimat di empat kotak peringatan (PR #212) | Kalimat yang memuat teks tebal terpecah menjadi beberapa baris, misalnya "Anda masuk sebagai" / nama peran / lanjutan kalimat di halaman Panduan | Kalimat tampil sebagai satu paragraf: halaman Panduan (sebelum dan sesudah masuk), pesan berhasil di formulir Surat Masuk dan Surat Keluar, serta kode JRA terpilih di dialog arsip |

Kekurangan pada daftar Surat Keluar ditemukan saat pemeriksaan C84 dengan akun di produksi, beberapa jam setelah rilis sebelumnya. Daftar Surat Masuk tidak punya pilihan baris per halaman, jadi tidak berubah.

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge #215 | Disetujui efanwahyu pada `7be2b85` (00:50:47) dan digabung sebagai `2c0b225` | 00:51:19 |
| Merge #212 | Disetujui pada `d63543e` (00:50:42), tetapi cabangnya tertinggal dari `main`. Setelah disesuaikan (`8a40570`) persetujuan lama gugur dan efanwahyu menyetujui lagi (01:01:01). Digabung otomatis sebagai `6610eea` begitu pemeriksaan terakhir lulus | 01:04:56 |
| CI `main` | Run `45523041919` lulus seluruhnya pada `6610eea`, pada percobaan pertama | 01:04–01:16 |
| Sumber rilis | `release-source.mjs prepare` pada `6610eea`: 1.752 berkas, manifest `30e4615470193cc58ae2a5640bb49ed03b0aa7808a7654baf00640b942e3fc65`, 55 migrasi | ±01:05 |
| Target rollback | Frontend C84 `dpl_FeqfVyUMxCshXh6EvD4wDoQzPY76`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±01:06 |
| Kandidat frontend C85 | `dpl_3NXDFB4Qm98BWNsSAuDFEgjmzg47` Ready. Verifikasi sumber lulus: lint dan 260 berkas uji (1.787 uji). Precache 161 entri (2.807,03 KiB) | 01:08–01:19 |
| Promosi frontend C85 | Sukses, alias produksi menunjuk kandidat. `release-smoke.mjs frontend` 7/7 dengan bundel `index-ZMkbUgtG.js` dan proxy `/api`; `release-smoke.mjs backend` 7/7 | 01:20:11–01:20:18 |
| Operations Monitor | Run manual `45525011654` sukses | 01:20:28–01:20:43 |
| Log backend | Tidak ada entri tingkat error dalam 15 menit terakhir | ±01:22 |

## Pemeriksaan di produksi

Pemeriksaan dilakukan tanpa login. Tidak ada data yang disimpan.

| Bagian | Hasil |
|---|---|
| Bundel yang dilayani | `index-ZMkbUgtG.js`, tanpa galat di konsol peramban |
| `/panduan` sebelum masuk | Kotak "Panduan ini mengikuti kewenangan pengguna" berisi satu paragraf |

Belum diperiksa dengan akun nyata pada rilis ini: pemulihan "Baris per halaman" di daftar Surat Keluar, kalimat peran di `/panduan` setelah masuk, pesan berhasil di kedua formulir surat, dan kode JRA terpilih di dialog arsip. Semuanya tercakup uji otomatis yang dijalankan saat build kandidat.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_3jRMQ2kHg2v49XvNrcp2jH9LComQ` (C83) | `main` `ec42ea1` | C82 `dpl_FySJXuBtFFwCgAcgdJeLgSJsYJGq` |
| Frontend | `dpl_3NXDFB4Qm98BWNsSAuDFEgjmzg47` (C85) | `main` `6610eea` | C84 `dpl_FeqfVyUMxCshXh6EvD4wDoQzPY76` |
| Situs panduan | `dpl_E65itgYygjucvTkHxdwVDjTZQV4Q` | `main` `ec42ea1` | `dpl_DwCZjCBCqdHNNME5SXSX8LeunFPt` |

Rollback frontend ke C84 tidak memerlukan perubahan backend. Frontend C84 mengabaikan nilai "baris" yang tersimpan di `sessionStorage`, jadi rollback tidak perlu membersihkannya. Skema database dan env produksi tidak berubah.
