# ⚠️ Wajib BACA!

Sebelum kamu mulai menggunakan **SIMSA**, ada beberapa hal penting yang harus kamu tahu:

---

## 1️⃣ Satu Akun = Satu Email

Di SIMSA, akun kamu **terhubung ke email**. Artinya:

- Kalau kamu **Login pakai Google** dengan Email A, lalu login lagi dengan **Email & Password** menggunakan Email A yang sama, kamu akan **masuk ke akun yang sama**.
- Kalau sudah Login pakai Google, kamu **TIDAK perlu** Register lagi pakai email yang sama.

---

## 2️⃣ Akses Dibatasi Berdasarkan Role

SIMSA menggunakan sistem **Role-Based Access Control (RBAC)**. Artinya, menu dan fitur yang bisa kamu akses **tergantung role kamu**:

| Role | Akses |
|------|-------|
| **Staff** | Surat masuk/keluar, distribusi, arsip, laporan |
| **Admin Dirjen** | Semua fitur Staff + master data, lokasi simpan, arsip vital/terjaga |
| **Admin Sesditjen** | Sama seperti Admin Dirjen |
| **Super Admin** | Semua fitur + user management, settings, pengawasan |
| **Auditor** | Fitur dasar + audit log |

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

## 5️⃣ Password Harus Kuat

Kalau kamu daftar dengan Email & Password, pastikan password kamu memenuhi kriteria:

- ✅ Minimal **12 karakter**
- ✅ Mengandung **huruf besar** (A-Z)
- ✅ Mengandung **huruf kecil** (a-z)
- ✅ Mengandung **angka** (0-9)
- ✅ Mengandung **karakter spesial** (!@#$%^&*)

---

[⬅️ Sebelumnya: Selamat Datang](../README.md) | [Selanjutnya: Login dengan Email & Password ➡️](login-email-password.md)
