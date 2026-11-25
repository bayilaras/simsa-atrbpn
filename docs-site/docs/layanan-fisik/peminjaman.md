# 🔄 Peminjaman Arsip

Panduan mencatat peminjaman dan pengembalian arsip fisik.

> 🔒 Menu **Peminjaman** hanya tersedia bagi Super Admin dan Admin Unit Kerja.

---

## Apa Itu Peminjaman?

Fitur ini untuk **mencatat sirkulasi arsip fisik** dari tempat penyimpanan. Admin mencatat peminjaman langsung atas nama peminjam; tidak ada tahap pengajuan atau persetujuan di aplikasi. Bila prosedur unit mensyaratkan persetujuan, periksa kewenangan peminjam di luar aplikasi sebelum mencatat.

---

## Alur Peminjaman

```
📋 Admin mencatat    →    📦 Dipinjam    →    🔙 Dikembalikan
   peminjaman                  │
                               └── ⚠️ Terlambat (lewat jatuh tempo)
```

---

## Cara Mencatat Peminjaman

### Langkah 1: Buka Menu Peminjaman

[![Halaman Peminjaman Arsip](/img/panduan/peminjaman.png)](/img/panduan/peminjaman.png)

*Contoh tampilan: daftar peminjaman dengan tombol Perpanjang dan Kembalikan di tiap baris.*

Di sidebar, klik **Peminjaman** di bawah **Layanan & Fisik**.

### Langkah 2: Klik "Catat Peminjaman"
Klik tombol di pojok kanan atas. Super Admin memilih unit kerja terlebih dahulu.

### Langkah 3: Isi Form

[![Dialog Catat Peminjaman Baru](/img/panduan/peminjaman-catat.png)](/img/panduan/peminjaman-catat.png)

*Contoh tampilan: dialog Catat Peminjaman Baru.*

| Kolom | Keterangan |
|-------|------------|
| Tipe | **Per Arsip** atau **Per Box** |
| Arsip / Lokasi / Box | Cari dengan minimal tiga karakter, lalu pilih hasil yang benar |
| Peminjam | Nama lengkap peminjam |
| Unit Kerja | Divisi atau unit asal peminjam |
| Jatuh Tempo | Tanggal arsip harus dikembalikan, paling cepat hari ini |
| Tujuan | Keperluan peminjaman |

Tanggal jatuh tempo yang sudah lewat ditolak dengan pesan *Jatuh tempo tidak boleh sebelum hari ini.*

Pencarian hanya menampilkan arsip yang kelas keamanannya boleh dibaca akun Anda. Peminjaman arsip di atas kewenangan itu dicatat oleh Super Admin.

### Langkah 4: Simpan

Klik **"Simpan Peminjaman"**. Peminjaman langsung tercatat dengan status **Dipinjam**. Cocokkan arsip atau box fisik sebelum menyerahkannya.

---

## Memperpanjang dan Mengembalikan

1. Buka tab **Dipinjam** atau **Terlambat**.
2. Cari peminjaman yang dimaksud.
3. Klik **"Perpanjang"** untuk mengubah tanggal jatuh tempo, atau **"Kembalikan"** untuk mencatat pengembalian.
4. Saat pengembalian, isi catatan kondisi bila perlu, lalu klik **"Konfirmasi Pengembalian"**.

Tanggal jatuh tempo baru harus **setelah jatuh tempo saat ini** dan tidak boleh sebelum hari ini. Peminjaman yang sudah terlambat dapat diperpanjang paling cepat sampai hari ini.

---

## Melihat Peminjam dari Halaman Detail Arsip

Buka arsip dari menu **Arsip**, lalu lihat kartu **Peminjaman** di kolom samping (di bawah **Status Arsip**). Anda tidak perlu mencari ulang di menu Peminjaman.

| Keadaan | Yang tampil di kartu |
|---------|----------------------|
| Arsip tidak dipinjam | **Tersedia** |
| Arsip sedang dipinjam | **Dipinjam**, nama peminjam, unit/instansi peminjam, tanggal pinjam, dan jatuh tempo |
| Jatuh tempo sudah lewat | **Terlambat … hari** beserta rincian yang sama |
| Boks tempat arsip disimpan dipinjam utuh | **Per boks**, kode dan nama boks, serta peminjam boks itu |

Di bawahnya, **Riwayat peminjaman** memuat sampai sepuluh peminjaman terakhir arsip itu yang sudah dikembalikan, terbaru lebih dulu, beserta jumlah seluruhnya. Riwayat ini hanya mencatat peminjaman **Per Arsip**; peminjaman boks yang sudah dikembalikan dicari di menu Peminjaman.

Super Admin dan Admin Unit Kerja mendapat tautan **Buka di menu Peminjaman**, **Buka peminjaman boks ini**, dan **Lihat riwayat di menu Peminjaman**. Tautan itu membuka daftar Peminjaman yang hanya memuat arsip atau boks tersebut; klik **Tampilkan semua** untuk kembali ke daftar lengkap. Peran lain melihat kartunya tanpa tautan.

Bila kartu menampilkan *Rincian peminjam tidak ditampilkan untuk akun Anda*, kelas keamanan arsip itu di atas kewenangan akun Anda untuk data peminjaman. Hubungi Super Admin bila perlu mengetahui peminjamnya.

### Pengingat jatuh tempo

Admin unit pemilik arsip menerima pengingat di lonceng notifikasi (tab **Alur kerja**, label **Peminjaman**) untuk peminjaman yang belum dikembalikan:

- **Peminjaman terlambat … hari** (mendesak) bila jatuh tempo sudah lewat;
- **Peminjaman jatuh tempo hari ini** atau **… dalam 1/2 hari** (perhatian) menjelang jatuh tempo.

Klik pengingat untuk membuka tab **Terlambat** atau **Dipinjam**. Pengingat yang sudah ditandai dibaca muncul lagi bila jatuh temponya diperpanjang lalu terlewat lagi. Pengingat hanya tampil di aplikasi; SIMSA tidak mengirim email.

Peminjaman yang sudah dikembalikan tampil di tab **Riwayat**. Rekap peminjaman, termasuk yang **Terlambat**, juga tersedia di **Laporan**, tab **Peminjaman**.

Selama arsip atau boksnya masih dipinjam, lokasi simpan arsip tidak dapat diubah, dan arsip lain tidak dapat ditautkan ke boks yang sedang dipinjam. Catat pengembaliannya terlebih dahulu.

---

## Status Peminjaman

| Status | Keterangan |
|--------|------------|
| 📦 Dipinjam | Arsip sedang dipinjam |
| ⚠️ Terlambat | Jatuh tempo sudah lewat dan arsip belum dikembalikan |
| 🔙 Dikembalikan | Arsip sudah dikembalikan |

---

[⬅️ Sebelumnya: Layanan Arsip](layanan-arsip.md) | [Selanjutnya: Lokasi Simpan ➡️](lokasi-simpan.md)
