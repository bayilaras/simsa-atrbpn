# Profil Aplikasi Internal SIMSA

## Status dan tujuan

SIMSA adalah aplikasi internal Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan (Ditjen PTPP) untuk membantu pengelolaan surat, arsip, dosir, pencarian, layanan, retensi, dan penyusutan secara lebih mudah, tertib, serta dapat ditelusuri.

Permen ATR/BPN Nomor 2 Tahun 2026 dan ketentuan ANRI digunakan sebagai **rujukan desain dan tata kelola**. Dokumen tersebut bukan instruksi eksekusi bagi pengembang dan pencantumannya tidak berarti SIMSA telah disertifikasi atau dinyatakan sepenuhnya patuh oleh ATR/BPN, ANRI, BSSN, BSrE, atau lembaga lain.

Profil ini bukan opini hukum, sertifikasi keamanan, akreditasi, pengganti SOP, atau pengganti keputusan pejabat yang berwenang. Ruang lingkup data, kelas keamanan, JRA, serta integrasi resmi tetap harus ditetapkan melalui kebijakan internal.

## Prioritas produk

Urutan prioritas SIMSA adalah:

1. mempermudah pekerjaan harian pengguna Ditjen PTPP;
2. menjaga metadata, klasifikasi, dosir, pencarian, retensi, legal hold, dan alur penyusutan tetap tertib;
3. melindungi kerahasiaan, integritas, ketersediaan, dan akuntabilitas data secara proporsional terhadap risiko; dan
4. menambahkan interoperabilitas eksternal hanya setelah mandat, kontrak, pemilik proses, dan lingkungan uji resminya tersedia.

Kemudahan operasional tidak boleh dicapai dengan menghapus pemeriksaan hak akses, isolasi unit, karantina file, audit, validasi retensi, legal hold, atau kontrol keamanan dasar lainnya.

## Ruang lingkup inti

Profil internal inti mencakup:

- akun terprovisi, role, dan unit kerja;
- surat masuk/keluar, distribusi, arsip, dosir, serta pencarian;
- klasifikasi keamanan dan akses per rekod;
- registrasi arsip elektronik, versi, checksum/fixity, QC alih media, dan riwayat preservasi;
- JRA, pemicu retensi berbasis peristiwa, legal hold, serta penyusutan dengan pemisahan tugas;
- peminjaman, layanan arsip, lokasi simpan, arsip vital/terjaga, audit, dan laporan.

SIMSA tidak diposisikan sebagai pengganti aplikasi umum atau layanan nasional yang ditetapkan pemerintah. Jika kebijakan internal menetapkan sistem lain sebagai sumber kebenaran resmi, SIMSA berperan sebagai aplikasi kerja substantif dan pertukaran data hanya dilakukan melalui mekanisme yang disahkan.

## Baseline internal yang tidak boleh dihilangkan

Kontrol berikut tetap wajib untuk operasi internal, terlepas dari ada atau tidaknya integrasi eksternal:

- autentikasi, provisioning terkontrol, least privilege, isolasi unit, dan akses kelas keamanan yang gagal-tertutup;
- penyimpanan objek privat dan akses file melalui gateway terautentikasi;
- checksum/fixity, karantina, serta kebijakan pelepasan file yang gagal-tertutup bila hasil pemeriksaan malware belum bersih;
- jejak audit untuk akses dan tindakan kritis, perlindungan akses ke log, retensi log, serta backup yang dapat dipulihkan;
- validasi metadata/JRA, pemicu retensi yang dapat dibuktikan, legal hold, dan pemisahan tugas penyusutan;
- pengelolaan secret, TLS, konfigurasi produksi, pembatasan sesi, pemantauan dasar, dan penanganan insiden; serta
- migrasi teruji, backup database dan bitstream, serta restore drill sebelum data produksi dipindahkan.

Jika suatu dependensi keamanan belum tersedia, fitur yang bergantung padanya harus tetap nonaktif atau gagal-tertutup. Status “opsional” tidak boleh diterjemahkan menjadi melewati kontrol keamanan.

## Integrasi dan kontrol kondisional

| Kapabilitas | Status pada profil internal | Kapan menjadi wajib | Aturan aman |
|---|---|---|---|
| SRIKANDI | Opsional/deferred dan outbound nonaktif secara default | Jika kebijakan internal menetapkan registrasi atau pertukaran data melalui SRIKANDI | Gunakan kontrak API, sandbox, kredensial, pemetaan data, worker, rekonsiliasi, dan persetujuan resmi; jangan mengklaim sinkronisasi hanya dari HTTP 2xx |
| BSrE/PSrE | Opsional selama tanda tangan/segel elektronik resmi tidak digunakan | Sebelum fitur tanda tangan/segel elektronik resmi diaktifkan | Endpoint harus tetap gagal-tertutup; tanda tangan simulasi tidak boleh dianggap sah |
| Object lock/WORM | Deferred atau kondisional sesuai kelas data, retensi, arsitektur storage, dan keputusan risiko | Jika kebijakan internal atau klasifikasi data mensyaratkan immutability infrastruktur | Baseline tetap memakai objek privat, backup, fixity, pembatasan admin, dan audit; gunakan versioning bila tersedia dan jangan mengklaim WORM tanpa bukti konfigurasi |
| SIEM/SOC eksternal | Deferred atau kondisional sesuai skala, risiko, dan kebijakan operasi | Jika diwajibkan kebijakan keamanan atau hasil asesmen risiko | Audit/log lokal, kontrol akses log, alert dasar, retensi, sinkronisasi waktu, dan respons insiden tetap harus berjalan |

KMS/HSM, DLP, content disarm, watermark dinamis, dan akreditasi juga diterapkan berdasarkan kelas data, risiko, serta kebijakan internal. Data Rahasia/Sangat Rahasia tidak boleh digunakan hanya berdasarkan profil ini; diperlukan keputusan formal dan kontrol tambahan yang sesuai.

## Mode penerapan

### Profil inti internal

Gunakan fungsi operasional inti dengan baseline keamanan di atas. Biarkan SRIKANDI, penandatanganan BSrE/PSrE, dan konektor eksternal lain nonaktif bila belum diwajibkan atau belum siap.

Konfigurasi bawaan yang disarankan:

```dotenv
# Backend
APP_PROFILE=internal
SRIKANDI_ENABLED=false

# Frontend (ditetapkan saat build)
VITE_APP_PROFILE=internal
VITE_FEATURE_SRIKANDI=false
```

Dengan konfigurasi ini, menu dan rute SRIKANDI tidak tampil pada frontend, lalu lintas keluar tetap nonaktif, dan konektor eksternal tidak menjadi syarat startup aplikasi. Nilai profil frontend dan backend harus diselaraskan pada setiap deployment.

### Profil integrasi kondisional

Aktifkan hanya integrasi yang telah mendapat mandat dan memiliki kontrak, pemilik layanan, kredensial, sandbox, prosedur kegagalan, rekonsiliasi, bukti uji, dan persetujuan operasional. Kegagalan integrasi tidak boleh menghasilkan klaim keberhasilan palsu.

## Bahasa klaim yang diperbolehkan

Gunakan pernyataan yang dapat dibuktikan, misalnya:

- “SIMSA adalah aplikasi internal/beta Ditjen PTPP”;
- “pedoman ATR/BPN dan ANRI digunakan sebagai rujukan desain”;
- “kontrol tertentu telah tersedia pada kode dan masih memerlukan verifikasi operasional”; atau
- “fondasi integrasi tersedia tetapi belum diaktifkan.”

Jangan menggunakan klaim “tersertifikasi”, “sepenuhnya patuh”, “resmi terintegrasi dengan SRIKANDI”, “ditandatangani BSrE”, “WORM aktif”, atau “terpantau SIEM” tanpa bukti dan persetujuan yang berlaku.

## Acuan dokumen

- [Ringkasan Implementasi dan Verifikasi](RINGKASAN_IMPLEMENTASI_DAN_VERIFIKASI.md)
- [Checklist Deployment Arsip Digital](DEPLOYMENT_CHECKLIST_ARSIP_DIGITAL.md)
- [Peta Rujukan Desain Permen 2/2026 dan ANRI](KEPATUHAN_PERMEN_2_2026_DAN_ANRI.md)
- [Fondasi Integrasi SRIKANDI](INTEGRASI_SRIKANDI.md)
