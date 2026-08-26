# Versi Aturan Klasifikasi dan JRA

SIMSA menyimpan klasifikasi arsip dan Jadwal Retensi Arsip (JRA) sebagai **edisi aturan yang berversi**. Versi yang sudah aktif bersifat hanya-baca. Perubahan regulasi tidak dilakukan dengan menimpa data lama, karena arsip yang telah diregistrasi harus tetap dapat menunjukkan aturan yang dipakai pada saat keputusan dibuat.

Sumber awal yang dimuat dalam aplikasi adalah:

- klasifikasi arsip Permen ATR/BPN Nomor 10 Tahun 2018: 842 baris sumber, 620 butir yang dapat dipilih, dengan lingkup Kementerian, Kanwil, dan Kantah; dan
- JRA Permen ATR/BPN Nomor 8 Tahun 2020: 391 aturan retensi yang dapat dipilih, ditambah simpul hierarki untuk navigasi.

Pemetaan tematik klasifikasi ke JRA hanya merupakan **saran pencarian**. Pemetaan tersebut bukan hubungan hukum otomatis; arsiparis tetap memilih butir JRA yang sesuai dengan isi, fungsi, dan pemicu retensi arsip.

## Menerbitkan perubahan aturan

Hanya **Super Admin** yang dapat mengubah dan mengaktifkan aturan.

1. Buka **Master Data > Versi Aturan**.
2. Pilih instrumen Klasifikasi atau JRA, lalu klik **Buat Draft dari Versi Aktif**.
3. Isi nomor/versi, tanggal berlaku, dasar hukum, nama dokumen sumber, URL sumber bila ada, serta SHA-256 PDF sumber.
4. Edit butir pada halaman master atau impor manifest JSON ke draft. Impor mengganti isi draft secara atomik; versi aktif tidak berubah.
5. Jalankan **Validasi**. Perbaiki kode ganda, parent hilang/ambigu, siklus hierarki, item parent yang dapat dipilih, atau durasi yang tidak valid.
6. Aktifkan draft hanya setelah tanggal berlakunya dan setelah pemeriksaan dua orang sesuai SOP internal.

Aktivasi menutup masa berlaku versi sebelumnya. Arsip lama tetap menunjuk versi, butir, dasar hukum, hash dokumen, dan snapshot keputusan yang lama.

## Rekonsiliasi arsip lama

Arsip yang dibuat sebelum mekanisme ini berstatus `legacy_unverified`. Arsip tersebut tetap dapat dibaca, tetapi tidak dapat masuk proses penyusutan.

1. Buka detail arsip dan periksa badge **Provenance Aturan**.
2. Pilih **Rekonsiliasi Aturan**.
3. Pilih butir klasifikasi dan JRA aktif berdasarkan ID daftar, bukan dengan mengetik keputusan retensi bebas.
4. Isi alasan koreksi yang spesifik, lalu simpan.
5. Periksa tab **Jejak Aturan**. Revisi lama tidak dihapus; revisi baru menaut ke snapshot sebelumnya.

Rekonsiliasi ditolak ketika arsip sedang legal hold, sudah masuk batch penyusutan, atau penyusutannya telah dieksekusi.

## Keputusan yang memerlukan penilaian

Hanya keterangan JRA yang secara eksplisit dan tanpa syarat menyatakan **Musnah** atau **Permanen** yang menjadi hasil akhir otomatis. Ketentuan bersyarat, penyerahan berkas tertentu, bahan referensi, atau rumusan kontekstual diberi hasil **Dinilai Kembali**. Pemicu berbasis peristiwa harus dilengkapi jenis, label, tanggal, dan bukti sebelum tanggal akhir retensi dapat dihitung.

> Fitur ini adalah kontrol tata kelola aplikasi internal, bukan sertifikasi kepatuhan atau pengganti verifikasi Unit Kearsipan.
