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

- Kamu **hanya bisa mengubah data** unit kerja kamu sendiri.
- Surat unit lain hanya bisa **dibaca, tanpa diubah**, bila unit kamu ikut dalam rangkaian surat tersebut. Unit pengawas (Ditjen dan Sesditjen) juga bisa membaca surat Ditjen, Sesditjen, dan seluruh direktorat. Surat Terbatas atau lebih tinggi dari unit lain tetap memerlukan izin akses.
- **Super Admin** dapat memilih cakupan lintas unit; akses rekod terkendali tetap mengikuti izin per rekod dan klasifikasi keamanan.

---

## 4️⃣ URL Akses SIMSA

Buka SIMSA melalui browser pada alamat berikut:

```
https://simsa-frontend.vercel.app
```

Gunakan Chrome atau Edge versi 111 ke atas, Firefox 128 ke atas, atau Safari 16.4 ke atas. Lihat [Browser yang Kompatibel](../tutorial-dasar/browser-kompatibel.md).

---

## 5️⃣ Belum Punya Akun?

SIMSA **tidak menyediakan pendaftaran publik**. Jika belum punya akun:

1. Hubungi **Super Admin** di unit kerja kamu.
2. Berikan nama lengkap, email, dan unit kerja kamu.
3. Super Admin akan membuatkan akun dan mengatur role kamu.

---

## 6️⃣ Sesi Berakhir Otomatis

- SIMSA keluar otomatis setelah **30 menit tanpa aktivitas**. Lima menit sebelumnya muncul peringatan; klik **Tetap Masuk** bila masih bekerja.
- Isian formulir surat atau dialog **Arsipkan Surat** yang belum disimpan dapat dipulihkan setelah masuk kembali, asalkan tab peramban belum ditutup. Lihat [Sesi berakhir](login-email-password.md#sesi-berakhir).
- Tetap simpan pekerjaan sebelum meninggalkan komputer, dan klik **Keluar** setelah selesai, terutama di komputer bersama.

---

[⬅️ Sebelumnya: Selamat Datang](../README.md) | [Selanjutnya: Login dengan Email & Password ➡️](login-email-password.md)
