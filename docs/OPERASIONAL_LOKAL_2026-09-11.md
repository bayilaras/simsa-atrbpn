# Penggunaan SIMSA pada komputer lokal

Paket ini menjalankan SIMSA internal/full dari hasil build frontend dan backend,
pada satu alamat: **http://127.0.0.1:3000**. Alamat `http://localhost:3000`
juga didukung untuk login. Listener hanya menerima koneksi dari komputer ini.

## Mulai dan selesai bekerja

1. Jalankan `Mulai-SIMSA.cmd` dari folder proyek. Tunggu keterangan aplikasi siap
   dan browser terbuka. Menjalankannya kembali tidak membuat proses aplikasi kedua.
2. Masuk menggunakan akun yang sudah tersedia. Super Admin membuat akun pengguna
   melalui **Administrasi → Manajemen Pengguna → Tambah Pengguna**, dengan peran
   dan unit yang sesuai. Kata sandi lama tidak diubah oleh pemasangan peluncur ini.
3. Gunakan `Cek-SIMSA.cmd` untuk melihat status aplikasi dan database.
4. Setelah pekerjaan selesai, `Hentikan-SIMSA.cmd` menghentikan aplikasi.
   PostgreSQL tetap berjalan. Mulai kembali dengan `Mulai-SIMSA.cmd`.

Petunjuk pencatatan, impor CSV, dan lokasi fisik tersedia di menu **Panduan**,
serta [Mulai Inventaris Internal](../docs-site/docs/mulai-inventaris-internal.md).

## Kemampuan lingkungan saat ini

- Pencatatan dan pencarian metadata surat/arsip, impor CSV dengan pratinjau,
  ekspor daftar, dan pengelolaan akun tetap tersedia sesuai hak akses.
- Penyimpanan privat dan pemeriksaan berkas belum dikonfigurasi. Unggahan,
  OCR/unggah massal, dan proses yang memerlukan bukti digital baru menunggu
  fasilitas tersebut. Tampilan menjelaskan keterbatasan ini; kontrol bukti,
  karantina, dan hak akses pada server tetap berlaku.
- Login Google disembunyikan ketika konfigurasi OAuth belum tersedia. Login
  email/kata sandi memakai akun lokal yang sama.
- Saat keluar, halaman pribadi disembunyikan dan formulir login menunggu
  penyelesaian permintaan logout. Bila penutupan sesi belum terkonfirmasi,
  pengguna mendapat penjelasan dan tombol **Coba keluar lagi**.
- Konektor SRIKANDI nonaktif. Hal ini tidak menghalangi impor metadata/JSON;
  tombol dan proses integrasi SRIKANDI mempunyai pemeriksaan tersendiri.
- Mode aplikasi tetap full. Ketidakcocokan mode frontend/backend atau penyedia
  login menghentikan formulir dengan penjelasan sebelum data dimasukkan.

## Catatan untuk pengelola

Peluncur menggunakan Node 24 portabel, PostgreSQL 18, database `simsa_local`
pada `127.0.0.1:55432`, serta konfigurasi lokal yang sudah disiapkan di
`output/local-runtime`. Identitas cluster dan proses diperiksa sebelum start/stop.
Peluncur tidak menjalankan instalasi paket, migrasi, seed, atau reset data.
Port yang dipakai proses di luar peluncur ditolak tanpa mengambil alih prosesnya.

File konfigurasi/kredensial, data PostgreSQL, hasil build, dan log tidak dimasukkan
ke Git. Tiga tombol ini ditujukan untuk komputer yang telah disiapkan ini;
menyalin repositori ke komputer lain belum memindahkan database dan konfigurasinya.

Setelah perubahan kode, pengelola menghentikan aplikasi, menjalankan
`npm run build:internal` dengan Node 24 dan dependensi frontend/backend yang
sudah terpasang, lalu menjalankan `Mulai-SIMSA.cmd`. Perintah build menetapkan
frontend full/Better Auth/same-origin
dan membangun backend, tanpa instalasi dependensi atau migrasi otomatis.

Untuk penghentian database terencana, setelah semua pekerjaan disimpan, gunakan
PowerShell dari folder proyek:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/local-runtime.ps1 -Action stop -StopDatabase
```

`Mulai-SIMSA.cmd` akan menyalakan kembali cluster yang sama. Jangan menghapus
`output/local-runtime/postgres-data` atau menjalankan bootstrap untuk mengatasi
gangguan start. Pemeriksaan awal tersedia pada `Cek-SIMSA.cmd`; log layanan ada
di `output/local-runtime/internal-app.stdout.log` dan `internal-app.stderr.log`.
Konfigurasi database dan kata sandi tidak perlu dikirim saat melaporkan gangguan.

Pemakaian bersama melalui jaringan kantor atau domain memerlukan konfigurasi
server, HTTPS, serta operasi pencadangan yang sesuai. Penyimpanan privat dan
pemindai diperlukan ketika lampiran digital akan dikelola.
Paket loopback ini belum menerbitkan layanan ke jaringan kantor atau internet.

## Verifikasi paket lokal

Pengujian tanggal 11 September 2026 menggunakan data sintetis dan akun uji.

- Build internal frontend dan backend berhasil. API `/health` dan `/ready`
  mengembalikan 200; koneksi database siap.
- 19 tes peluncur Windows lulus. Start berulang mempertahankan proses yang sama;
  stop biasa mempertahankan PostgreSQL; penghentian dan start ulang PostgreSQL
  memakai identitas cluster yang sama. Uji nyata menemukan dan memperbaiki
  kehilangan exit code proses singkat pada Windows PowerShell 5.
- 24 tes pembatasan runtime lokal lulus, termasuk penolakan konfigurasi cloud,
  alamat/database berbeda, cookie domain eksternal, serta build demo yang salah.
- Pemeriksaan frontend terakhir lulus: 51 file, 276/276 tes. Lint seluruh
  frontend juga lulus. Tes mencakup kontrak logout yang melaporkan kegagalan
  server, penahanan formulir saat pending, dan pembersihan draft.
- Pemeriksaan backend menyeluruh menghasilkan 1.888 tes lulus dan dua kegagalan
  saat pengerjaan: timeout persiapan database PGlite serta tes kapabilitas ketika
  implementasinya masih diperbarui. Kedua file diuji ulang setelah perbaikan,
  dengan 16/16 tes lulus tanpa menaikkan batas waktu atau menonaktifkan tes.
- Alur browser pada kedua alamat lokal lulus masing-masing 11 langkah: login,
  penolakan tanggal CSV tidak valid, dialog laptop/ponsel, pratinjau tanpa mutasi,
  impor sintetis, penolakan duplikat, ekspor sesuai filter, halaman terjaga dan
  penyusutan, logout, serta pemeriksaan galat browser.
  Empat rekod sintetis yang dibuat selama pemeriksaan ini kemudian diverifikasi
  berdasarkan nomor/perihal/tanggalnya dan dibersihkan lewat API berizin.
- Uji browser tambahan membuktikan halaman/formulir ditahan selama POST logout
  ditunda, sesi terhapus ketika formulir login kembali, serta kegagalan 503 yang
  disimulasikan menampilkan pesan dan dapat diselesaikan lewat tombol coba lagi.
- Konfigurasi berkas/Google, halaman pengganti layanan berkas, panduan, tampilan
  ponsel, dan pemuatan aset di bawah CSP lokal diperiksa melalui browser.

Bukti lokal berada di `output/local-runtime`: `launcher-transition-evidence.json`,
`internal-build-final.log`, `internal-backend-tests.log`,
`internal-backend-recheck.log`, `internal-frontend-final-tests.log`,
`internal-browser-result.json`,
`browser-readiness-127.0.0.1.json`, `browser-readiness-localhost.json`, dan
`logout-browser-result.json`. Bukti ini tidak menyatakan penyimpanan digital,
konektor eksternal, deployment jaringan, atau sertifikasi instansi telah tersedia.
