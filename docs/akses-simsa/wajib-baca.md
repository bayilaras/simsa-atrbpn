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
| **Staff** | Lihat surat masuk/keluar (read-only), lihat arsip aktif (read-only), laporan |
| **Admin Dirjen** | Mengelola surat/arsip dan layanan pada unit Ditjen sesuai izin, status proses, serta kesiapan fitur |
| **Admin Sesditjen** | Mengelola operasional pada unit Sesditjen dengan pemeriksaan akses dan proses yang sama |
| **Super Admin** | Administrasi lintas unit, Manajemen Pengguna, pengaturan, dan pengawasan; akses rekod terkendali tetap diperiksa |
| **Auditor** | Pengawasan/baca-saja sesuai mandat unit; Audit Log global hanya untuk Super Admin |

> 💡 Kalau ada menu yang tidak muncul di sidebar kamu, kemungkinan besar role kamu tidak memiliki akses ke menu tersebut. Hubungi **Super Admin** untuk memeriksa peran sesuai penugasan; sebagian fitur juga memerlukan layanan yang dikonfigurasi operator.

---

## 3️⃣ Data Difilter Berdasarkan Unit Kerja

- Kamu **hanya bisa melihat data** dari unit kerja kamu sendiri.
- **Super Admin** dapat memilih cakupan lintas unit; akses rekod terkendali tetap mengikuti izin per rekod dan klasifikasi keamanan.

---

## 4️⃣ URL Akses SIMSA

Pada komputer Windows yang sudah disiapkan operator, jalankan **Mulai-SIMSA.cmd**. Layanan lokal dibuka pada alamat berikut; pengguna komputer lain menggunakan alamat yang diberikan operator:

```
http://127.0.0.1:3000
```

---

## 5️⃣ Belum Punya Akun?

SIMSA **tidak menyediakan pendaftaran publik**. Jika belum punya akun:

1. Hubungi **Super Admin** di unit kerja kamu.
2. Berikan nama lengkap, email, dan unit kerja kamu.
3. Super Admin akan membuatkan akun dan mengatur role kamu.

---

[⬅️ Sebelumnya: Selamat Datang](../README.md) | [Selanjutnya: Login dengan Email & Password ➡️](login-email-password.md)
