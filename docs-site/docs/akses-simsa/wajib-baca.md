# ⚠️ Wajib BACA!

Sebelum kamu mulai menggunakan **SIMSA**, ada beberapa hal penting yang harus kamu tahu:

---

## 1️⃣ Satu Akun = Satu Email

Di SIMSA, akun kamu **terhubung ke email**. Artinya:

- Kalau kamu **Login pakai Google** dengan Email A, lalu login lagi dengan **Email & Password** menggunakan Email A yang sama, kamu akan **masuk ke akun yang sama**.
- Akun kamu dibuat oleh **Super Admin** melalui menu User Management.

---

## 2️⃣ Akses Dibatasi Berdasarkan Role

SIMSA menggunakan sistem **Role-Based Access Control (RBAC)**. Artinya, menu dan fitur yang bisa kamu akses **tergantung role kamu**:

| Role | Akses |
|------|-------|
| **Staff** | Lihat surat masuk/keluar (read-only), lihat arsip aktif (read-only), laporan |
| **Admin Dirjen** | Semua fitur surat & arsip + distribusi, master data, lokasi simpan, arsip vital/terjaga |
| **Admin Sesditjen** | Sama seperti Admin Dirjen |
| **Super Admin** | Semua fitur + user management, settings, pengawasan, filter notifikasi unit kerja |
| **Auditor** | Dashboard + audit log |

> 💡 Kalau ada menu yang tidak muncul di sidebar kamu, kemungkinan besar role kamu tidak memiliki akses ke menu tersebut. Hubungi **Super Admin** untuk minta perubahan role.

---

## 3️⃣ Data Difilter Berdasarkan Unit Kerja

- Kamu **hanya bisa melihat data** dari unit kerja kamu sendiri.
- Hanya **Super Admin** yang bisa melihat data **semua unit kerja** sekaligus.

---

## 4️⃣ URL Akses SIMSA

Akses SIMSA di browser kamu melalui:

```
https://simsa-frontend.vercel.app/
```

---

## 5️⃣ Belum Punya Akun?

SIMSA **tidak menyediakan pendaftaran publik**. Jika belum punya akun:

1. Hubungi **Super Admin** di unit kerja kamu.
2. Berikan nama lengkap, email, dan unit kerja kamu.
3. Super Admin akan membuatkan akun dan mengatur role kamu.

---

[⬅️ Sebelumnya: Selamat Datang](../README.md) | [Selanjutnya: Login dengan Email & Password ➡️](login-email-password.md)
