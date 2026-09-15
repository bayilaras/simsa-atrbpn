---
title: Mulai Inventaris Internal
description: Langkah pertama mencatat dan menemukan arsip fisik pada SIMSA
---

# Mulai inventaris internal

Mulai dari daftar surat dan arsip fisik yang memang menjadi tanggung jawab unit Anda. SIMSA mengelola surat dan arsip secara mandiri, tanpa memerlukan koneksi atau akun SRIKANDI. Metadata dapat disimpan tanpa lampiran hasil pindai; fitur digital digunakan setelah penyimpanan privat dan pemeriksaan berkas siap.

## 1. Buka aplikasi dan masuk

Pada komputer Windows yang sudah disiapkan operator, buka folder SIMSA dan jalankan **Mulai-SIMSA.cmd**. Browser akan dibuka setelah layanan lokal siap, pada `http://127.0.0.1:3000`. Gunakan **Cek-SIMSA.cmd** untuk memeriksa layanan, dan **Hentikan-SIMSA.cmd** setelah selesai memakai layanan lokal. Alamat ini hanya untuk komputer tersebut; pengguna komputer lain memakai alamat yang ditetapkan operator.

Masukkan **Email kedinasan** dan **Kata sandi**, lalu klik **Masuk**. Google hanya digunakan bila sudah dikonfigurasi. Gunakan akun pribadi; akun uji tidak dipakai bersama untuk pekerjaan resmi.

Super Admin menyiapkan akun melalui **Administrasi → Manajemen Pengguna → Tambah Pengguna**, termasuk kata sandi, peran, unit kerja, dan status aktif. **Admin Dirjen** mengelola unit Ditjen dan **Admin Sesditjen** mengelola unit Sesditjen. **Staf** membaca dan mencari data dalam unit penugasannya; staf tidak mengubah surat atau arsip. Lihat [pengelolaan akun](./administrasi/user-management.md).

## 2. Catat surat atau impor daftar yang sudah ada

Admin membuka **Manajemen Surat → Surat → Surat Masuk** atau **Surat Keluar**. Cari nomor surat terlebih dahulu agar tidak dicatat dua kali. Gunakan tombol tambah pada daftar, isi metadata sesuai sumber, lalu simpan. Lampiran boleh ditunda untuk inventaris fisik.

Jika sudah memiliki daftar dalam CSV:

1. Buka daftar surat yang sesuai. Super Admin memilih **satu unit kerja**, bukan Semua Unit Kerja.
2. Klik **Impor CSV**, pilih **Berkas CSV**, lalu **Pratinjau**.
3. Periksa tanggal, status valid/duplikat, dan catatan setiap baris. Perbaiki baris yang ditolak pada CSV sumber lalu pratinjau ulang.
4. Klik **Impor data valid**. Periksa hasil impor sebelum mengulang; baris yang berhasil tetap tersimpan walaupun baris lain gagal.

Kolom utama surat: `Nomor Surat`, `Tanggal Surat`, `Perihal`, `Dari`, `Kepada`. Tanggal harus `YYYY-MM-DD` atau `DD/MM/YYYY`. Maksimal 1.000 rekod dan 10 MiB per CSV. Jangan mengganti tanggal yang belum diketahui dengan tanggal hari ini.

## 3. Buat inventaris arsip fisik

Pilih alur sesuai sumber data:

- **Surat yang sudah tercatat:** buka detail surat yang selesai diproses, lalu **Arsipkan**. Isi Nomor Berkas, uraian, klasifikasi/JRA yang sesuai, item, jumlah, serta **No. Filing Cabinet**, **No. Laci**, dan **No. Folder** sesuai lokasi fisik. Surat keluar harus melalui persetujuan internal sebelum diarsipkan.
- **Daftar arsip yang sudah ada:** buka **Siklus Hidup Arsip → Arsip Aktif → Arsip Surat Masuk** atau **Arsip Surat Keluar**, pilih unit kerja, lalu **Impor CSV**. Kolom utama: `Nomor Berkas`, `Tanggal`, `Uraian`, `Jenis Arsip`; isi jenis dengan `masuk` atau `keluar`. Gunakan pratinjau sebelum impor seperti langkah sebelumnya.

Impor arsip saat ini belum memetakan kolom lokasi terstruktur. Catatan lokasi dari daftar lama dapat dimasukkan pada kolom `Keterangan`; pertahankan daftar sumber agar informasinya dapat dicocokkan. Jangan menganggap kolom lokasi tambahan di CSV otomatis masuk ke Filing Cabinet/Laci/Folder.

Arsip hasil impor dapat dicari dan diperiksa meskipun klasifikasi/JRA belum terverifikasi. Pengelola kemudian mencocokkan aturan melalui rekonsiliasi pada detail arsip. Status ini tidak memberi izin pemusnahan atau penyerahan; tahapan retensi dan penyusutan tetap mengikuti bukti serta kewenangan yang dipersyaratkan aplikasi.

## 4. Temukan kembali dan cocokkan dengan fisiknya

Di **Arsip Aktif**, cari nomor atau uraian dan gunakan filter tahun/unit. Buka detail untuk memeriksa item, jumlah, catatan, dan tab **Retensi & Lokasi**. Cocokkan lokasi dengan label pada lemari/laci/folder. Pencarian di header (`Ctrl+K`) juga membantu menemukan surat atau arsip dalam cakupan akses Anda.

Admin dapat menggunakan **Layanan & Fisik → Lokasi Simpan** untuk mengelola daftar lokasi. Pembuatan lokasi pada menu tersebut tidak otomatis memindahkan arsip atau memperbarui lokasi seluruh hasil impor.

## 5. Tambahkan berkas digital ketika fasilitasnya siap

Apabila menu unggah tidak tersedia, lanjutkan pencatatan metadata dan inventaris fisik. Lampiran, unggah massal, OCR, serta proses berbukti file memerlukan penyimpanan privat dan pemeriksaan file yang dikonfigurasi operator. Jangan membuat berkas kosong atau tautan publik untuk melewati kebutuhan bukti. Berkas yang dikarantina belum dapat dipakai sampai pemeriksaannya lulus.

## Instrumen kearsipan dan SRIKANDI

Gunakan tata naskah dinas, klasifikasi arsip, JRA, serta klasifikasi keamanan dan akses ATR/BPN yang sudah berlaku. Pengaturan dan pemetaan di SIMSA perlu sesuai instrumen tersebut; memasang aplikasi tidak dengan sendirinya memerlukan penerbitan ulang seluruh instrumen.

Kewajiban instansi menerapkan SRIKANDI tetap berlaku dalam lingkup [Peraturan ANRI Nomor 4 Tahun 2021, Pasal 2–3](https://jdih.anri.go.id/storage/rules/January2024/GfOD5OlHAJWvwmMcHY4O.pdf). Hal itu dibedakan dari aktivasi konektor API di SIMSA. SIMSA membantu inventaris internal dan tidak dinyatakan menggantikan SRIKANDI. Integrasi atau migrasi mengikuti mekanisme resmi instansi; status konektor nonaktif bukan pembebasan kewajiban instansi.

Untuk langkah lanjutan, buka menu **Panduan** di aplikasi atau [Panduan Pengguna Lengkap](./panduan-pengguna.md).
