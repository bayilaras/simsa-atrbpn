# Hasil rilis frontend C89: nilai perubahan di Audit Log dan nama penyaring Aksi, 25 November 2026

Lanjutan `HASIL_RILIS_FRONTEND_C88_2026-11-25.md`. Semua waktu dalam UTC (WIB = UTC+7); rilis berlangsung 26 November pagi WIB.

Rilis ini membawa frontend dan situs panduan dari `main` `172060d`, yaitu PR #222. Backend tetap C85. Tidak ada migrasi (journal tetap 56, terakhir `0055_surat_diimpor_at`), perubahan env, atau kredensial. Sejak `418f15a` tidak ada perubahan di luar `frontend/` dan `docs-site/`. Laporan C88 (PR #221) digabung sesudah rilis ini sebagai `d0ff751` dan hanya menambah dokumentasi, jadi produksi tetap sama dengan `main`.

## Isi rilis

Kedua hal ini terlihat saat pemeriksaan C88 dengan akun di produksi.

| Bagian | Sebelum | Sesudah |
|---|---|---|
| Audit Log, nilai di Detail Perubahan | Nilai sebelum dan sesudah ditulis mentah: `null`, `true`, waktu seperti `2026-10-20T15:13:21.652927+00:00`, dan `[object Object]` untuk objek | Nilai kosong ditulis "(kosong)", ya/tidak ditulis "Ya" atau "Tidak", daftar dipisah koma, tanggal ditulis "2 Januari 2026", waktu ditulis "20 Okt 2026, 22.13.21 WIB", dan objek ditulis sebagai JSON. Teks biasa dan angka tidak berubah. Nilai aslinya tetap muncul saat kursor diarahkan ke nilai itu |
| Audit Log, penyaring Aksi | Tidak punya nama untuk pembaca layar | Bernama "Aksi", sama seperti penyaring Jenis Data |
| Situs panduan | Halaman Audit Log belum menjelaskan cara nilai ditulis | Halaman Audit Log dan catatan perubahan November diperbarui |

Teks yang hanya mirip tanggal dan tanggal yang tidak ada di kalender ditulis apa adanya. Ekspor Excel tidak berubah, karena berkasnya memang tidak memuat nilai sebelum dan sesudah.

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge #222 | Disetujui efanwahyu pada `60c2e99` (21:46:53). Setelah pemeriksaan terakhir lulus, digabung sebagai `172060d` | 21:56:31 |
| CI `main` | Run `45708881728` lulus seluruhnya pada `172060d`, pada percobaan pertama | 21:56–22:07 |
| Sumber rilis | `release-source.mjs prepare` pada `172060d`: 1.803 berkas, manifest `57a30c327fcd60f8aeb1f38131f72af796db4ab4255e47d540fc0c70aa329a31`, 56 migrasi | ±21:57 |
| Target rollback | Frontend C88 `dpl_2X81JPrrNzsy7uYL3KherhsSAgFA` dan situs panduan `dpl_HgTJycQ4mf1varbxvb8bzuJG5JcD`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±21:58 |
| Kandidat frontend C89 | `dpl_9H8B3eXvZTU1n54qNsicGmZWGjiD` Ready. Verifikasi sumber lulus: lint dan 281 berkas uji (1.998 uji). Precache 163 entri (2.836,53 KiB) | 21:59–22:08 |
| Promosi frontend C89 | Sukses, alias produksi menunjuk kandidat | 22:08:32–22:08:38 |
| Uji asap | `release-smoke.mjs frontend` 7/7 dengan bundel `index-BIqMixJu.js` dan proxy `/api`; `release-smoke.mjs backend` 7/7 | 22:08:43–22:08:47 |
| Operations Monitor | Run manual `45710693059` sukses | 22:08:54–22:09:09 |
| Log produksi | Tidak ada entri tingkat error dalam 15 menit terakhir, di proyek backend maupun frontend | ±22:09 |
| Situs panduan | `dpl_BhqHaVAnKAD8XAD2ZXYj6fBXrTY1` Ready dan langsung menjadi produksi | 22:09:23–22:10:49 |
| Merge #221 | Laporan C88. Cabangnya disesuaikan dengan `main` setelah #222 masuk; persetujuan pada `a4d6355` (21:46:36) tetap berlaku karena isi perubahannya sama. Digabung sebagai `d0ff751` | 22:11:55 |

## Pemeriksaan di produksi

Tanpa login, segera setelah promosi:

| Bagian | Hasil |
|---|---|
| Bundel yang dilayani | `index-BIqMixJu.js`. Halaman masuk tampil tanpa galat di konsol peramban |
| Peralihan dari C88 | Tab yang masih memuat bundel C88 menampilkan "Versi baru SIMSA tersedia. Simpan pekerjaan Anda, lalu muat ulang."; tombol **Muat ulang** memindahkannya ke bundel baru |
| Berkas halaman Audit Log | `AuditLog-DO8mWdML.js` memuat "(kosong)", penulis waktu berzona `Asia/Jakarta`, dan nama "Aksi" pada penyaring |
| Rute yang dilindungi | Menjawab 401 tanpa sesi, lewat backend langsung dan lewat proxy `/api` frontend |
| Situs panduan | `/administrasi/audit-log` memuat penjelasan "(kosong)", waktu dalam WIB, dan petunjuk mengarahkan kursor; `/perubahan-november-2026` memuat catatan bahwa nilai ikut dirapikan |

Dengan akun Super Admin, 22:19–22:21. Tidak ada data yang disimpan: selain proses masuk, peramban hanya mengirim permintaan baca.

| Bagian | Hasil |
|---|---|
| Penanda impor | Catatan `system:tandai-surat-impor` tertulis "(kosong) → 20 Okt 2026, 22.13.21 WIB". Nilai aslinya (`null` dan waktu ISO) muncul saat kursor diarahkan ke nilai |
| Nilai kosong dan daftar | Pada halaman pertama catatan Mengubah sampai 24 November (50 catatan, 227 nilai): teks kosong dan daftar kosong tertulis "(kosong)"; daftar disposisi tertulis sebagai nama unit, tanpa kurung siku |
| Tanggal | Pada halaman yang sama, 21 nilai tanggal tertulis seperti "23 November 2026", antara lain Tanggal Surat, Tanggal Diterima, Tanggal Mulai, dan Tanggal Selesai |
| Ya/tidak | Pada halaman yang sama, 36 nilai tertulis "Ya" atau "Tidak" |
| Teks biasa | Pada halaman yang sama, 160 nilai tampil sama seperti aslinya |
| Nilai mentah | Tidak ada lagi `null`, `true`, `false`, tanggal ISO, atau `[object Object]` pada tiga halaman yang diperiksa (semua aksi, Mengubah, dan Mengubah sampai 24 November) |
| Penyaring | Kedua penyaring punya nama: "Jenis data" dan "Aksi" |
| Konsol peramban | Tanpa galat selama pemeriksaan |

Satu hal terlihat saat pemeriksaan dan tidak diubah di rilis ini: sebagian nama isian masih berbahasa Inggris karena ditulis dari nama kolomnya, misalnya "Due Date", "Return Date", "Can Receive Distribution", dan "Email Notifications".

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_4XKGQ4gcnfqwYBGgrHpTZx5SKWJU` (C85) | `main` `24d0fc8` | C84 `dpl_Dh672qtmRbuesVQGAYeCvcajyewm` |
| Frontend | `dpl_9H8B3eXvZTU1n54qNsicGmZWGjiD` (C89) | `main` `172060d` | C88 `dpl_2X81JPrrNzsy7uYL3KherhsSAgFA` |
| Situs panduan | `dpl_BhqHaVAnKAD8XAD2ZXYj6fBXrTY1` | `main` `172060d` | `dpl_HgTJycQ4mf1varbxvb8bzuJG5JcD` |

Rollback frontend ke C88 dan rollback situs panduan tidak saling bergantung dan tidak memerlukan perubahan backend. Rilis ini hanya mengubah tampilan: tidak ada rute, isian permintaan, atau data di peramban yang bertambah. Skema database dan env produksi tidak berubah.
