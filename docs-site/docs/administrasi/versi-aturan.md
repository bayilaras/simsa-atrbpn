---
title: Versi Aturan Klasifikasi dan JRA
---

# Versi Aturan Klasifikasi dan JRA

SIMSA menyimpan klasifikasi arsip dan Jadwal Retensi Arsip (JRA) sebagai **edisi aturan yang berversi**. Versi aktif bersifat hanya-baca agar arsip yang telah diregistrasi tetap dapat menunjukkan aturan yang dipakai ketika keputusan dibuat.

Sumber awal aplikasi memuat 842 baris klasifikasi Permen ATR/BPN Nomor 10 Tahun 2018 (620 butir dapat dipilih) dan 391 aturan retensi yang dapat dipilih dari Permen ATR/BPN Nomor 8 Tahun 2020. Pemetaan tematik klasifikasi ke JRA hanya saran pencarian, bukan hubungan hukum otomatis; arsiparis tetap memilih JRA yang sesuai isi, fungsi, dan pemicu retensi arsip.

## Menerbitkan perubahan aturan

Super Admin menyiapkan, mengajukan, dan mengaktifkan edisi. Penelaah dan penyetuju dapat memakai akun admin Ditjen/Sesditjen yang berbeda; aplikasi menolak perangkapan pelaku pada tahapan maker-checker yang harus independen.

1. Buka **Master Data > Versi Aturan**.
2. Buat draft dari versi aktif.
3. Catat nomor/versi, tanggal berlaku, dasar hukum, dan URL sumber resmi. Unggah PDF sumber; SHA-256 dan jumlah halaman dihitung server, bukan diketik sebagai bukti.
4. Edit butir atau impor manifest JSON ke draft.
5. Verifikasi manifest jumlah/cakupan halaman dan buat laporan diff serta dampak.
6. Jalankan validasi dan selesaikan semua kesalahan.
7. Jalankan **Ajukan → Telaah → Setujui → Aktifkan** dengan akun berbeda dan catatan substantif.

PDF sampai 50 MiB diunggah langsung ke namespace private Blob yang terikat ID draft. Server kemudian mengunduh ulang objek tersebut, memeriksa MIME/signature dan ukuran, menghitung SHA-256 serta jumlah halaman, lalu menyimpan locator hanya secara internal. Fallback multipart dibatasi 4 MiB dan juga mempertahankan byte yang diterima pada private Blob.

Pemakaian ulang PDF sumber membuat objek baru pada namespace draft. Server mengunduh ulang salinan, membandingkan SHA-256, ukuran, dan jumlah halaman dengan bukti edisi aktif, lalu mencatat waktu dan pelaku verifikasi saat ini; bukti pelaku/waktu edisi lama tidak diwariskan.

Admin tata kelola dan auditor dapat memakai **Lihat/Unduh PDF** melalui stream endpoint terautentikasi. Locator Blob tidak dikirim ke browser dan akses dicatat; baseline lama tanpa bitstream private ditolak dengan status `409`, bukan diarahkan ke URL publik.

Aktivasi menutup masa berlaku versi sebelumnya. Arsip lama tetap menunjuk versi, butir, dasar hukum, hash dokumen, dan snapshot keputusan yang lama. Perubahan item dan workflow ditulis transaksional ke rantai audit append-only yang dapat diperiksa integritasnya.

### Kontrak perluasan penyimpanan bukti

Direct upload untuk bukti appraisal, pemicu retensi, atau serah permanen harus memakai token yang terikat `purpose` dan ID entitas, namespace private terikat tujuan/ID, serta server HEAD/refetch untuk memeriksa locator canonical, MIME, ukuran, signature, dan SHA-256. Locator internal, hash, ukuran, MIME, waktu, serta pelaku harus disimpan atomik bersama keputusan; hash/URI dari klien bukan bukti fixity otoritatif sebelum verifikasi server selesai.

## Rekonsiliasi arsip lama

Arsip berstatus `legacy_unverified` dapat dibaca tetapi tidak dapat masuk penyusutan. Dari detail arsip, pilih **Rekonsiliasi Aturan**, tentukan butir klasifikasi dan JRA aktif, isi alasan yang spesifik, lalu periksa tab **Jejak Aturan**. Revisi lama tidak dihapus. Rekonsiliasi ditolak saat legal hold, arsip sudah berada dalam batch penyusutan, atau penyusutan telah dieksekusi.

## Keputusan yang memerlukan penilaian

Hanya rumusan JRA yang secara eksplisit dan tanpa syarat menyatakan **Musnah** atau **Permanen** yang menjadi hasil akhir otomatis. Ketentuan bersyarat atau kontekstual menjadi **Dinilai Kembali**. Pemicu berbasis peristiwa harus memiliki jenis, label, tanggal, dan bukti.

:::note Batas penggunaan
Fitur ini adalah kontrol tata kelola aplikasi internal, bukan sertifikasi kepatuhan atau pengganti verifikasi Unit Kearsipan.
:::
