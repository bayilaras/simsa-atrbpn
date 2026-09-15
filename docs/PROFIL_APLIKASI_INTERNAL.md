# Profil Aplikasi Internal SIMSA

## Status dan tujuan

SIMSA adalah aplikasi internal Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan (Ditjen PTPP) untuk membantu pengelolaan surat, arsip, dosir, pencarian, layanan, retensi, dan penyusutan secara lebih mudah, tertib, serta dapat ditelusuri.

SIMSA dikembangkan dan digunakan sebagai aplikasi mandiri. Integrasi SRIKANDI tidak termasuk ruang lingkup penerapan saat ini dan tidak menjadi prasyarat fitur inti. SRIKANDI dapat menjadi referensi pengalaman pengguna; peningkatan SIMSA dinilai dari keberhasilan tugas, kemudahan pencarian, kejelasan status, dan hasil UAT, tanpa klaim kesetaraan fitur yang belum diuji.

Permen ATR/BPN Nomor 2 Tahun 2026 dan ketentuan ANRI digunakan sebagai **rujukan desain dan tata kelola**. Dokumen tersebut bukan instruksi eksekusi bagi pengembang dan pencantumannya tidak berarti SIMSA telah disertifikasi atau dinyatakan sepenuhnya patuh oleh ATR/BPN, ANRI, BSSN, BSrE, atau lembaga lain.

Profil ini bukan opini hukum, sertifikasi keamanan, akreditasi, pengganti SOP, atau pengganti keputusan pejabat yang berwenang. Gunakan instrumen ATR/BPN yang sudah berlaku untuk tata naskah dinas, klasifikasi, JRA, serta keamanan dan akses; pemasangan SIMSA tidak dengan sendirinya memerlukan penerbitan ulang instrumen tersebut. Pengaturan dan pemetaan aplikasi mengikuti instrumen serta penugasan instansi.

Untuk mulai mencatat metadata dan lokasi arsip fisik, ikuti [Mulai Inventaris Internal](../docs-site/docs/mulai-inventaris-internal.md). Alur ini tidak menunggu aktivasi konektor API SRIKANDI atau penyimpanan lampiran digital.

## Prioritas produk

Urutan prioritas SIMSA adalah:

1. mempermudah pekerjaan harian pengguna Ditjen PTPP;
2. menjaga metadata, klasifikasi, dosir, pencarian, retensi, legal hold, dan alur penyusutan tetap tertib;
3. melindungi kerahasiaan, integritas, ketersediaan, dan akuntabilitas data secara proporsional terhadap risiko; dan
4. menyempurnakan navigasi, formulir, pencarian, dan kejelasan status berdasarkan pengujian serta masukan pengguna.

Kemudahan operasional tidak boleh dicapai dengan menghapus pemeriksaan hak akses, isolasi unit, karantina file, audit, validasi retensi, legal hold, atau kontrol keamanan dasar lainnya.

## Ruang lingkup inti

Profil internal inti mencakup:

- akun terprovisi, role, dan unit kerja;
- surat masuk/keluar, distribusi, arsip, dosir, serta pencarian;
- klasifikasi keamanan dan akses per rekod;
- registrasi arsip elektronik, versi, checksum/fixity, QC alih media, dan riwayat preservasi;
- JRA, pemicu retensi berbasis peristiwa, legal hold, serta penyusutan dengan pemisahan tugas;
- peminjaman, layanan arsip, lokasi simpan, arsip vital/terjaga, audit, dan laporan.

SIMSA tidak diposisikan sebagai pengganti aplikasi umum atau layanan nasional yang ditetapkan pemerintah. Kewajiban instansi menerapkan SRIKANDI dalam lingkup [Peraturan ANRI Nomor 4 Tahun 2021, Pasal 2–3](https://jdih.anri.go.id/storage/rules/January2024/GfOD5OlHAJWvwmMcHY4O.pdf) tetap berlaku. Kewajiban tersebut dibedakan dari aktivasi konektor API pada setiap aplikasi pendukung. Label internal tidak memberikan pengecualian; integrasi atau migrasi mengikuti mekanisme resmi instansi.

## Baseline internal yang tidak boleh dihilangkan

Kontrol berikut berlaku sesuai fungsi yang digunakan, terlepas dari ada atau tidaknya integrasi eksternal. Inventaris metadata dan arsip fisik dapat berjalan tanpa unggahan; kontrol penyimpanan, pemindaian malware, dan fixity berikut berlaku ketika menggunakan berkas digital:

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
| Konektor API SRIKANDI di SIMSA | Di luar ruang lingkup penerapan saat ini; producer dan outbound nonaktif; bukan prasyarat fitur inti | Hanya jika ruang lingkup integrasi kemudian ditetapkan secara terpisah | Pertahankan modul dan riwayat yang ada; aktivasi baru memerlukan kontrak API, sandbox, kredensial, pemetaan data, worker, rekonsiliasi, dan persetujuan resmi |
| Tanda tangan elektronik BSrE/PSrE | Di luar ruang lingkup produk berdasarkan keputusan pemilik aplikasi | Tidak diaktifkan pada SIMSA | Pertahankan endpoint legacy dalam keadaan nonaktif; artefak simulasi tidak sah dan tidak boleh dipakai sebagai bukti |
| Object lock/WORM | Deferred atau kondisional sesuai kelas data, retensi, arsitektur storage, dan keputusan risiko | Jika kebijakan internal atau klasifikasi data mensyaratkan immutability infrastruktur | Baseline tetap memakai objek privat, backup, fixity, pembatasan admin, dan audit; gunakan versioning bila tersedia dan jangan mengklaim WORM tanpa bukti konfigurasi |
| SIEM/SOC eksternal | Deferred atau kondisional sesuai skala, risiko, dan kebijakan operasi | Jika diwajibkan kebijakan keamanan atau hasil asesmen risiko | Audit/log lokal, kontrol akses log, alert dasar, retensi, sinkronisasi waktu, dan respons insiden tetap harus berjalan |

KMS/HSM, DLP, content disarm, watermark dinamis, dan akreditasi juga diterapkan berdasarkan kelas data, risiko, serta kebijakan internal. Data Rahasia/Sangat Rahasia tidak boleh digunakan hanya berdasarkan profil ini; diperlukan keputusan formal dan kontrol tambahan yang sesuai.

## Mode penerapan

### Profil inti internal

Gunakan fungsi operasional inti dengan baseline keamanan di atas. Penandatanganan BSrE/PSrE bukan bagian dari produk. Untuk penerapan mandiri ini, konektor API dan producer SRIKANDI tetap nonaktif. Prasyarat penyimpanan privat, antivirus, dan bukti pada fitur arsip digital tetap mengikuti fungsi yang digunakan.

Konfigurasi bawaan yang disarankan:

```dotenv
# Backend
SIMSA_APP_MODE=full
APP_PROFILE=internal
SRIKANDI_ENABLED=false
SRIKANDI_PRODUCER_ENABLED=false

# Frontend (ditetapkan saat build)
VITE_APP_MODE=full
VITE_APP_PROFILE=internal
VITE_FEATURE_SRIKANDI=false
```

Dengan konfigurasi ini, menu dan rute SRIKANDI tidak tampil pada frontend, pembuatan antrean integrasi baru dan lalu lintas keluar tetap nonaktif, dan konektor eksternal tidak menjadi syarat startup aplikasi. Worker SRIKANDI tidak perlu dijalankan. Nilai profil frontend dan backend harus diselaraskan pada setiap deployment.

Migrasi database tetap mengikuti seluruh riwayat skema yang berlaku, termasuk tabel integrasi historis. Menonaktifkan konektor tidak berarti menghapus modul, melewati migrasi, atau menghapus data lama.

### Profil integrasi kondisional

Aktifkan hanya integrasi yang telah mendapat mandat dan memiliki kontrak, pemilik layanan, kredensial, sandbox, prosedur kegagalan, rekonsiliasi, bukti uji, dan persetujuan operasional. Kegagalan integrasi tidak boleh menghasilkan klaim keberhasilan palsu.

## Bahasa klaim yang diperbolehkan

Gunakan pernyataan yang dapat dibuktikan, misalnya:

- “SIMSA adalah aplikasi internal/beta Ditjen PTPP”;
- “pedoman ATR/BPN dan ANRI digunakan sebagai rujukan desain”;
- “kontrol tertentu telah tersedia pada kode dan masih memerlukan verifikasi operasional”; atau
- “fondasi integrasi tersedia tetapi belum diaktifkan.”

Jangan menggunakan klaim “tersertifikasi”, “sepenuhnya patuh”, “resmi terintegrasi dengan SRIKANDI”, “ditandatangani elektronik oleh SIMSA”, “WORM aktif”, atau “terpantau SIEM” tanpa bukti dan persetujuan yang berlaku.

## Acuan dokumen

- [Ringkasan Implementasi dan Verifikasi](RINGKASAN_IMPLEMENTASI_DAN_VERIFIKASI.md)
- [Checklist Deployment Arsip Digital](DEPLOYMENT_CHECKLIST_ARSIP_DIGITAL.md)
- [Peta Rujukan Desain Permen 2/2026 dan ANRI](KEPATUHAN_PERMEN_2_2026_DAN_ANRI.md)
- [Fondasi Integrasi SRIKANDI](INTEGRASI_SRIKANDI.md)
