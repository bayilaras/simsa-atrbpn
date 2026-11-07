# 🌐 Login Dengan Google

Cara Login ke SIMSA menggunakan akun Google kamu.

---

## Syarat:

- ✅ Kamu punya akun Google aktif dengan email terverifikasi.
- ✅ Bila email tersebut sudah terdaftar di SIMSA, akunnya belum dinonaktifkan.
- ✅ Bila email belum terdaftar, login pertama membuat akun yang **menunggu persetujuan Super Admin**. Akses baru tersedia setelah disetujui (lihat [Langkah 5](#langkah-5-tunggu-persetujuan-super-admin)).

---

## Langkah 1: Buka Halaman Login

1. Buka browser dan akses `https://simsa-frontend.vercel.app/`.
2. Kamu akan melihat halaman login SIMSA.

---

## Langkah 2: Klik Tombol "Masuk dengan Google"

1. Di bagian bawah form login, cari tombol **"Masuk dengan Google"**.

:::tip Tampilan Tombol Google
Di bawah form login, terdapat pembatas **"atau"** dan tombol **"Masuk dengan Google"**. Di bawah tombol tertulis *Akun Google baru perlu persetujuan administrator.* Klik tombol ini untuk membuka autentikasi Google.
:::

2. Klik tombol tersebut.

---

## Langkah 3: Pilih Akun Google

1. Browser akan membuka halaman autentikasi Google dan menampilkan daftar akun yang tersedia.
2. Pilih akun yang ingin kamu gunakan untuk login.
3. Jika diminta, masukkan password akun Google kamu.

---

## Langkah 4: Login Berhasil

1. Jika email Google kamu sudah terdaftar di SIMSA dan akunnya aktif, kamu akan **otomatis diarahkan ke Dashboard** SIMSA. Peran dan unit kerja akun tidak berubah.
2. Jika ini login Google pertama dengan email yang belum terdaftar, SIMSA membuat akun baru tanpa peran dan unit kerja. Lanjutkan ke Langkah 5.
3. Login ditolak bila akun dinonaktifkan.

---

## Langkah 5: Tunggu Persetujuan Super Admin

Langkah ini hanya untuk akun baru.

1. SIMSA menampilkan halaman **Menunggu persetujuan administrator**. Dashboard, menu data, dan arsip belum dapat dibuka.
2. Hubungi Super Admin dan sebutkan email Google yang kamu pakai. Super Admin menyetujui akun dengan menetapkan peran, serta unit kerja untuk **Admin Unit Kerja**.
3. Setelah disetujui, sesi lama ditutup. Klik **Periksa ulang akses** atau **Keluar**, lalu masuk lagi dengan **Masuk dengan Google**.

---

## ❓ FAQ

**Q: Apakah saya perlu daftar dulu sebelum login via Google?**
> Tidak harus. Login Google pertama dengan email yang belum terdaftar membuat akun berstatus **Menunggu persetujuan**. Akun itu belum dapat membuka data sampai Super Admin menyetujuinya dan menetapkan peran serta unit kerja.

**Q: Saya sudah punya akun SIMSA dengan email yang sama, apakah bisa login via Google?**
> Bisa. SIMSA menautkan identitas Google ke akun tersebut bila emailnya sama dan sudah terverifikasi di Google. Peran dan unit kerja akun tidak berubah, dan kata sandi SIMSA yang sudah ada tetap dapat dipakai.

**Q: Apakah akun yang dibuat lewat Google memiliki kata sandi SIMSA?**
> Tidak. Kata sandinya dikelola di akun Google. Bila perlu masuk dengan email dan kata sandi, minta Super Admin mengatur kata sandi melalui [Atur Ulang Kata Sandi](../administrasi/user-management.md#atur-ulang-kata-sandi).

**Q: Halaman Google tidak terbuka atau kembali ke halaman login?**
> Pastikan cookie dan redirect diizinkan, lalu gunakan alamat SIMSA resmi. Bila tetap gagal, minta pengelola memeriksa konfigurasi OAuth dan provisioning akun.

---

[⬅️ Sebelumnya: Daftar Menggunakan Email](daftar-email.md) | [Selanjutnya: Browser yang Kompatibel ➡️](../tutorial-dasar/browser-kompatibel.md)
