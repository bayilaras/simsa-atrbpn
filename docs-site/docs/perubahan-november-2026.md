---
title: Perubahan November 2026
description: Ringkasan perubahan SIMSA yang dirasakan pegawai pada pembaruan November 2026
---

# Perubahan November 2026

Halaman ini merangkum perubahan SIMSA yang langsung terasa saat bekerja. Langkah lengkapnya ada di halaman panduan masing-masing.

:::info Setelah pembaruan dipasang
Sebagian besar pengguna diminta masuk sekali lagi. Hal ini wajar: masuk kembali dengan akun yang sama.
:::

## Masuk, sesi, dan akun

- **Sesi:** SIMSA keluar otomatis setelah 30 menit tanpa aktivitas. Lima menit sebelumnya muncul peringatan dengan tombol **Tetap Masuk**. Setelah keluar karena tidak aktif, halaman masuk menampilkan *Sesi berakhir karena tidak ada aktivitas. Silakan masuk kembali.*
- **Isian yang belum disimpan:** isian formulir Tambah/Edit Surat Masuk, Tambah/Edit Surat Keluar, dan dialog **Arsipkan Surat** disimpan sementara di tab peramban yang sama. Setelah masuk kembali atau memuat ulang halaman, SIMSA menanyakan *Pulihkan isian yang belum disimpan?* dengan pilihan **Pulihkan isian** atau **Buang isian**. Berkas PDF yang sudah dipilih perlu dipilih ulang. Isian tidak dapat dipulihkan bila tab sudah ditutup atau Anda menekan **Keluar**. Lihat [Sesi dan keluar aplikasi](./panduan-pengguna.md#sesi-dan-keluar-aplikasi).
- **Kata sandi baru** minimal 12 karakter, tidak memuat nama atau bagian depan email pengguna, dan bukan kata sandi yang umum. Kata sandi lama tetap dapat dipakai untuk masuk sampai diganti.
- **Pengaturan** kini ada di menu akun (kanan atas) untuk semua peran, sehingga setiap pegawai dapat mengganti kata sandinya di **Pengaturan › Profil**.
- **Masuk dengan Google:** bila gagal, halaman masuk menjelaskan sebabnya dalam bahasa Indonesia, misalnya *Akun Anda tidak aktif atau belum disetujui. Hubungi Super Admin.*
- **Peramban:** SIMSA mendukung Chrome dan Edge versi 111 ke atas, Firefox 128 ke atas, dan Safari 16.4 ke atas. Peramban yang lebih lama menampilkan *Peramban ini tidak didukung SIMSA. Gunakan Chrome, Edge, Firefox, atau Safari versi terbaru.* Lihat [Browser yang Kompatibel](./tutorial-dasar/browser-kompatibel.md).
- **Versi baru:** bila SIMSA diperbarui saat Anda bekerja, muncul *Versi baru SIMSA tersedia. Simpan pekerjaan Anda, lalu muat ulang.* dengan tombol **Nanti** dan **Muat ulang**. Halaman tidak dimuat ulang sendiri selama formulir surat atau dialog Arsipkan masih berisi isian yang belum disimpan.
- Header, Dashboard, dan halaman detail surat menampilkan **nama** unit kerja, bukan kodenya.

## Surat masuk dan surat keluar

- **No. Agenda** (surat masuk) dan **No. Urut** (surat keluar) dapat diisi saat menambah surat untuk melanjutkan nomor dari buku agenda kantor. Kosongkan untuk nomor otomatis; formulir menampilkan *Nomor otomatis berikutnya: N*. Nomor yang sudah dipakai, termasuk nomor surat yang sudah dihapus, ditolak.
- Bila tanggal surat diubah ke tahun lain, surat mendapat nomor agenda atau nomor urut baru di tahun itu. Tahun surat harus antara 2000 dan 2100.
- Formulir memperingatkan **Nomor sudah terdaftar** bila nomor surat yang diketik sudah tercatat. Peringatan ini tidak menghalangi penyimpanan.
- Bila dua orang mengubah surat yang sama, penyimpanan kedua ditolak dengan pesan *Data ini sudah diubah pengguna lain sejak Anda membukanya…* Muat ulang halaman, lalu ulangi perubahan Anda.
- Menghapus surat keluar kini juga meminta **Alasan penghapusan** (minimal 10 karakter). Surat yang dihapus hilang dari semua daftar; hanya Super Admin yang dapat memulihkannya lewat tab **Surat Terhapus**.
- Daftar surat memiliki pilihan **Urutkan** (**Terakhir dicatat**, **Tanggal surat (terbaru)**, **Tanggal surat (terlama)**). Penyaring **Disposisi Ke** pada Surat Masuk memuat nama unit kerja serta Kabag Program dan Hukum dan Kabag Kepegawaian Keuangan dan Umum.
- Teks yang memuat tanda kurung sudut, misalnya `Luas < 5 ha` atau `<e-Office>`, disimpan seperti diketik. Baris baru pada perihal dan isian panjang lain tetap tampil di halaman detail.
- Saat menyimpan surat dengan berkas PDF, formulir menampilkan kemajuan unggah, misalnya *Mengunggah berkas: 45%*.

## Impor daftar surat dan arsip

- Kolom **No**, **No. Agenda**, atau **Nomor Agenda** pada sumber disimpan sebagai nomor agenda (surat masuk) atau nomor urut (surat keluar) bila nomor itu belum dipakai. **Impor register lama lebih dahulu** sebelum mencatat surat baru di tahun yang sama; bila tidak, baris yang nomornya sudah terpakai mendapat nomor lain.
- Pratinjau kini memeriksa setiap baris seperti saat impor dan menampilkan *n dari total baris akan ditolak* beserta alasannya, sebelum Anda menekan **Impor**.
- Surat masuk bernomor dianggap sama bila nomor, tahun, dan pengirimnya sama.
- Untuk Google Sheets, aktifkan berbagi link hanya selama impor. Register yang memuat surat Terbatas atau lebih tinggi diunduh sebagai Excel (.xlsx) lalu diimpor dengan **Impor CSV/XLSX**.
- **Impor CSV** arsip menerima pemisah koma, titik koma, atau tab dan CSV biasa dari Excel; batasnya 1.000 rekod dan 4 MiB per berkas; tanggal ditulis dengan urutan hari, bulan, tahun.

## Arsip, dosir, dan formulir

- Kemajuan masa aktif arsip (**Kemajuan Masa Aktif**) baru dihitung setelah pemicu retensi terverifikasi. Sebelum itu tertulis *Menunggu verifikasi pemicu retensi* atau *Menunggu rekonsiliasi klasifikasi dan JRA*; kolom **Nasib Akhir** di daftar arsip menulis **Menunggu verifikasi** atau **Menunggu rekonsiliasi**.
- Isian **PIC** kini bernama **Penanggung Jawab**.
- Dosir: menu kartu dosir memuat **Edit**, catatan surat dalam dosir ditampilkan, dan surat dapat dilepas dengan tombol **Lepas dari dosir**.
- Halaman **Formulir** hanya memberi tombol untuk Formulir 4 dan 6 (**Ekspor dari Arsip**) serta Formulir 27 (**Buka Arsip Vital**); formulir lain **Diisi manual dari template**.
- **Cetak Daftar** di Arsip Vital mengikuti penyaring yang sedang dipakai dan memuat nama unit kerja serta kolom **Lokasi Cadangan** dan **Kategori**.
- Kode QR lokasi simpan diunduh lewat **Unduh Kode QR**.
- **Generate Berita Acara** di Manajemen Retensi memberi tahu *Belum ada arsip yang memenuhi syarat* bila tidak ada arsip yang dapat dimuat.

## Laporan, ekspor, dan pencarian

- Waktu pada berkas ekspor ditulis dalam WIB. Ekspor Super Admin dari daftar surat atau arsip dengan pilihan **Semua Unit Kerja** memuat kolom **Unit Kerja**. Teks yang terlalu panjang untuk satu halaman PDF dipotong dengan catatan; versi Excel memuat isi lengkap.
- Tab **Peminjaman** di Laporan menampilkan dan menyaring peminjaman yang lewat jatuh tempo sebagai **Terlambat**.
- Pencarian `Ctrl+K` menampilkan *Menampilkan 10 dari N hasil.* dan tombol **Tampilkan lebih banyak**. Pencarian tidak mencakup isi PDF hasil pindaian.
- Angka "bulan ini" di Dashboard dan tanggal pada laporan mengikuti WIB.

## Khusus Super Admin

- Akun Google yang menunggu persetujuan hanya disetujui lewat **Setujui akses** setelah mencentang *Saya sudah memastikan langsung kepada pemilik email ini.* Pilihan **Ubah Peran/Unit** tidak tampil untuk akun tersebut.
- Audit Log mencatat aksi **Masuk**, **Gagal masuk**, **Keluar**, **Mengganti kata sandi**, dan **Menjalankan Pemindai**.
- Header menampilkan tanda **Operasional: perlu perhatian** atau **Operasional: gagal** yang membuka Monitoring Operasional. Kartu pemindai memiliki tombol **Jalankan pemindai**, dan ada pemeriksaan baru **Pembersihan unggahan langsung**.
- Keterangan mode **Tayang saja** kini menjelaskan bahwa isi berkas tetap tampil di layar peminta dan dapat disalin; setiap penayangan tercatat di Audit Log.
- Tab **Surat Terhapus** di Surat Masuk dan Surat Keluar untuk melihat dan memulihkan surat yang dihapus.

[Panduan Pengguna Lengkap](./panduan-pengguna.md) · [Mulai Inventaris Internal](./mulai-inventaris-internal.md)
