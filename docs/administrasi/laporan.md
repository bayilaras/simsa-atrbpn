# 📊 Laporan

Panduan melihat dan mengekspor laporan di SIMSA.

---

## Apa Itu Halaman Laporan?

Halaman **Laporan & Statistik** menampilkan **ringkasan dan daftar** surat, arsip, serta peminjaman untuk satu periode. Daftar surat, arsip, dan peminjaman dapat diunduh dalam format **Excel** atau **PDF** untuk keperluan pelaporan internal.

---

## Tab yang Tersedia

| Tab | Isi | Ekspor |
|-----|-----|:------:|
| **Ringkasan** | Angka ringkas dan grafik perbandingan surat masuk dan keluar per bulan | ❌ |
| **Surat Masuk** | Daftar surat masuk: Nomor Surat, Tanggal, Dari, Perihal, Status | ✅ |
| **Surat Keluar** | Daftar surat keluar: Nomor Surat, Tanggal, Kepada, Perihal, Jenis | ✅ |
| **Arsip** | Daftar arsip dengan penyaring nasib akhir dan media | ✅ |
| **Peminjaman** | Daftar peminjaman arsip fisik: arsip atau boks yang dipinjam, peminjam, tanggal, dan statusnya: **Dipinjam**, **Dikembalikan**, atau **Terlambat** (lewat jatuh tempo dan belum dikembalikan). Pilihan **Terlambat** juga tersedia pada penyaring status | ✅ |

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

Pada tab Surat Masuk, Surat Keluar, Arsip, atau Peminjaman, klik **Excel** atau **PDF**.

- Isi berkas ekspor surat masuk dan surat keluar **sama dengan tabel di layar**, termasuk bila rentang tanggal melintasi tahun.
- Judul berkas menyebut periodenya bila tanggal diisi, misalnya *Periode 01-01-2018 s.d. 31-12-2018*, *Periode mulai 01-01-2026*, atau *Periode sampai 30-06-2025*. Tanpa tanggal, judul memakai tahun, misalnya *Tahun 2026*.
- Ekspor **arsip** hanya memakai tahun; isian tanggal tidak mengubah tabel maupun berkas arsip. Ekspor arsip hanya tersedia untuk penyaring **Semua** dan **Semua Media**. Untuk daftar arsip per jenis, gunakan tombol **Export** di halaman [Arsip Aktif](../siklus-arsip/arsip-aktif.md#ekspor-formulir-4-dan-formulir-6). Berkas arsip dari halaman Laporan berjudul **Daftar Arsip** karena memuat semua arsip, aktif maupun inaktif; Formulir 4 dan Formulir 6 hanya dibuat dari halaman Arsip.
- Tanggal dan waktu pada laporan serta berkas ekspor mengikuti WIB, misalnya waktu cetak ditulis dengan akhiran *WIB*. Label di berkas sama dengan label di layar.
- Tombol **Export** di daftar Surat Masuk, Surat Keluar, dan Arsip memakai aturan yang sama. Bila Super Admin mengekspor dari daftar itu dengan pilihan **Semua Unit Kerja**, berkasnya memuat kolom **Unit Kerja** berisi nama unit.
- Pada PDF, teks panjang dibungkus dalam sel. Baris yang lebih tinggi dari satu halaman dipotong dan diberi catatan *Teks yang terlalu panjang dipotong; versi Excel memuat isi lengkap.*

#### Ekspor tab Peminjaman

Berkas peminjaman mengikuti penyaring tab Peminjaman: **status** (Semua, Dipinjam, Dikembalikan, Terlambat) dan **Dari Tanggal** / **Sampai Tanggal** yang dibaca sebagai tanggal pinjam. Pilihan **Tahun** tidak dipakai. Isi berkas sama dengan tabel di layar, untuk semua halaman tabel sekaligus.

| Kolom | Isi |
|-------|-----|
| **Jenis** | Arsip atau Boks |
| **Nomor Berkas / Kode Boks** dan **Uraian Berkas / Nama Boks** | Arsip atau boks yang dipinjam |
| **Peminjam** dan **Unit/Instansi Peminjam** | Seperti dicatat saat peminjaman |
| **Tanggal Pinjam**, **Jatuh Tempo**, **Tanggal Kembali** | Tanggal kembali kosong (-) bila belum dikembalikan |
| **Status** | Dipinjam, Terlambat, atau Dikembalikan |
| **Hari Terlambat** | Jumlah hari lewat jatuh tempo: dihitung sampai hari ini bila belum kembali, sampai tanggal kembali bila sudah kembali; 0 bila tidak terlambat |

Peminjaman arsip yang klasifikasi keamanannya tidak boleh kamu baca tidak tampil di tabel dan tidak ikut ke berkas.

#### Aturan umum ekspor

Tombol ekspor hanya tampil bagi pengguna yang berwenang mengekspor. Setiap ekspor dicatat di Audit Log beserta penyaring yang dipakai. Ekspor dibatasi 10.000 baris; bila hasil penyaring lebih banyak, berkas tidak dibuat dan kamu diminta mempersempit penyaring.

Rekap lain yang dapat diekspor: [rekap disposisi](../manajemen-surat/distribusi.md#mengekspor-rekap-disposisi) di halaman Distribusi dan, khusus Super Admin, [Audit Log](audit-log.md#mengekspor-audit-log).

> 💡 Berkas ekspor adalah salinan kerja. Batasi penyebarannya dan hapus salinan yang tidak lagi diperlukan.

---

[⬅️ Sebelumnya: Tunjuk Silang](../media-autentikasi/tunjuk-silang.md) | [Selanjutnya: Audit Log ➡️](audit-log.md)
