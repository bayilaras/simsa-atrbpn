# Status penggunaan SIMSA di cloud

Diperiksa pada 12 September 2026. Target adalah 1–3 pengguna aplikasi arsip internal, PDF maksimum 10 MiB (10.485.760 byte), anggaran Rp0 dan tanpa komputer operator yang menyala sepanjang hari.

**Rilis baru belum beroperasi sebagai aplikasi arsip lengkap di production.** Perubahan kode, build yang lulus, atau status deployment `Ready` dari hosting tidak cukup untuk menyatakan aplikasi siap digunakan.

## Kondisi yang sudah diperiksa

| Bagian | Hasil |
| --- | --- |
| Vercel lama | Proyek `simsa-frontend` dan `simsa-backend` tersedia. Backend Production masih revisi `ae6ef2a4`; `/health` memberi HTTP 200, sedangkan `/api/capabilities` rilis baru belum tersedia. |
| Neon baru | PostgreSQL 18, **39 migrasi** sudah diterapkan dan diverifikasi melalui akun runtime. Administrator awal serta login antivirus `simsa_worker` terpisah sudah dibuat; verifikasi langsung worker dan API lulus. Grant tabel tidak diperluas. Data lama belum diimpor. |
| Kompatibilitas Vercel baru | Handler Express, pool koneksi, build terpisah, serta isolasi database, autentikasi dan SMTP Preview diperiksa. Tahap metadata memakai login nyata dengan berkas dinonaktifkan secara eksplisit. |
| Pemeriksaan login cloud | CLI verifikasi tersedia; memeriksa origin tujuan, cookie aman, akses tanpa login, logout, dan pembatalan session. Belum ada hasil login rilis baru pada domain production. |
| Penyimpanan lama | Store `simsa-files` tampil sebagai **Public**, dengan pemakaian 46,3 MB. Isi objek tidak diperiksa atau dipindahkan. Status ini tidak sesuai untuk penyimpanan baru yang mensyaratkan berkas privat. |
| PDF dan lingkup awal | Validasi PDF maksimum 10 MiB, unggah langsung privat dan finalisasi arsip atomik sudah diimplementasikan. Bulk/OCR dan alur arsip lanjutan dapat dinonaktifkan terpisah. Preview frontend/backend commit `ab9c5b9` berstatus Ready; ini belum Production. |
| Bukti engine antivirus | POC terpisah pada Vercel Hobby berhasil dua kali: PDF 1 KiB, PDF 10 MiB, dan EICAR. PDF 10 MiB selesai sekitar 17 detik; RSS gabungan terukur maksimum sekitar 1,15 GB. Bundle sekitar 154 MB. POC tidak menerima dokumen pengguna dan tidak mengubah status arsip. |
| Integrasi antivirus | **Adaptor native sebenarnya lulus di Vercel** pada commit `1f6547f`: cache sengaja dibuat kedaluwarsa, Freshclam dan verifikasi signature berhasil, PDF 10 MiB clean dalam 15,2 detik, EICAR infected, pembatalan menolak hasil dan membersihkan file sementara. Bundle 172,4 MB; RSS gabungan terukur 1,29 GB. Fungsi worker/antrean aplikasi belum diaktifkan pada Production. |
| Aktivasi Vercel | Persetujuan pemindahan kredensial ke **Production Vercel** serta pembuatan/pemberian akses store privat masih diminta; persetujuan sebelumnya menyebut Render. Belum ada kredensial baru yang dipasang pada Vercel. |
| Render | Percobaan membuat layanan Free meminta verifikasi kartu. Layanan belum dibuat dan paket berbayar tidak diaktifkan. |
| Cadangan Neon nyata | Snapshot terbaru **12 September 2026 pukul 01.05 WIB**, setelah 39 migrasi dan verifikasi akun worker, berhasil dienkripsi. Snapshot lama tetap disimpan. Bundle serta kunci terpisah disimpan privat pada workstation. `restore_verified=false`: pemulihan sumber Neon belum terbukti; salinan di luar workstation belum tersedia. |

## Pekerjaan yang masih diperlukan untuk arsip lengkap

1. **Hosting yang memenuhi kebutuhan penggunaan instansi.** Akun Vercel yang diperiksa memakai Hobby. Dokumentasi Vercel membatasi Hobby untuk penggunaan pribadi dan nonkomersial; deployment yang pernah berhasil tidak membuktikan kelayakan penggunaan instansi. Jangan mengaktifkan paket berbayar untuk memenuhi target Rp0. [Ketentuan Hobby](https://vercel.com/docs/plans/hobby), [panduan fair use](https://vercel.com/docs/limits/fair-use-guidelines).
2. **Penyimpanan privat dan antivirus yang benar-benar berjalan di cloud.** Adapter privat tersedia dalam kode, tetapi store privat, worker dan uji unggah–karantina–pindai–unduh belum diaktifkan pada target baru. Jangan mengubah hasil scan menjadi bersih ketika scanner belum tersedia. Kapasitas paket gratis juga harus disesuaikan dengan jumlah dan ukuran dokumen. [Kuota Blob Vercel](https://vercel.com/docs/vercel-blob/usage-and-pricing).
3. **Cadangan di luar workstation dan uji pemulihan berkala.** Cadangan Neon terenkripsi sudah dibuat, tetapi pemulihan sumber sebenarnya pada Linux, jadwal cloud dan salinan di luar workstation belum tersedia. Backup database tidak mencakup isi berkas object storage.
4. **Data operasional dan penerimaan pengguna.** Klasifikasi serta JRA pada database baru perlu sumber yang benar dan aktivasi melalui alur aplikasi. Login, peran pengguna, pengelolaan arsip, audit, pemulihan dan batas kapasitas harus diuji pada deployment tujuan.

Tahap metadata dapat digunakan untuk pengujian login dan pengelolaan data, tetapi fitur arsip digital lengkap masih bergantung pada pekerjaan di atas. Integrasi resmi SRIKANDI belum diaktifkan atau dinyatakan terbukti.

## Penggunaan awal dan data referensi

Database baru berisi satu administrator dan dua unit kerja; belum ada klasifikasi aktif, JRA aktif, arsip, atau lampiran. Setelah aktivasi dan uji cloud, pengguna dapat mulai mencatat surat serta mengunggah PDF tanpa menunggu pengisian seluruh klasifikasi/JRA. Registrasi menjadi arsip memerlukan klasifikasi dan retensi yang sudah aktif.

Draf instrumen awal tersedia untuk diperiksa melalui aplikasi, tetapi tidak otomatis disahkan sebagai instrumen instansi. Alur aktivasi memisahkan pembuat/pengaju, pemeriksa, dan pemberi persetujuan menjadi **tiga akun berwenang yang berbeda**. Ini sesuai batas atas tiga pengguna yang diminta; jangan memakai satu akun bersama atau membuat persetujuan fiktif untuk melewati pemisahan peran. PDF sumber instrumen juga tetap dikarantina sampai hasil pemindaian dan pemeriksaan integritas lulus.

Aktivasi yang disiapkan membutuhkan empat kredensial pada **Production proyek Vercel `simsa-backend`**: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `MALWARE_WORKER_DATABASE_URL`, dan `MALWARE_SCAN_DISPATCH_TOKEN`. Store baru `simsa-arsip-private` direncanakan di Singapura, privat, dengan akses baca/tulis khusus backend Production. Nilai kredensial tidak disimpan dalam repositori; persetujuan Render sebelumnya tidak dianggap sebagai persetujuan pengiriman ke Vercel.

## Bukti pengujian kode

Rilis antivirus sesuai permintaan lulus 65 pemeriksaan gate/dispatch/recovery, 24 pemeriksaan rute PDF sumber instrumen, 31 pemeriksaan status karantina/akses berkas, serta 34 pemeriksaan UI pemindaian. Konfigurasi, readiness dan transaksi hasil worker lulus 99 pemeriksaan terarah, termasuk 10 pemeriksaan SQL; role/backup worker lulus sembilan tes. Typecheck backend, build backend setelah perubahan terakhir, dan build frontend mode penuh dengan storage privat lulus. Artefak frontend mencatat `syntheticDataOnly=false` dan API same-origin. Hasil ini membuktikan kode/build; kredensial, store dan alur aplikasi lengkap pada domain Production masih menunggu aktivasi serta pengujian.

Tes konfigurasi Vercel, isolasi Preview, pool database, frontend, verifikasi HTTP dan kebijakan backup lulus. Typecheck, lint terarah dan kedua build juga lulus. Handler hasil build memberi HTTP 200 untuk health/capabilities dengan mode metadata dan berkas nonaktif; uji ini tidak menghubungi database cloud.

Sebanyak 21 pemeriksaan pemulihan PostgreSQL disposable dan lima pemeriksaan ACL Windows lulus. Uji menemukan dan memperbaiki urutan kepemilikan sequence serta pemeriksaan SID pemilik file. Locale fixture Windows berbeda dari Neon; hasil ini tidak menjadi bukti bahwa backup Neon nyata sudah teruji pulih. Artefak build lokal lama tetap utuh dan semua cluster uji dihentikan.

Panduan pelaksanaan: [Vercel dan Neon](DEPLOY_VERCEL_NEON.md), [verifikasi akses cloud](VERIFIKASI_AKSES_CLOUD.md), [backup Neon](BACKUP_NEON.md), dan [operasi antivirus](OPERASI_ANTIVIRUS_BITSTREAM.md).
