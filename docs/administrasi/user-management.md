# 👥 User Management

Panduan mengelola akun pengguna di SIMSA.

> 🔒 **Hanya Super Admin** yang bisa mengakses User Management.

---

## Melihat Daftar Pengguna

### Langkah 1: Buka Menu
Di sidebar, klik **User Management** di bawah **Administrasi**.

### Langkah 2: Lihat Tabel Pengguna

Tabel menampilkan semua pengguna yang terdaftar:

| Kolom | Keterangan |
|-------|------------|
| Nama | Nama lengkap pengguna |
| Email | Alamat email |
| Role | Role yang diberikan |
| Unit Kerja | Unit kerja pengguna |
| Status | Aktif / Nonaktif |
| Keterangan Aksi | Edit / Hapus |

---

## Tambah User Baru

Fitur ini memungkinkan Super Admin membuat akun pengguna baru secara langsung dari halaman User Management.

### Langkah-langkah

1. Klik tombol **"Tambah User"** (biru) di pojok kanan atas halaman.
2. Dialog form akan muncul. Isi data berikut:

| Field | Keterangan | Wajib |
|-------|-----------|-------|
| Email | Alamat email pengguna (untuk login) | ✅ |
| Nama Lengkap | Nama lengkap pengguna | ✅ |
| Role | Pilih role dari dropdown (Super Admin, Admin Dirjen, Admin Sesditjen, User) | ✅ |
| Unit Kerja | Pilih unit kerja dari dropdown | ❌ |
| Jabatan | Jabatan/posisi (muncul di dokumen resmi) | ❌ |
| NIP | Nomor Induk Pegawai (muncul di tanda tangan) | ❌ |

3. Klik **"Tambah User"** untuk menyimpan.
4. User baru akan muncul di daftar pengguna.

> ⚠️ **Penting:**
> - Email harus **unik** — tidak boleh sama dengan email yang sudah terdaftar.
> - User baru **login dengan Google** menggunakan email yang didaftarkan. Pastikan email yang dimasukkan adalah email Google yang aktif.
> - Jika ada error, pesan kesalahan akan ditampilkan di bagian atas dialog.

---

## Mengelola Pengguna

### Mengubah Role

1. Cari pengguna yang ingin diubah role-nya.
2. Klik **ikon edit** di kolom aksi.
3. Ubah role dari dropdown:

| Role | Keterangan |
|------|-----------|
| Staff | Akses dasar |
| Admin Dirjen | Admin unit Dirjen |
| Admin Sesditjen | Admin unit Sesditjen |
| Super Admin | Akses penuh |
| Auditor | Akses audit |

4. Klik **"Simpan"**.

### Mengubah Unit Kerja

1. Klik **ikon edit** di kolom aksi.
2. Ubah unit kerja dari dropdown.
3. Klik **"Simpan"**.

### Menonaktifkan Pengguna

1. Klik **ikon edit** di kolom aksi.
2. Ubah status ke **Nonaktif**.
3. Pengguna yang dinonaktifkan **tidak bisa login**.

### Menghapus Pengguna

1. Klik **ikon hapus** di kolom aksi.
2. Konfirmasi penghapusan.

> ⚠️ **Perhatian:** Menghapus pengguna bersifat permanen. Data aktivitas pengguna di audit log tetap tersimpan.

---

[⬅️ Sebelumnya: Audit Log](audit-log.md) | [Selanjutnya: Master Data ➡️](master-data.md)
