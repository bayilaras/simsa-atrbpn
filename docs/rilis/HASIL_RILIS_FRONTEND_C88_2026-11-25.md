# Hasil rilis frontend C88: label Audit Log dan isian Disposisi di Perlu Dilengkapi, 25 November 2026

Lanjutan `HASIL_RILIS_C85_C87_2026-11-25.md`. Semua waktu dalam UTC (WIB = UTC+7); rilis berlangsung 26 November dini hari WIB.

Rilis ini membawa frontend dan situs panduan dari `main` `418f15a`, yaitu PR #220. Backend tetap C85. Tidak ada migrasi (journal tetap 56, terakhir `0055_surat_diimpor_at`), perubahan env, atau kredensial. Sejak `24d0fc8` perubahan di luar `frontend/` dan `docs-site/` hanya laporan rilis di `docs/`. Setelah rilis ini produksi sama dengan `main`.

## Isi rilis

Perbaikan tampilan yang tersisa setelah pemeriksaan C85/C87 di produksi.

| Bagian | Sebelum | Sesudah |
|---|---|---|
| Audit Log, nama isian di Detail Perubahan | Kunci ditulis mentah, misalnya `DiimporAt` pada 194 catatan penanda impor. Hanya garis bawah pertama yang diganti spasi | Kunci yang dikenal memakai label ("Penanda impor", "Waktu dibuat", "Unit kerja", dan sejenisnya). Kunci lain ditulis sebagai kata-kata: `nomorSurat` dan `nomor_surat` menjadi "nomor surat" |
| Audit Log, aksi tata kelola retensi | Tiga belas aksi (`retention_event_*`, `appraisal_*`, `transfer_*`) tampil sebagai kode | Berlabel Indonesia, misalnya "Memverifikasi Pemicu Retensi", "Menyetujui Penilaian Arsip", "Menyerahkan Arsip Permanen" |
| Audit Log, penyaring Aksi | Daftar ditulis tangan dan tertinggal dari aksi yang dicatat | Dibangkitkan dari peta label yang sama dengan baris log. Penyaring kini juga memuat Memulihkan, Ubah Status, Melihat, Mengunduh, Menerapkan dan Melepas Legal Hold, serta ketiga belas aksi retensi |
| Perlu Dilengkapi, dialog Disposisi | Dialog dilepas setiap kali ditutup, sehingga unit dan instruksi yang sudah dipilih hilang bila dialog tertutup tidak sengaja | Dialog tetap terpasang untuk surat yang terakhir dibuka. Isian dikosongkan oleh dialognya sendiri saat Batal, saat berhasil, atau saat surat lain dibuka |
| Situs panduan | Halaman Audit Log belum menyebut aksi retensi dan label isian | Tabel aksi dan catatan perubahan November diperbarui |

Uji baru `AuditLog.label-aksi-isian.test.jsx` membaca kode aksi dari sumber backend dan gagal bila ada aksi tanpa label, sehingga aksi baru tidak bisa lagi tertinggal dari penyaring.

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge #220 | Disetujui efanwahyu pada `45dbfca` (14:33:20) dengan 14 pemeriksaan lulus, lalu digabung sebagai `418f15a` | 21:11:41 |
| CI `main` | Run `45702060933` lulus seluruhnya pada `418f15a`, pada percobaan pertama | 21:11–21:23 |
| Sumber rilis | `release-source.mjs prepare` pada `418f15a`: 1.802 berkas, manifest `74a617bb4e343ae18b179042fb3a283960cdb29fa0fce553fb8f4b61408be060`, 56 migrasi | ±21:13 |
| Target rollback | Frontend C87 `dpl_J659Trn5sbTm88EAueAXfjMcFXmh` dan situs panduan `dpl_2fyxpwiGsQ6BtjQyxc8r6byWsrde`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±21:14 |
| Kandidat frontend C88 | `dpl_2X81JPrrNzsy7uYL3KherhsSAgFA` Ready. Verifikasi sumber lulus: lint dan 280 berkas uji (1.995 uji). Precache 163 entri (2.835,78 KiB) | 21:15–21:24 |
| Promosi frontend C88 | Sukses, alias produksi menunjuk kandidat | 21:25:08–21:25:15 |
| Uji asap | `release-smoke.mjs frontend` 7/7 dengan bundel `index-D2288F1K.js` dan proxy `/api`; `release-smoke.mjs backend` 7/7 | 21:25:22–21:25:28 |
| Operations Monitor | Run manual `45704235462` sukses | 21:25:36–21:25:52 |
| Log produksi | Tidak ada entri tingkat error dalam 15 menit terakhir, di proyek backend maupun frontend | ±21:25 |
| Situs panduan | `dpl_HgTJycQ4mf1varbxvb8bzuJG5JcD` Ready dan langsung menjadi produksi | 21:25:54–21:27:36 |

## Pemeriksaan di produksi

Pemeriksaan dilakukan tanpa login. Tidak ada data yang disimpan.

| Bagian | Hasil |
|---|---|
| Bundel yang dilayani | `index-D2288F1K.js`. Halaman masuk dan `/panduan` tampil tanpa galat di konsol peramban |
| Peralihan dari C87 | Tab yang masih memuat bundel C87 menampilkan "Versi baru SIMSA tersedia. Simpan pekerjaan Anda, lalu muat ulang."; tombol **Muat ulang** memindahkannya ke bundel baru |
| Berkas halaman Audit Log | `AuditLog-BBezcC4Y.js` memuat "Penanda impor", "Waktu diperbarui", "Memverifikasi Pemicu Retensi", dan "Menyerahkan Arsip Permanen" |
| Rute yang dilindungi | Menjawab 401 tanpa sesi, lewat backend langsung dan lewat proxy `/api` frontend |
| Situs panduan | `/administrasi/audit-log` memuat baris aksi tata kelola retensi dan "Penanda impor"; `/perubahan-november-2026` memuat isian Disposisi di tab Perlu Dilengkapi dan penyaring Aksi |

Belum diperiksa dengan akun nyata pada rilis ini: label isian dan aksi pada baris Audit Log, isi penyaring Aksi, dan isian dialog Disposisi yang bertahan di tab Perlu Dilengkapi. Semuanya tercakup uji otomatis yang dijalankan saat build kandidat.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_4XKGQ4gcnfqwYBGgrHpTZx5SKWJU` (C85) | `main` `24d0fc8` | C84 `dpl_Dh672qtmRbuesVQGAYeCvcajyewm` |
| Frontend | `dpl_2X81JPrrNzsy7uYL3KherhsSAgFA` (C88) | `main` `418f15a` | C87 `dpl_J659Trn5sbTm88EAueAXfjMcFXmh` |
| Situs panduan | `dpl_HgTJycQ4mf1varbxvb8bzuJG5JcD` | `main` `418f15a` | `dpl_2fyxpwiGsQ6BtjQyxc8r6byWsrde` |

Rollback frontend ke C87 dan rollback situs panduan tidak saling bergantung dan tidak memerlukan perubahan backend. Rilis ini tidak menambah rute, isian permintaan, atau data di peramban. Skema database dan env produksi tidak berubah.
