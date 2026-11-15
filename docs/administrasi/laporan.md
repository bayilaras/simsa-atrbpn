# 📊 Laporan

Panduan melihat dan mengekspor laporan di SIMSA.

---

## Apa Itu Halaman Laporan?

Halaman **Laporan & Statistik** menampilkan **ringkasan dan daftar** surat, arsip, serta peminjaman untuk satu periode. Daftar surat dan arsip dapat diunduh dalam format **Excel** atau **PDF** untuk keperluan pelaporan internal.

---

## Tab yang Tersedia

| Tab | Isi | Ekspor |
|-----|-----|:------:|
| **Ringkasan** | Angka ringkas dan grafik perbandingan surat masuk dan keluar per bulan | ❌ |
| **Surat Masuk** | Daftar surat masuk: Nomor Surat, Tanggal, Dari, Perihal, Status | ✅ |
| **Surat Keluar** | Daftar surat keluar: Nomor Surat, Tanggal, Kepada, Perihal, Jenis | ✅ |
| **Arsip** | Daftar arsip dengan penyaring nasib akhir dan media | ✅ |
| **Peminjaman** | Daftar peminjaman arsip fisik beserta statusnya: **Dipinjam**, **Dikembalikan**, atau **Terlambat** (lewat jatuh tempo dan belum dikembalikan). Pilihan **Terlambat** juga tersedia pada penyaring status | ❌ |

---

## Cara Membuat Laporan

### Langkah 1: Buka Menu Laporan
Di sidebar, klik **Laporan** di bawah **Administrasi**. Super Admin memilih unit kerja terlebih dahulu.

### Langkah 2: Atur Periode

| Isian | Keterangan |
|-------|------------|
| **Tahun** | Tahun laporan |
| **Dari Tanggal** / **Sampai Tanggal** | Rentang tanggal. Bila salah satunya diisi, pilihan tahun diabaikan untuk daftar surat masuk dan surat keluar, sehingga rentang boleh melintasi tahun |

### Langkah 3: Tampilkan
Klik **"Tampilkan Data"**, lalu buka tab yang diperlukan.

### Langkah 4: Ekspor

Pada tab Surat Masuk, Surat Keluar, atau Arsip, klik **Excel** atau **PDF**.

- Isi berkas ekspor surat masuk dan surat keluar **sama dengan tabel di layar**, termasuk bila rentang tanggal melintasi tahun.
- Judul berkas menyebut periodenya bila tanggal diisi, misalnya *Periode 01-01-2018 s.d. 31-12-2018*, *Periode mulai 01-01-2026*, atau *Periode sampai 30-06-2025*. Tanpa tanggal, judul memakai tahun, misalnya *Tahun 2026*.
- Ekspor **arsip** hanya memakai tahun; isian tanggal tidak mengubah tabel maupun berkas arsip. Ekspor arsip hanya tersedia untuk penyaring **Semua** dan **Semua Media**. Untuk daftar arsip per jenis, gunakan tombol **Export** di halaman [Arsip Aktif](../siklus-arsip/arsip-aktif.md#ekspor-formulir-4-dan-formulir-6).
- Tanggal dan waktu pada laporan serta berkas ekspor mengikuti WIB, misalnya waktu cetak ditulis dengan akhiran *WIB*. Label di berkas sama dengan label di layar.
- Tombol **Export** di daftar Surat Masuk, Surat Keluar, dan Arsip memakai aturan yang sama. Bila Super Admin mengekspor dari daftar itu dengan pilihan **Semua Unit Kerja**, berkasnya memuat kolom **Unit Kerja** berisi nama unit.
- Pada PDF, teks panjang dibungkus dalam sel. Baris yang lebih tinggi dari satu halaman dipotong dan diberi catatan *Teks yang terlalu panjang dipotong; versi Excel memuat isi lengkap.*

Tombol ekspor hanya tampil bagi pengguna yang berwenang mengekspor. Setiap ekspor dicatat di Audit Log beserta penyaring yang dipakai.

> 💡 Berkas ekspor adalah salinan kerja. Batasi penyebarannya dan hapus salinan yang tidak lagi diperlukan.

---

[⬅️ Sebelumnya: Tunjuk Silang](../media-autentikasi/tunjuk-silang.md) | [Selanjutnya: Audit Log ➡️](audit-log.md)
