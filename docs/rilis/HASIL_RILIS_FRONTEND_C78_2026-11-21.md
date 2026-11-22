# Hasil rilis frontend C78: label Arsip Lainnya di detail dan pratinjau arsip, 21 November 2026

Lanjutan `HASIL_RILIS_C80_C77_2026-11-21.md`. Semua waktu dalam UTC (WIB = UTC+7).

Rilis ini hanya membawa frontend dari `main` `be44670`, yaitu PR #194. Backend tetap C80, situs panduan tidak berubah. Tidak ada migrasi (journal tetap 55, terakhir `0054_tanggal_diterima_nomor_urut_hidup`), perubahan env, atau kredensial.

## Isi rilis

| Bagian | Perubahan |
|---|---|
| Detail arsip | Arsip jenis `lainnya` berlabel **Arsip Lainnya**. Sebelumnya tampil sebagai Surat Keluar. Tab **Surat Asli** disembunyikan untuk arsip lainnya karena tidak ada surat sumbernya |
| Riwayat detail arsip | Label pembuatan menjadi *Surat Masuk Dibuat* / *Surat Keluar Dibuat* / *Arsip Lainnya Dibuat*. Label lama *Surat Surat Masuk Dibuat* sudah salah sejak sebelum C77 |
| Panel pratinjau arsip | Jenis `lainnya` berlabel Arsip Lainnya, bukan *Belum tercatat*. Pratinjau surat sumber hanya dimuat untuk jenis masuk dan keluar |

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge | #194 disetujui efanwahyu (06:46:20), auto-merge sebagai `be44670`. Review Copilot tidak berjalan (kuota habis) | 06:46:22 |
| Target rollback | C77 `dpl_BJUp8EDBy6FUQK2XtvBe7EMhMKnG`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±06:47 |
| Sumber rilis | `release-source.mjs prepare` pada `be44670`: 1.681 berkas, manifest `3f46d59c41e5d12ddc271e2c8b64b5561a41fcb863f5a409a42a6e9b9be54b80`, 55 migrasi | ±06:48 |
| Kandidat frontend C78 | `dpl_9WHFU67s4u8SepuuP1fftg9kHwhw` Ready. Verifikasi sumber lulus: lint dan 251 berkas uji. Precache 160 entri (2.801,57 KiB) | 06:49–06:57 |
| Promosi frontend C78 | Sukses. `release-smoke.mjs frontend` 7/7, termasuk bundel `index-LvDnUsTf.js` dan proxy `/api` | 06:57:49 |
| Operations Monitor | Run manual `44877994296` sukses | 06:58 |

## Pemeriksaan dengan akun

Pemeriksaan dilakukan dengan akun Super Admin di produksi, hanya membaca, tidak ada data yang disimpan.

| Bagian | Hasil |
|---|---|
| Detail arsip surat masuk (C78) | Riwayat menulis *Surat Masuk Dibuat*, tab Surat Asli tetap tampil. Label Arsip Lainnya belum dapat dilihat karena produksi belum memiliki arsip jenis lainnya; perilakunya dicakup uji `ArsipDetail.jenis.test.jsx` |
| Daftar arsip (C77) | Kartu statistik dan tab Arsip Lainnya tampil |
| Tambah Arsip (C77) | Tombol tampil setelah satu unit kerja dipilih (Super Admin wajib memilih unit). Dialog memuat tiga jenis arsip, No. Filing Cabinet/Laci/Folder wajib, dan pernyataan arsip permanen. Dialog ditutup tanpa menyimpan. Sekretariat Direktorat Jenderal belum memiliki lokasi simpan |
| Lembar Disposisi (C77) | Halaman cetak surat 002/SM/2026 tampil lengkap. Tanggal Diterima berisi `-` untuk surat lama |
| Pengingat peminjaman (C77) | Hitungan `peminjaman` = 0 di semua unit, sesuai data: produksi hanya memiliki satu peminjaman dan sudah dikembalikan. Pengingat yang tampil di lonceng diuji saat UAT |

Pengguna yang sedang membuka aplikasi melihat banner *Versi baru SIMSA tersedia*; bundel baru dipakai setelah **Muat ulang**.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_AxMXfVHPDZ6HxXmSZwdRMkreePNM` (C80) | `main` `d5ca78e` | C79 `dpl_3auuJCLJqATaW9mXGq4emVJxbbQG` |
| Frontend | `dpl_9WHFU67s4u8SepuuP1fftg9kHwhw` (C78) | `main` `be44670` | C77 `dpl_BJUp8EDBy6FUQK2XtvBe7EMhMKnG` |
| Situs panduan | `dpl_G4yU6a8TCJdpeqMhp9yQ74ZTEUD1` | `main` `d5ca78e` | `dpl_C87rrBV7qre51aQnNLgUgD3b5hCW` |

Rollback frontend ke C77 tidak memerlukan perubahan backend. Skema database dan env produksi tidak berubah.
