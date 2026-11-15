# 📝 Audit Log

Panduan melihat log aktivitas pengguna di SIMSA.

> 🔒 **Hanya Super Admin** yang bisa mengakses Audit Log.

---

## Apa Itu Audit Log?

Audit log adalah **catatan otomatis** dari aktivitas penting yang dilakukan pengguna di SIMSA. Setiap aksi (membuat, mengubah, menghapus, mengarsipkan, mengekspor, dan lainnya) tercatat lengkap dengan:
- **Siapa** yang melakukan
- **Apa** yang dilakukan
- **Kapan** dilakukan
- **Detail** perubahan

---

## Melihat Audit Log

### Langkah 1: Buka Menu
Di sidebar, klik **Audit Log** di bawah **Administrasi**.

### Langkah 2: Baca Daftar Aktivitas

> **Tampilan Audit Log**
>
> Setiap aktivitas tampil sebagai satu baris berisi:
>
> | Bagian | Contoh |
> |--------|--------|
> | **Pelaku dan aksi** | Nama pengguna, aksi yang dilakukan (misalnya *Mengubah*), dan jenis datanya (misalnya *Surat Masuk*) |
> | **Waktu** | Tanggal dan jam kejadian |
> | **IP Address** | Alamat jaringan asal permintaan |
> | **Detail Perubahan** | Isian yang berubah, nilai sebelum dan sesudahnya. Untuk arsip ada bagian **Daftar Item Arsip** |

### Langkah 3: Saring Log

Gunakan penyaring di atas daftar:

| Penyaring | Keterangan |
|-----------|------------|
| **Cari audit log** | Cari nama pengguna, email, atau ID data |
| **Rentang** | Tanggal mulai dan tanggal akhir |
| **Tipe Entity** | Jenis data: Surat Masuk, Surat Keluar, Arsip, User, Persetujuan Akses, Rangkaian Surat, Relasi Rangkaian, atau Disposisi |
| **Aksi** | Jenis aksi, lihat tabel di bawah |

---

## Jenis Aksi yang Dicatat

| Aksi | Keterangan |
|------|------------|
| **Membuat** / **Mengubah** / **Menghapus** | Penambahan, perubahan, dan penghapusan data |
| **Mengarsipkan** / **Memulihkan** / **Ubah Status** | Perubahan tahap sebuah data |
| **Meminta Akses** / **Menyetujui Akses** / **Menolak Akses** / **Mencabut Akses** | Proses persetujuan akses rekod terkendali |
| **Lihat via Rangkaian** | Surat unit lain yang dibaca melalui rangkaian surat |
| **Ekspor Data** | Pengunduhan berkas ekspor |
| **Menggabungkan** / **Menautkan** / **Membatalkan** | Perubahan pada rangkaian surat dan tautannya |
| **Mendisposisikan** / **Menerima Disposisi** / **Menyelesaikan Disposisi** / **Menolak Disposisi** | Proses disposisi surat |
| **Masuk** / **Gagal masuk** / **Keluar** | Masuk dan keluar aplikasi, termasuk percobaan masuk yang gagal. Percobaan gagal dengan email yang tidak terdaftar tampil dengan pelaku *Pengguna tidak dikenal* |
| **Mengganti kata sandi** | Pengguna mengganti kata sandinya sendiri di **Pengaturan › Profil**. Rinciannya hanya menulis *kata sandi: diganti*, tanpa isi kata sandi. Pengaturan ulang oleh Super Admin tercatat sebagai **Mengubah** pada data pengguna itu |
| **Menjalankan Pemindai** | Super Admin menekan **Jalankan pemindai** di Monitoring Operasional |

Aksi **Masuk**, **Gagal masuk**, **Keluar**, dan **Mengganti kata sandi** dapat dipilih pada penyaring **Aksi**. Ringkasan **Pengguna Paling Aktif** di tab **Pengawasan** Dashboard tidak menghitung peristiwa masuk dan keluar.

Audit Log hanya untuk dibaca; catatan di dalamnya tidak dapat diubah atau dihapus dari halaman ini.

---

[⬅️ Sebelumnya: Laporan](laporan.md) | [Selanjutnya: Manajemen Pengguna ➡️](user-management.md)
