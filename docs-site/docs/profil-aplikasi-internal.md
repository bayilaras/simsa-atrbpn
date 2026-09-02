---
sidebar_position: 2
title: Profil Aplikasi Internal
---

# Profil Aplikasi Internal SIMSA

SIMSA adalah aplikasi internal/beta Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan (Ditjen PTPP) untuk mempermudah pengelolaan surat, arsip, dosir, pencarian, layanan, retensi, dan penyusutan.

Permen ATR/BPN Nomor 2 Tahun 2026 dan ketentuan ANRI dipakai sebagai **rujukan desain dan tata kelola**. Penggunaan rujukan tersebut bukan sertifikasi, opini hukum, akreditasi, atau pernyataan bahwa SIMSA sepenuhnya patuh.

## Prioritas

1. Mempermudah pekerjaan harian pengguna Ditjen PTPP.
2. Menjaga metadata, klasifikasi, dosir, retensi, legal hold, dan penyusutan tetap tertib.
3. Melindungi data dan mencatat tindakan penting secara proporsional terhadap risiko.
4. Mengaktifkan integrasi eksternal hanya setelah ada mandat, kontrak, pemilik proses, dan bukti uji resmi.

Kemudahan penggunaan tidak boleh menghapus pemeriksaan hak akses, isolasi unit, karantina file, audit, validasi retensi, legal hold, atau kontrol keamanan dasar.

## Baseline internal

Kontrol berikut tetap berlaku pada profil inti:

- akun terprovisi, least privilege, isolasi unit, dan akses kelas keamanan yang gagal-tertutup;
- private storage dan gateway file terautentikasi;
- checksum/fixity, karantina, dan pelepasan file hanya setelah pemeriksaan malware dinyatakan bersih;
- audit tindakan kritis, perlindungan dan retensi log, backup, serta restore drill;
- JRA yang diverifikasi, pemicu retensi berbukti, legal hold, dan pemisahan tugas penyusutan; serta
- pengelolaan secret, TLS, konfigurasi produksi, pemantauan dasar, dan penanganan insiden.

## Kapabilitas kondisional

| Kapabilitas | Status internal | Aturan aktivasi |
|---|---|---|
| SRIKANDI | Opsional/deferred; outbound nonaktif secara default | Aktifkan hanya bila diwajibkan kebijakan internal dan kontrak API, sandbox, pemetaan, worker, rekonsiliasi, serta persetujuan resmi tersedia |
| Tanda tangan elektronik BSrE/PSrE | Di luar ruang lingkup produk | Tidak diaktifkan; endpoint legacy tetap gagal-tertutup dan artefak simulasi selalu tidak sah |
| Object lock/WORM | Deferred/kondisional | Terapkan bila kelas data, retensi, arsitektur storage, atau keputusan risiko mensyaratkannya; jangan mengklaim WORM tanpa bukti |
| SIEM/SOC eksternal | Deferred/kondisional | Terapkan bila kebijakan atau risiko mensyaratkannya; audit/log lokal, retensi, alert dasar, dan respons insiden tetap berjalan |

Data Rahasia/Sangat Rahasia memerlukan keputusan formal dan kontrol tambahan sesuai kebijakan. Profil ini tidak dengan sendirinya memberi izin menggunakan kelas tersebut.

## Konfigurasi profil inti

```dotenv
# Backend
APP_PROFILE=internal
SRIKANDI_ENABLED=false

# Frontend (ditetapkan saat build)
VITE_APP_PROFILE=internal
VITE_FEATURE_SRIKANDI=false
```

Menu dan rute SRIKANDI tidak tampil pada frontend, lalu lintas keluar tetap nonaktif, dan konektor eksternal tidak menjadi syarat startup. Selaraskan nilai profil frontend dan backend pada setiap deployment.

## Batas klaim

Pernyataan yang tepat adalah “aplikasi internal/beta”, “pedoman digunakan sebagai rujukan desain”, atau “fondasi integrasi tersedia tetapi belum diaktifkan”. Jangan menyatakan “tersertifikasi”, “sepenuhnya patuh”, “resmi tersinkron SRIKANDI”, “ditandatangani elektronik oleh SIMSA”, “WORM aktif”, atau “terpantau SIEM” tanpa bukti dan persetujuan yang berlaku.

Lihat [Fondasi Integrasi SRIKANDI](/administrasi/integrasi-srikandi) untuk batas teknis connector yang tetap nonaktif secara default.
