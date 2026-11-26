# Hasil rilis frontend C90: nama isian berbahasa Indonesia di Audit Log, 26 November 2026

Lanjutan `HASIL_RILIS_FRONTEND_C89_2026-11-25.md`. Semua waktu dalam UTC (WIB = UTC+7); rilis berlangsung 26 November pagi WIB.

Rilis ini membawa frontend dan situs panduan dari `main` `9d9737b`, yaitu PR #224. Backend tetap C85. Tidak ada migrasi (journal tetap 56, terakhir `0055_surat_diimpor_at`), perubahan env, atau kredensial. Sejak `172060d` perubahan di luar `frontend/` dan `docs-site/` hanya laporan rilis di `docs/`. Laporan C89 (PR #223) digabung sesudah rilis ini sebagai `011cb09` dan hanya menambah dokumentasi, jadi produksi tetap sama dengan `main`.

Saat rilis, pemindai keamanan dokumen sempat tidak siap selama tiga menit. Penyebabnya ada di backend yang tidak diubah rilis ini; lihat [Pemindai keamanan dokumen](#pemindai-keamanan-dokumen).

## Isi rilis

Terlihat saat pemeriksaan C89 dengan akun di produksi.

| Bagian | Sebelum | Sesudah |
|---|---|---|
| Audit Log, nama isian dari kolom berbahasa Inggris | Nama kolom ditulis sebagai kata-kata Inggris: "Due Date", "Return Date", "File Original Name", "Can Receive Distribution", "Email Notifications" | Berlabel Indonesia dengan istilah yang sama seperti halaman lain: "Jatuh tempo", "Tanggal kembali", "Nama berkas asli", "Dapat menerima distribusi", "Notifikasi email". Tabel labelnya memuat 178 nama kolom |
| Audit Log, akhiran teknis | `suratMasukId` tampil sebagai "Surat Masuk Id", `selesaiAt` sebagai "Selesai At" | Pada nama yang tidak ada di tabel, akhiran ditulis sebagai kata: "ID Surat Masuk", "Waktu Selesai" |
| Situs panduan | Belum menyebut nama isian berbahasa Indonesia | Halaman Audit Log dan catatan perubahan November diperbarui |

Nama isian berbahasa Indonesia tidak berubah. Nilai berbahasa Inggris di dalam isian (misalnya nilai status) dan berkas ekspor Excel juga tidak berubah.

Tabel label disusun dari nama isian di seluruh 923 catatan Audit Log produksi pada 25 November. Yang dibaca hanya nama isiannya, bukan nilainya. Dari situ ada 114 nama berbahasa Inggris atau campuran; uji `label-isian-audit.test.js` gagal bila salah satunya tidak berlabel.

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge #224 | Disetujui efanwahyu pada `33bea4f` (25 November 22:35:47) dengan semua pemeriksaan lulus, lalu digabung sebagai `9d9737b` | 00:03:40 |
| CI `main` | Run `45725969855` lulus seluruhnya pada `9d9737b`, pada percobaan pertama | 00:03–00:13 |
| Sumber rilis | `release-source.mjs prepare` pada `9d9737b`: 1.806 berkas, manifest `abfc80ced0ec161f1cd746950b05440a748e6410c79cce60733ff5a0af5d24d6`, 56 migrasi | ±00:04 |
| Target rollback | Frontend C89 `dpl_9H8B3eXvZTU1n54qNsicGmZWGjiD` dan situs panduan `dpl_BhqHaVAnKAD8XAD2ZXYj6fBXrTY1`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±00:05 |
| Kandidat frontend C90 | `dpl_BRgRJDdkn6r7fgzGD96jv6mZTaNi` Ready. Verifikasi sumber lulus: lint dan 282 berkas uji (2.004 uji). Precache 163 entri (2.841,82 KiB) | 00:06–00:15 |
| Promosi frontend C90 | Sukses, alias produksi menunjuk kandidat | 00:15:44–00:15:50 |
| Uji asap, percobaan pertama | `release-smoke.mjs frontend` 6/7: bundel `index-Bl_QTBjs.js` dijawab 200 tetapi bukan sebagai JavaScript. Permintaan itu datang tiga detik setelah promosi dan masih dilayani deployment lama, yang menjawab berkas tak dikenal dengan halaman utama. `release-smoke.mjs backend` 7/7 | 00:15:53–00:15:58 |
| Uji asap, ulangan | `release-smoke.mjs frontend` 7/7 pada empat ulangan berturut-turut; bundel dijawab sebagai `application/javascript` pada lima permintaan langsung | 00:16:04–00:16:18 |
| Operations Monitor | Run manual `45727553049` sukses. Langkah bangun-pemindai di dalamnya memicu gangguan yang dijelaskan di bawah | 00:16:27–00:16:42 |
| Situs panduan | `dpl_HRb5o1C5moMbuZJo7SuFQvbbQHv9` Ready dan langsung menjadi produksi | 00:16:54–00:18:18 |
| Operations Monitor, ulangan | Run manual `45728046479` sukses setelah pemindai pulih | 00:20:34–00:20:48 |
| Log produksi | Backend: satu entri tingkat error, yaitu kegagalan penyegaran definisi pemindai pada 00:16:39. Frontend: tidak ada | ±00:20 |
| Merge #223 | Laporan C89. Cabangnya disesuaikan dengan `main` setelah #224 masuk; persetujuan (25 November 22:35:32) tetap berlaku. Digabung sebagai `011cb09` | 00:22:42 |

## Pemindai keamanan dokumen

`/ready` menjawab 503 dari 00:16:39 sampai 00:19:38. Database dan penyimpanan dokumen tetap siap; yang tidak siap hanya pemindai (`malwareWorker` `not_ready`, alasan `on_demand_refresh_failed`). Pada 00:19:03 antrean pemindaian kosong: tidak ada berkas yang menunggu, gagal, atau terlambat dipindai.

| Waktu | Kejadian |
|---|---|
| 00:15:53–00:16:18 | `/ready` 200 pada kelima uji asap frontend; pemindai siap dengan definisi lama |
| 00:16:38 | Run Operations Monitor memanggil `POST /api/operations/scanner-wake`, dijawab 202 |
| 00:16:39 | Run pemindai yang dipicu panggilan itu gagal pada tahap penyiapan definisi: `Native antivirus execution failed { stage: 'definitions', errorCode: 'scanner_error', reason: 'rss_unavailable', rssFailure: 'descendant_rss_missing' }`. `/ready` mulai menjawab 503 |
| 00:16:42 | Run Operations Monitor selesai dengan status sukses |
| 00:19:03 | Monitoring Operasional di aplikasi menampilkan "gagal" untuk Pemindai keamanan dokumen |
| 00:19:36 | Super Admin menjalankan pemeriksaan pemindai dari halaman Monitoring Operasional; pemindaian internal dijawab 200 |
| 00:20:14 | `/ready` 200. Definisi berlaku sampai 27 November 00:19:38 |

Yang diketahui dari kejadian ini:

- Rilis ini tidak mengubah backend. Pemicunya run Operations Monitor yang dijalankan sebagai langkah rilis, bukan kode yang dirilis.
- Gejalanya sama dengan 1 November (`on_demand_refresh_failed`), yang saat itu penyebabnya tidak terlihat di log. Kali ini penyebabnya tercatat: pengukuran memori proses pemindai tidak tersedia (`rss_unavailable`, `descendant_rss_missing`) pada tahap penyiapan definisi, yaitu penyegaran lewat Freshclam dan verifikasi tanda tangan.
- Pemindai siap dengan definisi lama sampai sesaat sebelum run itu. Satu run pemindai yang gagal pada deployment yang sedang aktif sudah cukup membuat `/ready` 503; ini perilaku yang disengaja (`docs/OPERASI_ANTIVIRUS_BITSTREAM.md`).
- Run Operations Monitor yang memicu run itu tetap berakhir sukses, walaupun kegagalan terjadi tiga detik sebelum run monitor selesai. Monitor berhenti pada probe sehat pertama, dan saat itu lease lama masih berlaku.
- Tanpa tindakan manual, pemulihan paling cepat terjadi pada panggilan bangun-pemindai terjadwal berikutnya. Panggilan itu berjalan setiap empat jam; yang berikutnya 03:07.

Penyebab di kode ditemukan sesudah rilis ini. Pengawas proses ClamAV mengukur memori setiap proses turunannya, dan proses yang sedang keluar terbaca tanpa angka memori selama beberapa saat sebelum menjadi zombie. Pengawas menganggap keadaan itu sebagai pengukuran yang gagal lalu menghentikan seluruh run. Perbaikannya ada di PR #226 dan belum dirilis: proses turunan yang oleh kernel ditandai sedang keluar diterima sebagai sudah melepas memori, dan Operations Monitor tidak lagi berhenti pada probe sehat pertama setelah membangunkan pemindai.

## Pemeriksaan di produksi

Tanpa login, segera setelah promosi:

| Bagian | Hasil |
|---|---|
| Bundel yang dilayani | `index-Bl_QTBjs.js` |
| Berkas halaman Audit Log | `AuditLog-CteMwtCD.js` memuat "Jatuh tempo", "Nama berkas asli", "Dapat menerima distribusi", dan "No. Filing Cabinet" |
| Rute yang dilindungi | Menjawab 401 tanpa sesi, lewat backend langsung dan lewat proxy `/api` frontend |
| Situs panduan | `/administrasi/audit-log` memuat penjelasan nama isian berbahasa Indonesia; `/perubahan-november-2026` memuat catatannya |

Dengan akun Super Admin, 00:21–00:22. Pemeriksaan ini hanya mengubah penyaring dan hanya mengirim permintaan baca.

| Bagian | Hasil |
|---|---|
| Peralihan dari C89 | Tab yang sebelumnya memuat bundel C89 sudah memuat `index-Bl_QTBjs.js` |
| Catatan Mengubah sampai 24 November, halaman pertama (50 dari 62 catatan) | Nama isian yang pada C89 berbahasa Inggris kini tertulis "Jatuh tempo", "Tanggal kembali", "Dapat menerima distribusi", "Unit Pengawas", "Notifikasi dalam aplikasi", "Notifikasi email", "Tema", "Bahasa antarmuka", "Nama", "Deskripsi", "Kode", "Tingkat", "Nama berkas asli", "Lokasi berkas", "Status integritas", "Status pemindaian malware", "SHA-256", "Ukuran (byte)", "Tautan dokumen", dan "No. Folder" |
| Semua catatan sampai 24 November, halaman pertama | "Induk", "Kapasitas", "Jumlah terisi", "Dihapus oleh", "Waktu dibuat", "Waktu diperbarui"; tidak ada nama isian berbahasa Inggris |
| Nama isian berbahasa Indonesia | Tidak berubah, misalnya "Nomor Surat", "Perihal", "Tanggal Diterima" |
| Konsol peramban | Tanpa galat selama pemeriksaan |

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_4XKGQ4gcnfqwYBGgrHpTZx5SKWJU` (C85) | `main` `24d0fc8` | C84 `dpl_Dh672qtmRbuesVQGAYeCvcajyewm` |
| Frontend | `dpl_BRgRJDdkn6r7fgzGD96jv6mZTaNi` (C90) | `main` `9d9737b` | C89 `dpl_9H8B3eXvZTU1n54qNsicGmZWGjiD` |
| Situs panduan | `dpl_HRb5o1C5moMbuZJo7SuFQvbbQHv9` | `main` `9d9737b` | `dpl_BhqHaVAnKAD8XAD2ZXYj6fBXrTY1` |

Rollback frontend ke C89 dan rollback situs panduan tidak saling bergantung dan tidak memerlukan perubahan backend. Rilis ini hanya mengubah tampilan: tidak ada rute, isian permintaan, atau data di peramban yang bertambah. Skema database dan env produksi tidak berubah.
