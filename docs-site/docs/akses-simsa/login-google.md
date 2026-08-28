# 🌐 Login Dengan Google

Cara Login ke SIMSA menggunakan akun Google kamu.

---

## Syarat:

- ✅ Kamu punya akun Google aktif dengan email yang **sudah diprovisi oleh Super Admin SIMSA**.
- ✅ Akun tersebut belum dinonaktifkan dan sudah memiliki role serta unit kerja.

---

## Langkah 1: Buka Halaman Login

1. Buka browser dan akses `https://simsa-frontend.vercel.app/`.
2. Kamu akan melihat halaman login SIMSA.

---

## Langkah 2: Klik Tombol "Masuk dengan Google"

1. Di bagian bawah form login, cari tombol **"Masuk dengan Google"**.

:::tip Tampilan Tombol Google
Di bagian bawah form login, terdapat pembatas **"Atau lanjutkan dengan"** dan tombol **"Masuk dengan Google"**. Klik tombol ini untuk membuka autentikasi Google.
:::

2. Klik tombol tersebut.

---

## Langkah 3: Pilih Akun Google

1. Browser akan membuka halaman autentikasi Google dan menampilkan daftar akun yang tersedia.
2. Pilih akun yang ingin kamu gunakan untuk login.
3. Jika diminta, masukkan password akun Google kamu.

---

## Langkah 4: Login Berhasil

1. Setelah verifikasi selesai, kamu akan **otomatis diarahkan ke Dashboard** SIMSA.
2. SIMSA hanya menautkan identitas Google ke akun yang sudah diprovisi. Login ditolak bila email belum terdaftar, belum memiliki role/unit, atau dinonaktifkan.

---

## ❓ FAQ

**Q: Apakah saya perlu daftar dulu sebelum login via Google?**
> Akun harus diprovisi oleh Super Admin terlebih dahulu. SIMSA tidak membuat akun baru secara otomatis dari login Google.

**Q: Saya sudah daftar dengan email yang sama, apakah bisa login via Google?**
> Bisa jika akun tersebut dibuat oleh Super Admin, aktif, serta sudah memiliki role dan unit kerja. Hubungi Super Admin jika penautan akun belum tersedia.

**Q: Halaman Google tidak terbuka atau kembali ke halaman login?**
> Pastikan cookie dan redirect diizinkan, lalu gunakan alamat SIMSA resmi. Bila tetap gagal, minta pengelola memeriksa konfigurasi OAuth dan provisioning akun.

---

[⬅️ Sebelumnya: Daftar Menggunakan Email](daftar-email.md) | [Selanjutnya: Browser yang Kompatibel ➡️](../tutorial-dasar/browser-kompatibel.md)
