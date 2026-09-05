# Pengujian lokal tanpa resource cloud

Pengujian lokal tidak mengaktifkan billing, mengubah paket Firebase, melakukan
deployment, atau membuktikan kesiapan Production. Gunakan data sintetis dan
database terpisah; jangan memakai credential atau salinan arsip Production.

## Pemeriksaan kode

Gunakan Node 24.x sesuai `engines` dan lockfile yang sudah direview. Dari masing-
masing direktori jalankan:

```text
backend:  npm ci
          npm test
          npx tsc --noEmit
          npm run build

frontend: npm ci
          npm run lint
          npm test
          npm run build
```

Backend membatasi pekerja Vitest menjadi dua agar beberapa instance PGlite
tidak menghabiskan memori saat frontend dan database juga berjalan. Ini tidak
mengubah timeout/assertion maupun menyembunyikan tes gagal.

Tes PostgreSQL nyata terpisah: `npm run test:postgres-locks` membutuhkan
`TEST_POSTGRES_URL` dan principal fixture `TEST_DB_*` sesuai konfigurasi tes.
Jalankan hanya pada database disposable, bukan target yang dipakai pengguna.

## Database dan aplikasi

1. Sediakan PostgreSQL 16+ terisolasi, bind loopback, password baru, dan database
   kosong milik pengujian. Verifikasi host, port, database, serta data directory
   sebelum bootstrap. Jangan memodifikasi layanan database existing.
2. Ikuti pemisahan grant-admin, migrator, maintenance, runtime, dan backup-reader
   dalam `GCP_DATABASE_MAINTENANCE.md`, dengan identitas lokal tersendiri.
   Bootstrap schema/role sebelum `npm run db:migrate`; jangan memakai `db:push`.
   Setelah bootstrap final dan grant convergence, jalankan migrasi lagi: harus
   `0 applied`, dengan database `CREATE` migrator tetap ditolak.
3. Jalankan `npm run seed:all` memakai maintenance principal; ulangi dan bandingkan
   jumlah seed untuk membuktikan idempotensi. API tidak diberi privilege migrasi.
4. Untuk tes metadata tanpa Google, gunakan `NODE_ENV=development`,
   `SIMSA_CLOUD_PLATFORM=local`, `AUTH_PROVIDER=better-auth`, profil `internal`,
   dan nonaktifkan SRIKANDI/SMTP/worker yang belum dikonfigurasi. Buat secret
   Better Auth acak lokal. Jangan menyalin placeholder credential sebagai secret.
5. Buat akun sintetis dengan `npm run seed:tester`, menggunakan
   `SEED_TESTER_EMAIL` dan `SEED_TESTER_PASSWORD` lokal. Jangan memakai script ini
   pada database Production atau akun manusia.
6. Jalankan backend port 3001 dan frontend port 3000 hanya di loopback.
   `VITE_API_URL` kosong; samakan `BETTER_AUTH_URL` dan `FRONTEND_URL` ke origin
   frontend, misalnya `http://localhost:3000`. Override host dev server bila
   memakai konfigurasi default yang membuka interface jaringan lain.
7. Uji login, pemuatan daftar, create/read/update metadata, pencarian, ekspor,
   logout, serta penolakan permintaan tanpa sesi/CSRF. Periksa `/health` dan
   `/ready` pada backend; nilai ready untuk development tidak membuktikan semua
   integrasi eksternal aktif.

## Batas file, antivirus, dan backup

Tanpa private object storage yang benar-benar dikonfigurasi, pengujian surat
dengan link placeholder hanya membuktikan metadata, bukan preservasi berkas.
Jangan membuat lease/hasil scan palsu atau menurunkan pemeriksaan keamanan agar
upload terlihat berhasil. Build dengan nilai Firebase dummy hanya membuktikan
kompilasi, bukan login/App Check/GCS live.

ClamAV native dapat menguji protokol INSTREAM (clean, EICAR, unavailable, dan
restart). Worker nyata harus membuktikan heartbeat `running -> degraded ->
running`; tes antrean kosong tidak menggantikan alur upload sampai claim/final.
Hasil Windows native juga tidak menggantikan pengujian Linux Compose.

Backup drill lokal harus memakai backup-reader, snapshot konsisten, artifact
terenkripsi, key terpisah ber-ACL, serta instance restore baru. Bandingkan jumlah
dan fingerprint semua tabel pada snapshot yang sama, periksa jurnal migrasi dan
grant setelah restore, serta buktikan ciphertext yang diubah ditolak. Simpan
versi tool, hash artifact, dan evidence tanpa credential. Drill satu workstation
tidak menggantikan independent operator, backup Production, atau recovery GCP.

Hentikan proses uji milik sendiri secara graceful setelah selesai. Simpan data
fixture dan evidence yang diperlukan, tetapi jangan commit `.env`, password,
key backup, dump plaintext, atau artifact berisi data pengguna.
