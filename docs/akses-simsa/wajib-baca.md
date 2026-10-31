# ⚠️ Wajib BACA!

Sebelum kamu mulai menggunakan **SIMSA**, ada beberapa hal penting yang harus kamu tahu:

---

## 1️⃣ Satu Akun = Satu Email

Di SIMSA, akun kamu **terhubung ke email**. Artinya:

- Gunakan email yang didaftarkan administrator. Login Google hanya tersedia jika integrasinya aktif dan identitas email sesuai; gunakan email/kata sandi yang disiapkan admin untuk layanan lokal.
- Akun kamu dibuat oleh **Super Admin** melalui menu Manajemen Pengguna.

---

## 2️⃣ Akses Dibatasi Berdasarkan Role

SIMSA menggunakan sistem **Role-Based Access Control (RBAC)**. Artinya, menu dan fitur yang bisa kamu akses **tergantung role kamu**:

| Role | Akses |
|------|-------|
| **Admin Unit Kerja** | Mengelola surat, arsip, distribusi, layanan, dan lokasi simpan pada unit kerja yang ditetapkan, sesuai izin, status proses, serta kesiapan fitur |
| **Super Admin** | Administrasi lintas unit, Manajemen Pengguna, pengaturan, master data, Audit Log, dan pengawasan; akses rekod terkendali tetap diperiksa |

Akun lama dengan role **Admin Dirjen**, **Admin Sesditjen**, **Staff**, atau **Auditor** tetap memakai hak aksesnya sampai Super Admin menetapkan role baru. Akun Staff dan Auditor lama tidak bisa mengubah surat atau arsip.

> 💡 Kalau ada menu yang tidak muncul di sidebar kamu, kemungkinan besar role kamu tidak memiliki akses ke menu tersebut. Hubungi **Super Admin** untuk memeriksa peran sesuai penugasan; sebagian fitur juga memerlukan layanan yang dikonfigurasi operator.

---

## 3️⃣ Data Difilter Berdasarkan Unit Kerja

- Kamu **hanya bisa melihat data** dari unit kerja kamu sendiri.
- **Super Admin** dapat memilih cakupan lintas unit; akses rekod terkendali tetap mengikuti izin per rekod dan klasifikasi keamanan.

---

## 4️⃣ URL Akses SIMSA

Buka SIMSA melalui browser pada alamat berikut:

```
https://simsa-frontend.vercel.app
```

---

## 5️⃣ Belum Punya Akun?

SIMSA **tidak menyediakan pendaftaran publik**. Jika belum punya akun:

1. Hubungi **Super Admin** di unit kerja kamu.
2. Berikan nama lengkap, email, dan unit kerja kamu.
3. Super Admin akan membuatkan akun dan mengatur role kamu.

---

[⬅️ Sebelumnya: Selamat Datang](../README.md) | [Selanjutnya: Login dengan Email & Password ➡️](login-email-password.md)
