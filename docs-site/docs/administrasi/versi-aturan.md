---
title: Versi Aturan Klasifikasi dan JRA
---

# Versi Aturan Klasifikasi dan JRA

SIMSA menyimpan klasifikasi arsip dan Jadwal Retensi Arsip (JRA) sebagai **edisi aturan yang berversi**. Versi aktif bersifat hanya-baca agar arsip yang telah diregistrasi tetap dapat menunjukkan aturan yang dipakai ketika keputusan dibuat.

Sumber awal aplikasi memuat 842 baris klasifikasi Permen ATR/BPN Nomor 10 Tahun 2018 (620 butir dapat dipilih) dan 391 aturan retensi yang dapat dipilih dari Permen ATR/BPN Nomor 8 Tahun 2020. Pemetaan tematik klasifikasi ke JRA hanya saran pencarian, bukan hubungan hukum otomatis; arsiparis tetap memilih JRA yang sesuai isi, fungsi, dan pemicu retensi arsip.

## Menerbitkan perubahan aturan

Hanya **Super Admin** yang dapat mengubah dan mengaktifkan aturan.

1. Buka **Master Data > Versi Aturan**.
2. Buat draft dari versi aktif.
3. Catat nomor/versi, tanggal berlaku, dasar hukum, dokumen sumber, URL, dan SHA-256 PDF sumber.
4. Edit butir atau impor manifest JSON ke draft.
5. Jalankan validasi dan selesaikan semua kesalahan.
6. Aktifkan setelah tanggal berlaku dan pemeriksaan sesuai SOP internal.

Aktivasi menutup masa berlaku versi sebelumnya. Arsip lama tetap menunjuk versi, butir, dasar hukum, hash dokumen, dan snapshot keputusan yang lama.

## Rekonsiliasi arsip lama

Arsip berstatus `legacy_unverified` dapat dibaca tetapi tidak dapat masuk penyusutan. Dari detail arsip, pilih **Rekonsiliasi Aturan**, tentukan butir klasifikasi dan JRA aktif, isi alasan yang spesifik, lalu periksa tab **Jejak Aturan**. Revisi lama tidak dihapus. Rekonsiliasi ditolak saat legal hold, arsip sudah berada dalam batch penyusutan, atau penyusutan telah dieksekusi.

## Keputusan yang memerlukan penilaian

Hanya rumusan JRA yang secara eksplisit dan tanpa syarat menyatakan **Musnah** atau **Permanen** yang menjadi hasil akhir otomatis. Ketentuan bersyarat atau kontekstual menjadi **Dinilai Kembali**. Pemicu berbasis peristiwa harus memiliki jenis, label, tanggal, dan bukti.

:::note Batas penggunaan
Fitur ini adalah kontrol tata kelola aplikasi internal, bukan sertifikasi kepatuhan atau pengganti verifikasi Unit Kearsipan.
:::
