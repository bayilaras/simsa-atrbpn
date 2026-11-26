# 📝 Audit Log

Panduan melihat log aktivitas pengguna di SIMSA.

> 🔒 **Hanya Super Admin** yang bisa mengakses Audit Log. Audit Log bersifat global (lintas unit) dan tetap dibatasi untuk Super Admin sampai seluruh baris audit memiliki pembatas unit yang dapat ditegakkan.

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

[![Halaman Audit Log](/img/panduan/audit-log.png)](/img/panduan/audit-log.png)

*Contoh tampilan: Audit Log mencatat siapa melakukan apa dan kapan.*

:::tip Tampilan Audit Log
Setiap aktivitas tampil sebagai satu baris berisi:

| Bagian | Contoh |
|--------|--------|
| **Pelaku dan aksi** | Nama pengguna, aksi yang dilakukan (misalnya *Mengubah*), dan jenis datanya (misalnya *Surat Masuk*) |
| **Waktu** | Tanggal dan jam kejadian |
| **IP Address** | Alamat jaringan asal permintaan |
| **Detail Perubahan** | Isian yang berubah, nilai sebelum dan sesudahnya. Untuk arsip ada bagian **Daftar Item Arsip** |
:::

### Langkah 3: Saring Log

Gunakan penyaring di atas daftar:

| Penyaring | Keterangan |
|-----------|------------|
| **Cari audit log** | Cari nama pengguna, email, atau ID data |
| **Rentang** | Tanggal mulai dan tanggal akhir |
| **Jenis Data** | Jenis data yang dicatat, misalnya Surat Masuk, Surat Keluar, Arsip, Pengguna, Persetujuan Akses, Rangkaian Surat, Disposisi, Peminjaman Arsip, Dosir, atau Audit Log. Daftarnya memuat semua jenis data yang dicatat SIMSA |
| **Aksi** | Jenis aksi, lihat tabel di bawah |

### Mengekspor Audit Log

1. Atur pencarian dan penyaring (rentang tanggal, jenis data, aksi) sampai daftar berisi log yang diperlukan.
2. Klik **Ekspor Excel** di kanan atas halaman. Berkas `audit-log-<tanggal>.xlsx` terunduh.

Berkas memuat **seluruh** log yang cocok dengan pencarian dan penyaring, bukan hanya halaman yang tampil, dengan kolom **Waktu** (WIB), **Pengguna**, **Email**, **Aksi**, **Jenis Data**, **ID Data**, **Alamat IP**, dan **Ringkasan**.

- **Ringkasan** hanya menulis nama isian yang berubah (misalnya *Isian: perihal, status*) dan, untuk aksi Ekspor Data, sumber serta format berkasnya. Nilai sebelum dan sesudah perubahan tidak ikut diekspor; lihat **Detail Perubahan** di layar bila nilainya diperlukan.
- Ekspor dibatasi 10.000 baris. Bila hasil penyaring lebih banyak, berkas tidak dibuat; persempit rentang tanggal atau penyaring, lalu ekspor per bagian.
- Ekspor Audit Log sendiri tercatat sebagai aksi **Ekspor Data** pada jenis data **Audit Log**, beserta penyaring yang dipakai.

Berkas ini memuat nama pengguna, email, dan alamat IP. Berikan hanya kepada pihak yang berwenang dan hapus salinan yang tidak lagi diperlukan.

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
| **Melihat** / **Mengunduh** / **Memeriksa Integritas** | Penayangan dan pengunduhan berkas, serta pemeriksaan keutuhan berkas |
| **Menerapkan Legal Hold** / **Melepas Legal Hold** | Penahanan hukum atas arsip dan pelepasannya |
| Aksi tata kelola retensi, misalnya **Mencatat Pemicu Retensi**, **Menyetujui Penilaian Arsip**, **Menyerahkan Arsip Permanen** | Pencatatan dan verifikasi pemicu retensi, penilaian arsip, dan penyerahan arsip permanen |

Semua aksi di atas dapat dipilih pada penyaring **Aksi**. Pada **Detail Perubahan**, nama isian ditulis sebagai kata-kata; penanda surat hasil impor tampil sebagai *Penanda impor*. Isian yang nama kolomnya berbahasa Inggris diberi nama Indonesia yang sama dengan halaman lain, misalnya *Jatuh tempo*, *Peminjam*, *Nama berkas asli*, dan *Dapat menerima distribusi*. Nilainya juga ditulis agar mudah dibaca: isian yang kosong tampil sebagai *(kosong)*, pilihan ya atau tidak sebagai *Ya* atau *Tidak*, tanggal sebagai *2 Januari 2026*, dan waktu sebagai tanggal beserta jam dalam WIB. Arahkan kursor ke sebuah nilai untuk melihat bentuk aslinya seperti yang tersimpan. Ringkasan **Pengguna Paling Aktif** di tab **Pengawasan** Dashboard tidak menghitung peristiwa masuk dan keluar.

Audit Log hanya untuk dibaca; catatan di dalamnya tidak dapat diubah atau dihapus dari halaman ini.

---

[⬅️ Sebelumnya: Laporan](laporan.md) | [Selanjutnya: Manajemen Pengguna ➡️](user-management.md)
