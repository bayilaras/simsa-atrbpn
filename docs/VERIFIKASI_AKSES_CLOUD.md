# Verifikasi akses SIMSA pada hosting sebenarnya

`scripts/verify-cloud-access.mjs` memeriksa kesehatan API, kesesuaian fitur, penolakan akses anonim, login akun yang sudah ada, pembacaan unit kerja, logout, dan penolakan cookie sesi lama. Jalankan setelah build dan konfigurasi aplikasi dipasang pada alamat tujuan. Skrip tidak membuat akun atau mengubah metadata arsip.

Keberhasilan pemeriksaan ini hanya membuktikan akses HTTP dan sesi. Ini tidak membuktikan kesiapan produksi, perilaku cookie di browser, pemindaian antivirus, integritas dokumen, backup, kapasitas, atau kelayakan paket hosting untuk penggunaan instansi. Uji terpisah tetap diperlukan.

## Konfigurasi privat

Gunakan Node.js 24. Buat file di direktori privat di luar repository, dengan izin baca hanya untuk operator. Jangan menyalin kredensial ke argumen perintah atau Git. File berisi:

```dotenv
CLOUD_ACCESS_EXPECTED_ORIGIN=https://nama-aplikasi.vercel.app
FIRST_ADMIN_EMAIL=alamat-akun-yang-sudah-dibuat
FIRST_ADMIN_PASSWORD=kata-sandi-akun-tersebut
```

Isi origin dari URL deployment yang benar-benar ditampilkan provider dan telah dipilih operator. Nama pada contoh bukan alamat SIMSA yang sudah diterbitkan. Skrip menerima subdomain HTTPS Vercel, Render, atau Netlify; target harus sama persis dengan pin privat. Redirect ke alamat lain ditolak, termasuk halaman login provider. Jangan menonaktifkan proteksi deployment untuk membuat pemeriksaan lolos; atur jalur akses pengujian yang sesuai terlebih dahulu.

## Menjalankan pemeriksaan

Contoh PowerShell dari akar repository:

```powershell
$cloudAccessEnv = Join-Path $env:USERPROFILE '.simsa-cloud-private/cloud-access.env'
node scripts/verify-cloud-access.mjs `
  --origin 'https://nama-aplikasi.vercel.app' `
  --env-file $cloudAccessEnv `
  --files enabled
```

Pilih `--files enabled` untuk deployment yang harus menyediakan dokumen digital. Jika layanan berkas belum tersedia, pemeriksaan berhenti sebelum mengirim kredensial. `--files disabled` hanya untuk memeriksa konfigurasi yang sengaja dibatasi ke metadata; hasil tersebut tidak memenuhi kebutuhan produksi arsip digital. Tidak ada pilihan otomatis yang menyesuaikan ekspektasi agar pemeriksaan lolos.

Hasil tersanitasi disimpan dalam file baru di `output/cloud-verification/`. File tidak memuat email, kata sandi, token, cookie, body respons, atau exception mentah. Exit code `0` berarti seluruh pemeriksaan akses lulus; selain itu periksa nama tahap dan kode kegagalannya. Jangan menyamakan respons logout sukses dengan sesi tercabut: skrip menguji ulang cookie lama secara terpisah.

Setiap request dibatasi waktu maksimal 60 detik dan respons maksimal 256 KiB. Tidak ada retry login, timer, atau keep-alive layanan. Jika request login kehilangan respons, jangan menganggap sesi sudah dicabut; tinjau sesi akun melalui prosedur administrasi sebelum mengulang.

Tes regresi tanpa jaringan atau kredensial nyata:

```powershell
node --test scripts/verify-cloud-access.test.mjs
```
