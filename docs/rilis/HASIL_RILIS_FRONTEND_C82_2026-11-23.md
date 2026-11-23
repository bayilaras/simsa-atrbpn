# Hasil rilis frontend C82: pesan batas waktu disposisi, 23 November 2026

Lanjutan `HASIL_RILIS_C82_C81_2026-11-23.md`. Semua waktu dalam UTC (WIB = UTC+7).

Rilis ini hanya membawa frontend dari `main` `c8d33cd`, yaitu PR #207. Backend tetap C82 dan situs panduan tidak berubah. Tidak ada migrasi (journal tetap 55, terakhir `0054_tanggal_diterima_nomor_urut_hidup`), perubahan env, atau kredensial. Sejak `afc1508` tidak ada perubahan di `backend/`. Setelah rilis ini produksi sama dengan `main`.

## Isi rilis

| Bagian | Sebelum | Sesudah |
|---|---|---|
| "Batas waktu" disposisi di Tambah Surat Masuk, tanggal yang sudah lewat | Simpan tertahan oleh balon bawaan peramban dalam bahasa peramban; pesan aplikasi tidak tampil | **Batas waktu tidak boleh sebelum hari ini** tampil di bawah isian dan di kotak galat, sama dengan penolakan server |

Atribut `min` pada isian dipertahankan agar pemilih tanggal tidak menawarkan tanggal lampau. Pemeriksaan yang sama berjalan sebelum kirim, hanya bila ada unit tujuan. Dialog Disposisi di halaman detail tidak berubah.

PR #207 juga memuat dua hal yang tidak memengaruhi produksi: tes `scripts/ops/neon-role-rotation.postgres.test.mjs` kini memakai port yang sudah dipastikan kosong dan menyertakan log server saat gagal, dan laporan rilis C82/C81.

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge | #207 disetujui efanwahyu pada `c27d04e` dan auto-merge sebagai `c8d33cd` | 03:07:07 |
| CI `main` | Run `45104051554` lulus seluruhnya pada `c8d33cd`, pada percobaan pertama | lulus sebelum promosi |
| Target rollback | C81 `dpl_G74gVgzqfuWaoN27KXuA1Sm2pPja`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±03:08 |
| Sumber rilis | `release-source.mjs prepare` pada `c8d33cd`: 1.689 berkas, manifest `1e221e7838363f31376bc89a01ed83d52c9c994f65f7e3fe3fa63a5dbb77e321`, 55 migrasi | ±03:07 |
| Kandidat frontend C82 | `dpl_vVbKP7n1ofFBHtBnLedTEL3m3oQ2` Ready. Verifikasi sumber lulus: lint dan 254 berkas uji. Precache 161 entri (2.803,03 KiB) | 03:08–03:16 |
| Promosi frontend C82 | Sukses, alias produksi menunjuk kandidat. `release-smoke.mjs frontend` 7/7 dengan bundel `index-zIxQmLSD.js` dan proxy `/api`; `release-smoke.mjs backend` 7/7 | 03:21:30–03:21:37 |
| Operations Monitor | Run manual `45105572191` sukses | ±03:23 |

## Pemeriksaan dengan akun

Pemeriksaan dilakukan dengan akun Admin Unit di produksi setelah memuat versi baru lewat pemberitahuan "Versi baru SIMSA tersedia". Tidak ada data yang disimpan.

| Bagian | Hasil |
|---|---|
| Tambah Surat Masuk, satu unit tujuan disposisi dipilih, Batas waktu tiga hari lalu, Simpan | Simpan tertahan. **Batas waktu tidak boleh sebelum hari ini** tampil di bawah isian dan di kotak galat; isian bertanda tidak sah. Formulir dibatalkan dan jumlah surat masuk unit tidak berubah |
| Login setelah backend C82 (`better-auth` 1.7.25) | Akun Admin Unit masuk lewat halaman login setelah backend C82 berjalan, dan sesinya dipakai untuk pemeriksaan ini. Laporan C82/C81 mencatat login dengan akun nyata belum dicoba; catatan ini menutupnya |
| Rilis C80: pita unit pengawas di Lacak Surat | Rangkaian yang dicatat unit sendiri tampil tanpa pita; rangkaian unit lain tetap menampilkan "Anda melihat surat ini sebagai unit pengawas." |
| Rilis C80: jejak navigasi | `/surat/masuk/edit/<id>` "Dashboard › Surat › Masuk › Edit", `/surat/keluar/edit/<id>` "Dashboard › Surat › Keluar › Edit", `/arsip/detail/<id>` "Dashboard › Arsip › Detail" (pada halaman arsip tidak ditemukan, karena unit ini belum memiliki arsip) |

Format batas waktu di tabel "Status Tindak Lanjut per Penerima" (rilis C80) tetap belum terlihat di layar: produksi belum memiliki disposisi berbatas waktu. Perubahan itu hanya dicakup uji otomatis.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_FySJXuBtFFwCgAcgdJeLgSJsYJGq` (C82) | `main` `afc1508` | C81 `dpl_4hiAhcBDjEsQqi3oQKf1e8KBZ7x6` |
| Frontend | `dpl_vVbKP7n1ofFBHtBnLedTEL3m3oQ2` (C82) | `main` `c8d33cd` | C81 `dpl_G74gVgzqfuWaoN27KXuA1Sm2pPja` |
| Situs panduan | `dpl_G9jKwhaQV2XBNxwAMmTirbbXkY4t` | `main` `97d5881` | `dpl_G4yU6a8TCJdpeqMhp9yQ74ZTEUD1` |

Rollback frontend ke C81 tidak memerlukan perubahan backend. Skema database dan env produksi tidak berubah.
