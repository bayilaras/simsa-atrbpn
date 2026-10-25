---
sidebar_position: 2
title: Profil Aplikasi Internal
---

# Profil Aplikasi Internal SIMSA

SIMSA adalah aplikasi internal/beta Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan (Ditjen PTPP) untuk mempermudah pengelolaan surat, arsip, dosir, pencarian, layanan, retensi, dan penyusutan.

SIMSA digunakan sebagai aplikasi mandiri. Integrasi SRIKANDI tidak termasuk ruang lingkup penerapan saat ini dan tidak menjadi prasyarat fitur inti. SRIKANDI dapat menjadi referensi pengalaman pengguna; peningkatan SIMSA dinilai dari keberhasilan tugas, kemudahan pencarian, kejelasan status, dan hasil UAT, tanpa klaim kesetaraan fitur yang belum diuji.

Permen ATR/BPN Nomor 2 Tahun 2026 dan ketentuan ANRI dipakai sebagai **rujukan desain dan tata kelola**. Penggunaan rujukan tersebut bukan sertifikasi, opini hukum, akreditasi, atau pernyataan bahwa SIMSA sepenuhnya patuh.

Gunakan instrumen ATR/BPN yang sudah berlaku untuk tata naskah dinas, klasifikasi, JRA, serta keamanan dan akses. Pemasangan SIMSA tidak dengan sendirinya memerlukan penerbitan ulang instrumen tersebut; pengaturan aplikasi mengikuti instrumen dan penugasan instansi. [Mulai Inventaris Internal](./mulai-inventaris-internal.md) menjelaskan alur metadata dan arsip fisik tanpa menunggu konektor atau lampiran digital.

Kewajiban instansi menerapkan SRIKANDI dalam lingkup [Peraturan ANRI Nomor 4 Tahun 2021, Pasal 2–3](https://jdih.anri.go.id/storage/rules/January2024/GfOD5OlHAJWvwmMcHY4O.pdf) tetap berlaku dan dibedakan dari aktivasi konektor API pada aplikasi pendukung. SIMSA tidak menggantikan SRIKANDI; label internal tidak memberikan pengecualian. Integrasi atau migrasi mengikuti mekanisme resmi instansi.

## Prioritas

1. Mempermudah pekerjaan harian pengguna Ditjen PTPP.
2. Menjaga metadata, klasifikasi, dosir, retensi, legal hold, dan penyusutan tetap tertib.
3. Melindungi data dan mencatat tindakan penting secara proporsional terhadap risiko.
4. Menyempurnakan navigasi, formulir, pencarian, dan kejelasan status berdasarkan pengujian serta masukan pengguna.

Kemudahan penggunaan tidak boleh menghapus pemeriksaan hak akses, isolasi unit, karantina file, audit, validasi retensi, legal hold, atau kontrol keamanan dasar.

## Baseline internal

Kontrol berikut berlaku sesuai fungsi yang digunakan. Inventaris metadata dan arsip fisik dapat berjalan tanpa unggahan; kontrol penyimpanan, pemindaian malware, dan fixity berlaku ketika menggunakan berkas digital:

- akun terprovisi, least privilege, isolasi unit, dan akses kelas keamanan yang gagal-tertutup;
- private storage dan gateway file terautentikasi;
- checksum/fixity, karantina, dan pelepasan file hanya setelah pemeriksaan malware dinyatakan bersih;
- audit tindakan kritis, perlindungan dan retensi log, backup, serta restore drill;
- JRA yang diverifikasi, pemicu retensi berbukti, legal hold, dan pemisahan tugas penyusutan; serta
- pengelolaan secret, TLS, konfigurasi produksi, pemantauan dasar, dan penanganan insiden.

## Kapabilitas kondisional

| Kapabilitas | Status internal | Aturan aktivasi |
|---|---|---|
| Konektor API SRIKANDI di SIMSA | Di luar ruang lingkup penerapan saat ini; producer dan outbound nonaktif; bukan prasyarat fitur inti | Pertahankan modul dan riwayat yang ada. Aktivasi baru memerlukan penetapan ruang lingkup tersendiri, kontrak API, sandbox, pemetaan, worker, rekonsiliasi, dan persetujuan resmi |
| Tanda tangan elektronik BSrE/PSrE | Di luar ruang lingkup produk | Tidak diaktifkan; endpoint legacy tetap gagal-tertutup dan artefak simulasi selalu tidak sah |
| Object lock/WORM | Deferred/kondisional | Terapkan bila kelas data, retensi, arsitektur storage, atau keputusan risiko mensyaratkannya; jangan mengklaim WORM tanpa bukti |
| SIEM/SOC eksternal | Deferred/kondisional | Terapkan bila kebijakan atau risiko mensyaratkannya; audit/log lokal, retensi, alert dasar, dan respons insiden tetap berjalan |

Data Rahasia/Sangat Rahasia memerlukan keputusan formal dan kontrol tambahan sesuai kebijakan. Profil ini tidak dengan sendirinya memberi izin menggunakan kelas tersebut.

## Konfigurasi profil inti

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

Menu dan rute SRIKANDI tidak tampil pada frontend, pembuatan antrean integrasi baru dan lalu lintas keluar tetap nonaktif, dan konektor eksternal tidak menjadi syarat startup. Worker SRIKANDI tidak perlu dijalankan. Selaraskan nilai profil frontend dan backend pada setiap deployment.

Migrasi database tetap mengikuti seluruh riwayat skema yang berlaku, termasuk tabel integrasi historis. Menonaktifkan konektor tidak berarti menghapus modul, melewati migrasi, atau menghapus data lama.

## Batas klaim

Pernyataan yang tepat adalah “aplikasi internal/beta”, “pedoman digunakan sebagai rujukan desain”, atau “fondasi integrasi tersedia tetapi belum diaktifkan”. Jangan menyatakan “tersertifikasi”, “sepenuhnya patuh”, “resmi tersinkron SRIKANDI”, “ditandatangani elektronik oleh SIMSA”, “WORM aktif”, atau “terpantau SIEM” tanpa bukti dan persetujuan yang berlaku.

Lihat [Fondasi Integrasi SRIKANDI](/administrasi/integrasi-srikandi) untuk batas teknis connector yang tetap nonaktif secara default.
