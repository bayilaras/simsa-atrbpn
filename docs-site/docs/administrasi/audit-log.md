# 📝 Audit Log

Panduan melihat log aktivitas pengguna di SIMSA.

> 🔒 **Hanya Admin dan Auditor** yang bisa mengakses Audit Log.

---

## Apa Itu Audit Log?

Audit log adalah **catatan otomatis** dari semua aktivitas yang dilakukan pengguna di SIMSA. Setiap aksi (tambah, edit, hapus, login, dll) tercatat lengkap dengan:
- **Siapa** yang melakukan
- **Apa** yang dilakukan
- **Kapan** dilakukan
- **Detail** perubahan

---

## Melihat Audit Log

### Langkah 1: Buka Menu
Di sidebar, klik **Audit Log** di bawah **Administrasi**.

### Langkah 2: Lihat Tabel Log

:::tip Tampilan Tabel Audit Log
Tabel menampilkan kolom-kolom berikut:

| Kolom | Contoh |
|-------|--------|
| **Waktu** | 10:32:15 |
| **Pengguna** | admin@email.com |
| **Aksi** | CREATE, UPDATE, DELETE, LOGIN |
| **Detail** | Buat surat SM/001, Edit surat SK/015 |
| **IP Address** | 192.168.1.10 |

Setiap baris mencatat satu aktivitas yang dilakukan pengguna.
:::

### Langkah 3: Filter Log

Gunakan filter untuk menyaring log:

| Filter | Keterangan |
|--------|------------|
| **Pengguna** | Cari log berdasarkan pengguna tertentu |
| **Aksi** | Filter berdasarkan jenis aksi (CREATE, UPDATE, DELETE, LOGIN) |
| **Tanggal** | Filter berdasarkan rentang tanggal |
| **Pencarian** | Cari kata kunci di kolom Detail |

---

## Jenis Aksi yang Dicatat

| Aksi | Warna | Keterangan |
|------|-------|------------|
| **CREATE** | 🟢 Hijau | Membuat data baru |
| **UPDATE** | 🔵 Biru | Mengedit data |
| **DELETE** | 🔴 Merah | Menghapus data |
| **LOGIN** | ⚪ Abu-abu | Login ke sistem |
| **LOGOUT** | ⚪ Abu-abu | Logout dari sistem |

---

[⬅️ Sebelumnya: Laporan](laporan.md) | [Selanjutnya: User Management ➡️](user-management.md)
