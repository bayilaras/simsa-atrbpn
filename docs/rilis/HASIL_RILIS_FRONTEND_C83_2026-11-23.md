# Hasil rilis frontend C83 dan situs panduan: halaman Panduan ringkas, 23 November 2026

Lanjutan `HASIL_RILIS_FRONTEND_C82_2026-11-23.md`. Semua waktu dalam UTC (WIB = UTC+7); rilis berlangsung 24 November dini hari WIB.

Rilis ini membawa situs panduan dan frontend dari `main` `5cfce32`, yaitu PR #210. Backend tetap C82. Tidak ada migrasi (journal tetap 55, terakhir `0054_tanggal_diterima_nomor_urut_hidup`), perubahan env, atau kredensial. Sejak `afc1508` tidak ada perubahan di `backend/`. Setelah rilis ini produksi sama dengan `main`.

Laporan ini juga mencatat penerbitan situs panduan untuk PR #209 (gambar contoh) pada 23 November, yang belum punya laporan sendiri.

## Isi rilis

| Bagian | Sebelum | Sesudah |
|---|---|---|
| Halaman Panduan di aplikasi (`/panduan`), 15 topik | Tiap topik memuat langkah lengkap, yang juga ditulis di situs panduan | Tiap topik berisi 2–3 butir inti, tombol ke halaman aplikasinya, dan tautan "Langkah lengkap dengan gambar" ke halaman situs panduan. Teks topik turun dari sekitar 1.780 kata menjadi 650 kata |
| Masalah umum di `/panduan` | Jawaban tentang baris impor yang ditolak ditulis panjang | Jawaban dipersingkat dengan tautan ke aturan impor; di bawah daftar ada tautan ke Pemecahan masalah di situs |
| Situs panduan, 10 halaman | Beberapa keterangan hanya ada di aplikasi | Keterangan itu dipindahkan ke situs: tiga tab Lacak Surat, bagian Menautkan Surat ke Rangkaian, menu Tindak Lanjut pada surat keluar, Buat ND Penjelas khusus naskah Keputusan, kolom pencarian surat keluar, Super Admin sebagai penyetuju, dan aturan impor surat Rahasia |
| Situs panduan, Surat Masuk | Surat Rahasia dan Sangat Rahasia disebut tetap tampil di daftar bagi semua admin | Hanya surat Terbatas yang tetap tampil; Rahasia dan Sangat Rahasia tidak tampil tanpa persetujuan akses rekod |

Filter peran, pencarian, Mulai dalam 5 langkah, ringkasan menurut peran, istilah penting, dan tips di `/panduan` tidak berubah. Satu kalimat lama dibuang karena sudah tidak benar: impor CSV arsip sekarang memetakan kolom lokasi.

Sejak rilis ini langkah lengkap hanya ditulis di `docs-site/docs`. Uji `frontend/src/pages/UserGuide.test.jsx` gagal bila tautan dari `/panduan` menunjuk halaman atau judul yang tidak ada di sana.

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge | #210 disetujui efanwahyu pada `c558774` (19:54:40) dan digabung sebagai `5cfce32` | 20:55:30 |
| CI `main` | Run `45264355914` lulus seluruhnya pada `5cfce32`, pada percobaan pertama | 20:55–21:08 |
| Target rollback | Situs panduan `dpl_37pf6CSfcyZvrQgLVaEAMxARmpGw` dan frontend C82 `dpl_vVbKP7n1ofFBHtBnLedTEL3m3oQ2`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±21:45 |
| Sumber rilis | `release-source.mjs prepare` pada `5cfce32`: 1.739 berkas, manifest `482f507b88418696c8f8456b18a1149d16fcca83acfd75e1fd91817d97a675b5`, 55 migrasi. Sumber yang sama dipakai untuk situs panduan dan frontend | ±21:44 |
| Situs panduan | `dpl_DwCZjCBCqdHNNME5SXSX8LeunFPt` Ready dan melayani `simsa-atrbpn.vercel.app`. Diterbitkan lebih dulu supaya keterangan yang dipindahkan sudah ada saat halaman ringkas tampil | 21:46–21:48 |
| Periksa situs panduan | Ke-29 alamat yang ditautkan dari `/panduan` (20 halaman) menjawab 200 dan judul tujuannya ada. Bagian baru "Menautkan Surat ke Rangkaian" tampil | ±21:50 |
| Kandidat frontend C83 | `dpl_J37uFMpi72bUZNjH1TLpsN537rUb` Ready. Verifikasi sumber lulus: lint, 254 berkas uji (1.745 uji). Precache 161 entri (2.798,64 KiB) | 21:48–21:59 |
| Promosi frontend C83 | Sukses, alias produksi menunjuk kandidat. `release-smoke.mjs frontend` 7/7 dengan bundel `index-B_BjnCWK.js` dan proxy `/api`; `release-smoke.mjs backend` 7/7 | 22:00:37–22:00:45 |
| Operations Monitor | Run manual `45277625818` sukses | 22:13:42–22:13:58 |

## Pemeriksaan di produksi

Pemeriksaan dilakukan tanpa login, karena `/panduan` dapat dibuka sebelum masuk. Tidak ada data yang disimpan.

| Bagian | Hasil |
|---|---|
| `/panduan`, judul bagian topik | "Ringkasan per fitur" |
| Kotak "Langkah lengkap dengan gambar" | Ada pada ke-15 topik |
| Tautan ke situs panduan | 31 tautan (termasuk tombol "Panduan lengkap" dan tautan di kaki halaman), semuanya membuka tab baru |
| Lebar halaman | Tidak melebar melewati layar |

Tampilan `/panduan` setelah login dengan akun nyata belum diperiksa pada rilis ini. Halamannya sama; hanya topik yang tampil mengikuti peran. Sebelum merge, tampilan itu diperiksa dengan data tiruan sebagai Admin Unit pada lebar 1366 px dan 390 px.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_FySJXuBtFFwCgAcgdJeLgSJsYJGq` (C82) | `main` `afc1508` | C81 `dpl_4hiAhcBDjEsQqi3oQKf1e8KBZ7x6` |
| Frontend | `dpl_J37uFMpi72bUZNjH1TLpsN537rUb` (C83) | `main` `5cfce32` | C82 `dpl_vVbKP7n1ofFBHtBnLedTEL3m3oQ2` |
| Situs panduan | `dpl_DwCZjCBCqdHNNME5SXSX8LeunFPt` | `main` `5cfce32` | `dpl_37pf6CSfcyZvrQgLVaEAMxARmpGw` |

Rollback frontend ke C82 tidak memerlukan perubahan backend. Frontend dan situs panduan dapat dikembalikan sendiri-sendiri tanpa memutus tautan: semua halaman dan judul yang ditautkan dari `/panduan` sudah ada pada deployment situs sebelumnya. Bila hanya situs panduan yang dikembalikan, keterangan yang dipindahkan dari aplikasi tidak tersedia di mana pun sampai situs diterbitkan lagi. Skema database dan env produksi tidak berubah.

## Penerbitan situs panduan untuk PR #209

PR #209 (49 gambar contoh pada 27 halaman situs panduan, diambil dari instance lokal berisi data fiktif) digabung sebagai `263a536` pada 23 November. Situs panduan diterbitkan dari commit itu pada hari yang sama sebagai `dpl_37pf6CSfcyZvrQgLVaEAMxARmpGw`, menggantikan `dpl_G9jKwhaQV2XBNxwAMmTirbbXkY4t`. Ke-70 gambar pada 27 halaman dimuat di situs yang terbit. Backend dan frontend tidak berubah oleh PR itu.
