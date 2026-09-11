# Status penggunaan SIMSA di cloud

Diperiksa pada 11 September 2026. Target pengguna adalah aplikasi arsip internal dengan anggaran Rp0 dan tanpa komputer operator yang menyala sepanjang hari.

**Rilis baru belum beroperasi sebagai aplikasi arsip lengkap di production.** Perubahan kode, build yang lulus, atau status deployment `Ready` dari hosting tidak cukup untuk menyatakan aplikasi siap digunakan.

## Kondisi yang sudah diperiksa

| Bagian | Hasil |
| --- | --- |
| Vercel lama | Proyek `simsa-frontend` dan `simsa-backend` tersedia. Backend Production masih revisi `ae6ef2a4`; `/health` memberi HTTP 200, sedangkan `/api/capabilities` rilis baru belum tersedia. |
| Neon baru | PostgreSQL 18, 38 migrasi, hak akses runtime terbatas dan administrator aplikasi awal sudah disiapkan. Data lama belum diimpor. |
| Kompatibilitas Vercel baru | Handler Express, pool koneksi, build terpisah, serta isolasi database, autentikasi dan SMTP Preview diperiksa. Tahap metadata memakai login nyata dengan berkas dinonaktifkan secara eksplisit. |
| Pemeriksaan login cloud | CLI verifikasi tersedia; memeriksa origin tujuan, cookie aman, akses tanpa login, logout, dan pembatalan session. Belum ada hasil login rilis baru pada domain production. |
| Penyimpanan lama | Store `simsa-files` tampil sebagai **Public**, dengan pemakaian 46,3 MB. Isi objek tidak diperiksa atau dipindahkan. Status ini tidak sesuai untuk penyimpanan baru yang mensyaratkan berkas privat. |
| Render | Percobaan membuat layanan Free meminta verifikasi kartu. Layanan belum dibuat dan paket berbayar tidak diaktifkan. |
| Cadangan Neon nyata | Akun backup baca khusus dibuat dan snapshot 11 September 2026 pukul 21.32 WIB berhasil dienkripsi. Bundle serta kunci terpisah disimpan privat pada workstation. `restore_verified=false`: pemulihan sumber Neon belum terbukti. |

## Pekerjaan yang masih diperlukan untuk arsip lengkap

1. **Hosting yang memenuhi kebutuhan penggunaan instansi.** Akun Vercel yang diperiksa memakai Hobby. Dokumentasi Vercel membatasi Hobby untuk penggunaan pribadi dan nonkomersial; deployment yang pernah berhasil tidak membuktikan kelayakan penggunaan instansi. Jangan mengaktifkan paket berbayar untuk memenuhi target Rp0. [Ketentuan Hobby](https://vercel.com/docs/plans/hobby), [panduan fair use](https://vercel.com/docs/limits/fair-use-guidelines).
2. **Penyimpanan privat dan antivirus yang benar-benar berjalan di cloud.** Adapter privat tersedia dalam kode, tetapi store privat, worker dan uji unggah–karantina–pindai–unduh belum diaktifkan pada target baru. Jangan mengubah hasil scan menjadi bersih ketika scanner belum tersedia. Kapasitas paket gratis juga harus disesuaikan dengan jumlah dan ukuran dokumen. [Kuota Blob Vercel](https://vercel.com/docs/vercel-blob/usage-and-pricing).
3. **Cadangan di luar workstation dan uji pemulihan berkala.** Cadangan Neon terenkripsi sudah dibuat, tetapi pemulihan sumber sebenarnya pada Linux, jadwal cloud dan salinan di luar workstation belum tersedia. Backup database tidak mencakup isi berkas object storage.
4. **Data operasional dan penerimaan pengguna.** Klasifikasi serta JRA pada database baru perlu sumber yang benar dan aktivasi melalui alur aplikasi. Login, peran pengguna, pengelolaan arsip, audit, pemulihan dan batas kapasitas harus diuji pada deployment tujuan.

Tahap metadata dapat digunakan untuk pengujian login dan pengelolaan data, tetapi fitur arsip digital lengkap masih bergantung pada pekerjaan di atas. Integrasi resmi SRIKANDI belum diaktifkan atau dinyatakan terbukti.

## Bukti pengujian kode

Tes konfigurasi Vercel, isolasi Preview, pool database, frontend, verifikasi HTTP dan kebijakan backup lulus. Typecheck, lint terarah dan kedua build juga lulus. Handler hasil build memberi HTTP 200 untuk health/capabilities dengan mode metadata dan berkas nonaktif; uji ini tidak menghubungi database cloud.

Sebanyak 21 pemeriksaan pemulihan PostgreSQL disposable dan lima pemeriksaan ACL Windows lulus. Uji menemukan dan memperbaiki urutan kepemilikan sequence serta pemeriksaan SID pemilik file. Locale fixture Windows berbeda dari Neon; hasil ini tidak menjadi bukti bahwa backup Neon nyata sudah teruji pulih. Artefak build lokal lama tetap utuh dan semua cluster uji dihentikan.

Panduan pelaksanaan: [Vercel dan Neon](DEPLOY_VERCEL_NEON.md), [verifikasi akses cloud](VERIFIKASI_AKSES_CLOUD.md), [backup Neon](BACKUP_NEON.md), dan [operasi antivirus](OPERASI_ANTIVIRUS_BITSTREAM.md).
