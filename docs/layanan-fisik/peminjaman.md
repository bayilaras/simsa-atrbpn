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
Di sidebar, klik **Peminjaman** di bawah **Layanan & Fisik**.

### Langkah 2: Klik "Catat Peminjaman"
Klik tombol di pojok kanan atas. Super Admin memilih unit kerja terlebih dahulu.

### Langkah 3: Isi Form

| Kolom | Keterangan |
|-------|------------|
| Tipe | **Per Arsip** atau **Per Box** |
| Arsip / Lokasi / Box | Cari dengan minimal tiga karakter, lalu pilih hasil yang benar |
| Peminjam | Nama lengkap peminjam |
| Unit Kerja | Divisi atau unit asal peminjam |
| Jatuh Tempo | Tanggal arsip harus dikembalikan |
| Tujuan | Keperluan peminjaman |

### Langkah 4: Simpan

Klik **"Simpan Peminjaman"**. Peminjaman langsung tercatat dengan status **Dipinjam**. Cocokkan arsip atau box fisik sebelum menyerahkannya.

---

## Memperpanjang dan Mengembalikan

1. Buka tab **Dipinjam** atau **Terlambat**.
2. Cari peminjaman yang dimaksud.
3. Klik **"Perpanjang"** untuk mengubah tanggal jatuh tempo, atau **"Kembalikan"** untuk mencatat pengembalian.
4. Saat pengembalian, isi catatan kondisi bila perlu, lalu klik **"Konfirmasi Pengembalian"**.

Peminjaman yang sudah dikembalikan tampil di tab **Riwayat**.

---

## Status Peminjaman

| Status | Keterangan |
|--------|------------|
| 📦 Dipinjam | Arsip sedang dipinjam |
| ⚠️ Terlambat | Jatuh tempo sudah lewat dan arsip belum dikembalikan |
| 🔙 Dikembalikan | Arsip sudah dikembalikan |

---

[⬅️ Sebelumnya: Layanan Arsip](layanan-arsip.md) | [Selanjutnya: Lokasi Simpan ➡️](lokasi-simpan.md)
