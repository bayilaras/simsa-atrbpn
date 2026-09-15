# Hasil kandidat deployment SIMSA — 12 September 2026

**Draf; status akhir masih MENUNGGU.** Laporan ini menindaklanjuti tujuh temuan P2 pada [review prarilis](REVIEW_PRARILIS_2026-09-12.md). Perbaikan source dan pengujian terarah telah dilakukan, tetapi dokumen ini belum menyatakan kandidat lolos seluruh gate, selesai diuji di browser, atau dipromosikan ke Production. SIMSA tetap berdiri sendiri; integrasi SRIKANDI dan TTE tersertifikasi bukan prasyarat maupun tambahan lingkup pekerjaan ini.

## Perbaikan tujuh temuan

| Area | Perilaku setelah perbaikan dan bukti source |
| --- | --- |
| Login serentak dari IP bersama | Penolakan karena kuota tidak menetap sebagai kegagalan autentikasi selama 15 menit. Refund hanya mengurangi window asal; counter tetap atomik, kegagalan store tetap menolak akses, dan lifecycle Vercel menjaga pekerjaan refund. Kuota burst Better Auth tetap berlaku. [Middleware autentikasi](../backend/src/middlewares/auth-attempt-limiter.middleware.ts), [store PostgreSQL](../backend/src/services/postgres-rate-limit.store.ts). |
| Halaman daftar yang hilang | Surat Masuk dan Surat Keluar mengoreksi posisi setelah total halaman berkurang, lalu mengambil ulang halaman yang valid. Respons lama tidak menggantikan hasil permintaan terbaru. [Surat Masuk](../frontend/src/pages/SuratMasuk.jsx), [Surat Keluar](../frontend/src/pages/SuratKeluar.jsx). |
| Pencarian surat yang dibalas | Pencarian dan pagination dilakukan di server sehingga tidak berhenti pada 100 surat pertama. Pilihan yang sudah tertaut tetap tampil saat edit; tersedia retry dan pemilihan melalui keyboard. [Form surat keluar](../frontend/src/pages/TambahSuratKeluar.jsx), [service surat masuk](../frontend/src/services/surat-masuk.service.js). |
| Pemulihan kapabilitas | Maksimum tiga pemeriksaan per siklus, tombol retry, serta pemulihan ketika koneksi/fokus kembali dengan jeda 30 detik. Fitur menunggu respons yang valid. Pemeriksaan ulang tidak mereset isian edit; gangguan health konektor opsional tidak mematikan kapabilitas inti yang sudah diverifikasi. [Provider](../frontend/src/context/AppConfigContext.jsx), [gate konfigurasi](../frontend/src/components/RuntimeConfigurationGate.jsx). |
| Pemetaan kolom Sheets | Nama kolom dicocokkan tepat setelah normalisasi. Header wajib yang hilang atau ambigu ditolak sebelum penulisan. Preview mengembalikan jenis impor dan mapping yang ditampilkan UI; perubahan sumber, unit, atau jenis membuang preview lama. [Pemetaan](../backend/src/services/google-sheets-import-mapping.ts), [dialog impor](../frontend/src/components/ImportFromGDrive.jsx). |
| Duplikasi impor serentak | Pemeriksaan identitas impor dilakukan bersama pembuatan surat dalam transaksi canonical. Identitas memakai tanggal valid dan kebijakan yang juga mengenali surat terhapus; impor ulang tidak memulihkannya. UI membedakan hasil tanpa perubahan karena semua data sudah ada dari kegagalan. [Impor Sheets](../backend/src/services/google-drive-import.service.ts), [surat masuk](../backend/src/services/surat-masuk.service.ts), [surat keluar](../backend/src/services/surat-keluar.service.ts). |
| Kuota wizard Sheets | Discovery, preview, dan impor mempunyai kuota masing-masing tiga permintaan per menit per pengguna. Respons 429 menyertakan waktu tunggu; UI menunggu per langkah dan tidak mengulang penulisan otomatis. [Routes Sheets](../backend/src/routes/google-drive-import.routes.ts), [limiter](../backend/src/middlewares/rate-limiter.middleware.ts), [dialog impor](../frontend/src/components/ImportFromGDrive.jsx). |

## Bukti pengujian yang tersedia

Angka berikut dilaporkan per kelompok. **Jangan menjumlahkannya sebagai total tes unik:** suite backend, tes CSV, dan gate cloud mempunyai cakupan yang beririsan.

| Pemeriksaan | Hasil saat draf disimpan |
| --- | --- |
| Frontend terarah | **55 tes unik / 10 berkas lulus**: pagination 2, picker 3, formulir 19, tanggal 5, UI Sheets 11, payload Sheets 1, provider/recovery/optional health 8, gate konfigurasi 6. |
| Lint perubahan frontend | 17 berkas diperiksa; exit 0. `git diff --check` bersih. |
| Konfigurasi/routing Vercel oleh root | 35 tes lulus; dicatat terpisah dari 55 tes frontend. |
| Autentikasi backend | 27 tes terarah lulus; 9 tes PostgreSQL native lulus. |
| Sheets backend | 113 tes terarah lulus; 7 tes konkurensi PostgreSQL native lulus. Tes CSV 27 lulus, dengan cakupan beririsan; bukan tambahan total unik. |
| Perbaikan oracle proses lintas platform | 19 tes terarah lulus setelah koreksi test-only untuk Linux. Hasil full suite cloud penggantinya masih menunggu. |

Tes frontend Windows memakai Node 24, satu worker, dan batas waktu tes 20 detik. Pool threads digunakan setelah fork worker gagal startup. Kegagalan awal tiga fixture cooldown berasal dari pengembalian clock ke waktu nyata sebelum retry; fixture diperbaiki dan seluruh 11 tes UI Sheets kemudian lulus. Batas waktu layanan produksi tidak dilonggarkan. Bukti regresi berada pada [tes recovery](../frontend/src/context/AppConfigContext.recovery.test.jsx), [optional health](../frontend/src/context/AppConfigContext.optional-health.test.jsx), dan [alur Sheets](../frontend/src/components/ImportFromGDrive.flow.test.jsx).

## Status kandidat cloud — belum boleh dianggap selesai

1. Percobaan backend pertama mencapai status platform **READY**, tetapi gate yang dimaksud ternyata tidak dijalankan. Jalur build diperbaiki; READY pada percobaan ini bukan bukti kelulusan rilis.
2. Percobaan backend kedua lulus TypeScript; full suite mencatat **2.502 dari 2.504 tes lulus**. Dua kegagalan terkait oracle proses Linux. Perbaikan test-only sudah lulus 19 tes terarah, tetapi rebuild/full suite pengganti masih menunggu.
3. Full lint/test/build frontend Linux, smoke kandidat, dan verifikasi scanner native cloud masih harus dicatat berdasarkan hasil aktual. Source kandidat diverifikasi melalui [pemeriksaan sumber kandidat](../scripts/verify-candidate-source.mjs).

| Identitas/status final | Nilai |
| --- | --- |
| Hash/source capture final | **MENUNGGU — diisi root** |
| URL kandidat backend dan frontend final | **MENUNGGU — diisi root** |
| Full gate cloud dan smoke browser | **MENUNGGU** |
| Bukti native scan pada kandidat | **MENUNGGU** |
| Promosi alias Production dan smoke sesudah promosi | **BELUM DINYATAKAN SELESAI** |

## Batas validasi

Data produksi kecil, saat review hanya satu surat masuk, belum membuktikan pagination banyak halaman atau pencarian record ke-101 di browser live; kasus tersebut dibuktikan oleh fixture. Callback Google pada origin canonical, seluruh kombinasi peran/unit, dan impor Google Sheets nyata belum tervalidasi penuh dalam draf ini. Pengujian mock/native lokal tidak menggantikan bukti tersebut. Jangan menyimpulkan keberhasilan upload, pemeriksaan malware, atau pratinjau PDF privat sebelum smoke cloud aktual dicatat.

Pembuatan salinan backup terenkripsi di luar workstation, pembuktian restore aktual, serta pencadangan byte berkas privat tidak termasuk lingkup patch kandidat ini. Kewajiban operasional tersebut tetap mengikuti [backup Neon](BACKUP_NEON.md) dan [review prarilis](REVIEW_PRARILIS_2026-09-12.md). Dokumen historis tidak diubah oleh draf ini; root akan melengkapi status akhir setelah seluruh bukti tersedia.
