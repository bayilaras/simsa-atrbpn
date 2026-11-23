# Hasil rilis frontend C80: pesan batas tanggal, jejak navigasi, dan tampilan Alur Surat, 22 November 2026

Lanjutan `HASIL_RILIS_C81_C79_2026-11-22.md`. Semua waktu dalam UTC (WIB = UTC+7); promosi terjadi 23 November pukul 05.46 WIB.

Rilis ini hanya membawa frontend dari `main` `35ce46e`, yaitu PR #201. Backend tetap C81 dan situs panduan tidak berubah. Tidak ada migrasi (journal tetap 55, terakhir `0054_tanggal_diterima_nomor_urut_hidup`), perubahan env, atau kredensial. Sejak `c3d063f` tidak ada perubahan di `backend/`; commit di antaranya hanya menyentuh dokumen dan skrip operasi.

## Isi rilis

Kelima perubahan berasal dari uji pendahuluan UAT dengan dua akun Admin Unit.

| Bagian | Sebelum | Sesudah |
|---|---|---|
| Tanggal Diterima dan Tanggal Surat di luar batas (Tambah Surat Masuk, Tambah Surat Keluar) | Simpan tertahan oleh balon bawaan peramban dalam bahasa peramban; pesan aplikasi tidak pernah tampil | Pesan aplikasi tampil di bawah isian dan di kotak galat. Isian wajib yang kosong tetap ditandai peramban |
| Batas waktu di tabel "Status Tindak Lanjut per Penerima" | `2026-11-24` | `24 Nov 2026`, sama dengan Kotak Masuk |
| Pita "unit pengawas" di Lacak Surat | Tampil juga untuk rangkaian yang dicatat unit sendiri | Hanya untuk rangkaian unit lain |
| Detail Surat Keluar | Dua jejak navigasi | Satu (jejak global) |
| Jejak navigasi `/arsip/detail/<id>` dan `/surat/*/edit/<id>` | "Detail › Detail", "Edit › Detail" | "Detail", "Edit" |

Atribut `min` dan `max` pada isian tanggal dipertahankan agar pemilih tanggal tidak menawarkan tanggal di luar batas. Tier akses rangkaian dari server tidak diubah.

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge | #201 disetujui efanwahyu pada `58b42b5` dengan 14 pemeriksaan lulus, lalu digabung sebagai `35ce46e` | 22:03:33 |
| CI `main` | Run `45075534710` gagal pada percobaan pertama di `scripts/ops/neon-role-rotation.postgres.test.mjs` (`pg_ctl failed`), sehingga tes backend dan frontend dilewati. *Re-run failed jobs* lulus seluruhnya tanpa perubahan kode | 22:05, lulus sebelum promosi |
| Target rollback | C79 `dpl_DpNbhHoepApYHGbHnvXk6Yuh1gRS`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±22:33 |
| Sumber rilis | `release-source.mjs prepare` pada `35ce46e`: 1.685 berkas, manifest `c1f37407d6ee582857b3f8ba2b9c0951b23fc0b8f3dc799cc7ed922448a17c55`, 55 migrasi | ±22:30 |
| Kandidat frontend C80 | `dpl_9gmXknfnB3oZkyvysicTD3Fk3cim` Ready. Verifikasi sumber lulus: lint dan 252 berkas uji. Precache 161 entri (2.802,46 KiB) | 22:34–22:42 |
| Promosi frontend C80 | Sukses, alias produksi menunjuk kandidat. `release-smoke.mjs frontend` 7/7 dengan bundel `index-BVbXBR1A.js` dan proxy `/api`; `release-smoke.mjs backend` 7/7, `/ready` 200 `ready` | 22:46:47–22:46:53 |
| Operations Monitor | Run manual `45079636091` sukses | ±22:50 |

Kegagalan CI pertama tidak terkait isi rilis: tes itu menjalankan PostgreSQL sementara pada port acak 40000–59999 dan gagal saat `pg_ctl start`. Penyebab pastinya belum ditelusuri; tes tersebut belum diubah.

## Pemeriksaan dengan akun

Pemeriksaan dilakukan dengan akun Admin Unit di produksi setelah memuat versi baru lewat pemberitahuan "Versi baru SIMSA tersedia". Tidak ada data yang disimpan.

| Bagian | Hasil |
|---|---|
| Tambah Surat Masuk, Tanggal Diterima sebelum Tanggal Surat | Simpan tertahan dan pesan **Tanggal diterima tidak boleh sebelum tanggal surat** tampil di bawah isian |
| Tambah Surat Masuk, Tanggal Diterima setelah hari ini | Simpan tertahan dan pesan **Tanggal diterima tidak boleh setelah hari ini** tampil |
| Detail Surat Keluar | Satu jejak navigasi: Dashboard › Surat › Keluar › Detail |

Format batas waktu, pita unit pengawas, dan jejak navigasi detail arsip belum diperiksa dengan akun di produksi. Ketiganya dicakup uji otomatis (`AlurSuratPanel.test.jsx`, `AlurSuratPanel.rangkaian-id.test.jsx`, `LacakSurat.test.jsx`, `breadcrumbs.test.jsx`).

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_4hiAhcBDjEsQqi3oQKf1e8KBZ7x6` (C81) | `main` `c3d063f` | C80 `dpl_AxMXfVHPDZ6HxXmSZwdRMkreePNM` |
| Frontend | `dpl_9gmXknfnB3oZkyvysicTD3Fk3cim` (C80) | `main` `35ce46e` | C79 `dpl_DpNbhHoepApYHGbHnvXk6Yuh1gRS` |
| Situs panduan | `dpl_G9jKwhaQV2XBNxwAMmTirbbXkY4t` | `main` `97d5881` | `dpl_G4yU6a8TCJdpeqMhp9yQ74ZTEUD1` |

Rollback frontend ke C79 tidak memerlukan perubahan backend. Skema database dan env produksi tidak berubah.
