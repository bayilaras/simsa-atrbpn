# Status penggunaan SIMSA di cloud

Diperiksa pada 12 September 2026. Target adalah 1–3 pengguna aplikasi arsip internal, PDF maksimum 10 MiB (10.485.760 byte), anggaran Rp0 dan tanpa komputer operator yang menyala sepanjang hari.

**Production sudah aktif dan alur utama surat/PDF telah lulus pengujian langsung.** Login, pencatatan surat, unggah PDF sintetis 10 MiB ke penyimpanan privat, pemindaian antivirus, serta pengiriman pratinjau dan unduhan berhasil. Berkas yang diterima memiliki ukuran dan SHA-256 yang cocok. Akses tanpa login ditolak. Penerimaan ini mencakup alur administrator yang diuji; penerapan seluruh peran dan siklus retensi masih memerlukan konfigurasi operasional di bawah.

Alamat aplikasi: **https://simsa-frontend.vercel.app**. Backend: **https://simsa-backend.vercel.app**. Keduanya berjalan di cloud dan tidak bergantung pada komputer operator.

**Pembaruan database 12 September 2026 pukul 19.18–19.20 WIB:** migrasi `0039_shared_rate_limits` berhasil diterapkan, sehingga journal Neon berisi 40 migrasi yang hash-nya cocok. Izin API/backup/worker, probe CRUD counter yang di-rollback, dan SQL readiness source terbaru lulus. Empat endpoint health/readiness/capability cloud tetap HTTP 200. Versi aplikasi Vercel belum dideploy ulang. [Bukti migrasi dan backup](MIGRASI_0039_2026-09-12.md).

SIMSA digunakan sebagai aplikasi mandiri. Integrasi SRIKANDI tidak diperlukan; profil cloud terverifikasi `internal` dengan SRIKANDI nonaktif. SRIKANDI menjadi acuan kemampuan dan pengalaman penggunaan, bukan prasyarat koneksi atau klaim kesetaraan yang telah dibuktikan.

## Kondisi yang sudah diperiksa

| Bagian | Hasil |
| --- | --- |
| Vercel Production | Frontend `Aqd25jwGpT7N3c4tJP1yzEpG4J5s` (sumber `2b686a9`) dan backend `CWnJz48FByoFLTcQtf62bZTTkX6n` (sumber `087c8fe`) aktif pada domain utama. Backend dideploy ulang untuk mengaktifkan Google OAuth. Pemeriksaan terakhir 12 September 2026 pukul 12.21 WIB: health/readiness dan manifest HTTP 200, mode `full`, Better Auth, storage privat serta API same-origin. Bundle publik memuat penanganan error Google yang baru. |
| Neon | PostgreSQL 18, **40 migrasi**: journal aktual, timestamp, dan hash diverifikasi melalui akun migrasi pada 12 September 2026 pukul 19.18 WIB. `0039` menambah tabel counter dengan DML API dan pembacaan backup; izin data bisnis tetap mengikuti kebijakan versi. Verifikasi API dan login antivirus `simsa_worker` lulus. Tidak melakukan seed atau impor data dalam migrasi ini. |
| Kompatibilitas Vercel baru | Mode `full`, API same-origin, Better Auth dan Vercel Blob privat aktif. Masalah interoperabilitas ESM Node 24 serta lokasi aset native sudah diperbaiki dan diverifikasi pada fungsi Production. Isolasi Preview tetap berlaku. |
| Pemeriksaan login cloud | **13/13 pemeriksaan lulus**: origin, cookie Secure/HttpOnly, penolakan akses anonim, login, akses unit, logout dan penolakan sesi lama. Login browser serta pencatatan surat juga berhasil. |
| Login Google Better Auth | `GOOGLE_OAUTH_ENABLED=true` dipulihkan pada backend Production memakai kredensial Google yang sudah tersedia. `/api/capabilities` HTTP 200 menerbitkan `provider=better-auth`, `googleSignIn=true`; tombol muncul setelah reload. Klik browser berhasil membuka pemilihan akun Google dengan callback `https://simsa-frontend.vercel.app/api/auth/callback/google`. Sesi Google pada browser belum masuk; penyelesaian callback sampai sesi SIMSA terbentuk menunggu pengguna masuk sendiri. Akun SIMSA harus sudah diprovisikan dengan email Google yang sama. |
| Penyimpanan lama | Store `simsa-files` tampil sebagai **Public**, dengan pemakaian 46,3 MB. Isi objek tidak diperiksa atau dipindahkan. Status ini tidak sesuai untuk penyimpanan baru yang mensyaratkan berkas privat. |
| PDF dan lingkup awal | Surat uji `UJI-PRODUCTION-4340B597` dibuat melalui browser dengan PDF 10.485.760 byte. Pengujian HTTP berkas **16/16 lulus**: status `clean`/`verified`/`private`, pratinjau dan unduhan HTTP 200 dengan ukuran/hash cocok, akses anonim HTTP 401, serta pencabutan sesi setelah logout. Probe langsung URL Blob tanpa autentikasi mendapat HTTP 403 dan tidak mengirim PDF. Bulk/OCR, alur arsip lanjutan dan integrasi SRIKANDI dinonaktifkan. |
| Bukti engine antivirus | POC terpisah pada Vercel Hobby berhasil dua kali: PDF 1 KiB, PDF 10 MiB, dan EICAR. PDF 10 MiB selesai sekitar 17 detik; RSS gabungan terukur maksimum sekitar 1,15 GB. Bundle sekitar 154 MB. POC tidak menerima dokumen pengguna dan tidak mengubah status arsip. |
| Integrasi antivirus | Worker aplikasi berhasil memindai PDF uji menggunakan ClamAV 1.5.4. Kueri audit diperbaiki pada `f54f80d`; supervisor menunggu pengukuran memori yang sedang berjalan pada `087c8fe`. Lampiran dilepas melalui worker, tanpa perubahan status manual atau perluasan grant. Verifikasi audit baca-saja **8/8 lulus**: pemindaian ketiga menghasilkan `clean`, integritas `verified`, dan bukti tiga definisi bertanda tangan dengan digest cocok, berlaku sampai 13 September 2026 pukul 10.35 WIB. Definisi kedaluwarsa diperbarui saat worker berjalan; kegagalan tetap mengarantina berkas. |
| Aktivasi Vercel | Operator telah menyetujui dan empat kredensial sudah dipasang khusus **Production `simsa-backend`**. Store baru **`simsa-arsip-private`**, privat, Singapura, terhubung hanya ke backend Production dengan prefix `SIMSA_PRIVATE_BLOB`. Store lama tidak diubah. |
| Render | Percobaan membuat layanan Free meminta verifikasi kartu. Layanan belum dibuat dan paket berbayar tidak diaktifkan. |
| Cadangan Neon nyata | Snapshot pra-upgrade **12 September 2026 pukul 19.12.15 WIB** (39 migrasi) dan pasca-upgrade **19.20.03 WIB** (40 migrasi) berhasil dienkripsi memakai helper yang cocok. Snapshot lama tetap tersedia. Bundle serta kunci terpisah disimpan privat di luar repository pada workstation. `restore_verified=false`: pemulihan sumber Neon belum terbukti; salinan di luar workstation belum tersedia. |

## Pekerjaan yang masih diperlukan untuk arsip lengkap

1. **Hosting yang memenuhi kebutuhan penggunaan instansi.** Akun Vercel yang diperiksa memakai Hobby. Dokumentasi Vercel membatasi Hobby untuk penggunaan pribadi dan nonkomersial; deployment yang pernah berhasil tidak membuktikan kelayakan penggunaan instansi. Jangan mengaktifkan paket berbayar untuk memenuhi target Rp0. [Ketentuan Hobby](https://vercel.com/docs/plans/hobby), [panduan fair use](https://vercel.com/docs/limits/fair-use-guidelines).
2. **Pemakaian dan kuota paket gratis.** Alur berkas telah lulus pengujian langsung. Pantau kapasitas penyimpanan, transfer dan eksekusi worker; jumlah pengguna yang sedikit tidak menghapus batas paket. Jangan mengubah hasil scan secara manual. [Kuota Blob Vercel](https://vercel.com/docs/vercel-blob/usage-and-pricing).
3. **Cadangan di luar workstation dan uji pemulihan berkala.** Cadangan Neon terenkripsi sudah dibuat, tetapi pemulihan sumber sebenarnya pada Linux, jadwal cloud dan salinan di luar workstation belum tersedia. Backup database tidak mencakup isi berkas object storage.
4. **Data operasional dan penerimaan pengguna.** Klasifikasi serta JRA pada database baru perlu sumber yang benar dan aktivasi melalui alur aplikasi. Hasil smoke administrator tidak membuktikan seluruh peran atau seluruh alur retensi; pengelola perlu mengisi referensi dan memberikan akun sesuai kewenangan pengguna.

Integrasi resmi SRIKANDI tidak diperlukan sesuai arahan pengguna dan tetap nonaktif. Aktivasi aplikasi tidak sama dengan pengesahan instrumen instansi atau bukti kesesuaian menyeluruh dengan ANRI.

## Penggunaan awal dan data referensi

Pada pemeriksaan migrasi 12 September 2026 pukul 19.18 WIB, database berisi 4 pengguna, 1 surat masuk, 0 surat keluar, 0 arsip, dan 1 lampiran; jumlah ini sama sebelum dan sesudah migrasi. Pemeriksaan migrasi tidak meninjau ulang status aktivasi seluruh instrumen. Pengguna dapat mencatat surat dan mengunggah PDF maksimum 10 MiB. Berkas tersedia setelah pemindaian dan integritas lulus. Registrasi menjadi arsip memerlukan klasifikasi dan retensi yang sudah aktif.

Draf instrumen awal tersedia untuk diperiksa melalui aplikasi, tetapi tidak otomatis disahkan sebagai instrumen instansi. Alur aktivasi memisahkan pembuat/pengaju, pemeriksa, dan pemberi persetujuan menjadi **tiga akun berwenang yang berbeda**. Ini sesuai batas atas tiga pengguna yang diminta; jangan memakai satu akun bersama atau membuat persetujuan fiktif untuk melewati pemisahan peran. PDF sumber instrumen juga tetap dikarantina sampai hasil pemindaian dan pemeriksaan integritas lulus.

Kredensial **Production proyek Vercel `simsa-backend`** yang telah dipasang: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `MALWARE_WORKER_DATABASE_URL`, dan `MALWARE_SCAN_DISPATCH_TOKEN`. Nilainya tidak disimpan dalam repositori. Variabel lama untuk Preview/Development dipertahankan; konfigurasi frontend memakai API same-origin.

## Bukti pengujian kode

Pemulihan Google lulus **17 tes** konfigurasi/provider backend dan **8 tes** layanan autentikasi frontend, termasuk empat kasus Google. Lint terarah serta review independen lulus. Build Production frontend pada Vercel lulus dalam 49 detik. Uji browser pada origin staging yang tidak diizinkan menampilkan pesan penolakan dan memulihkan tombol; pembatasan origin tidak dilonggarkan. Setelah promosi domain, lima pemeriksaan manifest, capability Google, bundle error, health dan readiness lulus. Uji ini tidak menggantikan penyelesaian login Google oleh pengguna.

Perbaikan transaksi audit lulus **40/40 tes** SQL dan unit, termasuk reproduksi izin worker tanpa `SELECT` audit serta rollback audit atomik. Perbaikan supervisor native lulus **35/35 tes**, termasuk proses cepat yang selesai sebelum pengukuran memori, kegagalan pengukuran, batas memori dan tenggat. Typecheck serta build backend Vercel pada sumber `087c8fe` lulus, dan dua peninjauan independen tidak menemukan penghalang rilis.

Rilis antivirus lulus 65 pemeriksaan gate/dispatch/recovery, 24 pemeriksaan rute PDF sumber instrumen, 31 pemeriksaan status karantina/akses berkas, serta 34 pemeriksaan UI pemindaian. Konfigurasi, readiness dan transaksi worker lulus 99 pemeriksaan terarah, termasuk 10 pemeriksaan SQL; role/backup worker lulus sembilan tes. Perbaikan diagnosis runtime lulus 96 tes Vitest dan enam tes Node; aset native lulus 31 tes terarah, dan interoperabilitas Node lulus dua tes nyata. Typecheck serta build backend/frontend lulus. Artefak frontend mencatat `syntheticDataOnly=false` dan API same-origin. Bukti ini dibedakan dari uji cloud di tabel di atas.

Tes konfigurasi Vercel, isolasi Preview, pool database, frontend, verifikasi HTTP dan kebijakan backup lulus. Typecheck, lint terarah dan kedua build juga lulus. Pada pengujian tahap metadata sebelumnya, handler hasil build memberi HTTP 200 untuk health/capabilities dengan berkas nonaktif; uji tersebut tidak menghubungi database cloud.

Sebanyak 21 pemeriksaan pemulihan PostgreSQL disposable dan lima pemeriksaan ACL Windows lulus. Uji menemukan dan memperbaiki urutan kepemilikan sequence serta pemeriksaan SID pemilik file. Locale fixture Windows berbeda dari Neon; hasil ini tidak menjadi bukti bahwa backup Neon nyata sudah teruji pulih. Artefak build lokal lama tetap utuh dan semua cluster uji dihentikan.

## Bukti penerimaan Production

Laporan tersanitasi tersedia pada workspace operator dan tidak dilacak Git:

- `output/cloud-verification/production-access-20260912-live-a05ece9.json`: autentikasi 13/13.
- `output/production-smoke/file-acceptance-1789184240316.json`: alur berkas 16/16.
- `output/production-smoke/private-object-acceptance-1789184528136.json`: Blob langsung anonim ditolak.
- `output/production-smoke/attachment-readonly-proof.json`: metadata dan audit 8/8.
- `output/google-login-production-proof.json`: aktivasi Google dan pengalihan browser sampai pemilihan akun.
- `output/google-login-frontend-production-proof.json`: lima pemeriksaan cloud setelah frontend Google dipromosikan.

PDF sintetis berukuran 10.485.760 byte memiliki SHA-256 `ca87828927753d05a7f5e522544a4a066ba0d600e15f3b9b163df513f29bfa62`. Percobaan sebelumnya yang gagal tetap disimpan sebagai riwayat diagnosis. Pengujian pratinjau memverifikasi respons HTTP dan byte PDF; tampilan PDF bawaan bergantung pada dukungan browser.

Panduan pelaksanaan: [Vercel dan Neon](DEPLOY_VERCEL_NEON.md), [verifikasi akses cloud](VERIFIKASI_AKSES_CLOUD.md), [backup Neon](BACKUP_NEON.md), dan [operasi antivirus](OPERASI_ANTIVIRUS_BITSTREAM.md).
