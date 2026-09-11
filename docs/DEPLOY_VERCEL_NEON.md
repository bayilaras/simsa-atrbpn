# Kompatibilitas Vercel dan Neon

Jalur ini memakai dua proyek Vercel yang sudah ada: `simsa-frontend` dengan Root Directory `frontend`, serta `simsa-backend` dengan Root Directory `backend`. Frontend meneruskan `/api`, `/health`, `/ready`, dan `/uploads` melalui origin yang sama. Root `vercel.json` tetap menerbitkan dokumentasi; jangan memilih root tersebut sebagai aplikasi SIMSA. Pilih revisi yang memuat perubahan ini, bukan Production lama, dan pertahankan proses verifikasi sebelum promosi domain.

Ini persiapan kompatibilitas, bukan pernyataan bahwa arsip digital lengkap siap Production atau bahwa paket gratis memenuhi kebutuhan instansi. Kelayakan akun/paket, kapasitas, pemantauan, backup/restore, penyimpanan privat, dan pemindai berkas masih harus dibuktikan pada lingkungan tujuan. Jangan mengaktifkan layanan berbayar atau mengandalkan paket gratis sebagai SLA.

## Build dan runtime

- Gunakan Node.js `24.x` pada kedua proyek. Backend memakai `node scripts/build-vercel.mjs`; aktifkan **Include source files outside of the Root Directory in the Build Step** agar validator bersama dari `scripts/` tersedia saat build. Validator dibundel ke `backend/dist-vercel/vercel-runtime.js`; runtime tidak memerlukan berkas di luar proyek backend.
- Backend tetap memakai handler Express `backend/api/index.js`, bukan menjalankan listener dari `src/index.ts`. Build menghasilkan `backend/dist-vercel` sehingga `backend/dist` milik runtime lokal tetap utuh. Tidak ada migrasi, seed, pembuatan pengguna, atau import data pada build/start.
- Tanpa `SIMSA_VERCEL_METADATA_ENABLED=true`, jalur lama tetap tersedia untuk konfigurasi penuh dengan penyimpanan privat dan worker yang benar. Kontrak Preview lama juga tetap berlaku. Menghapus flag metadata bukan pengganti konfigurasi dan verifikasi antivirus/penyimpanan.
- Database runtime menggunakan akun `simsa_api`, endpoint Neon **direct**, dan `sslmode=verify-full`. Jangan memakai endpoint `-pooler`: aplikasi memakai lease koneksi dan session advisory lock. Siapkan schema, grants, serta admin awal secara terpisah mengikuti [panduan Neon](DEPLOY_RENDER_NEON.md); gunakan jalur ini hanya setelah target eksplisit lolos verifikasi.
- Pool tetap dibagi per instance, maksimum bawaan Vercel tiga koneksi; `@vercel/functions` menangani idle pool sebelum suspension. Release koneksi dan transaksi aplikasi tetap wajib. Jumlah instance platform dapat menaikkan jumlah koneksi total; ukuran ini bukan jaminan kapasitas Neon.

## Tahap metadata dengan login nyata

Tahap terbatas ini menyimpan data nyata melalui Better Auth/PostgreSQL dan tetap memakai mode `full/internal`. Unggah/unduh berkas, OCR, dan integrasi SRIKANDI tidak dinyatakan aktif. Ini tidak memenuhi permintaan arsip digital lengkap hingga infrastrukturnya tersedia.

Pada **backend**, tetapkan nilai nonrahasia berikut secara eksplisit:

```dotenv
SIMSA_VERCEL_METADATA_ENABLED=true
NODE_ENV=production
APP_PROFILE=internal
SIMSA_APP_MODE=full
SIMSA_CLOUD_PLATFORM=local
AUTH_PROVIDER=better-auth
OBJECT_STORAGE_PROVIDER=disabled
GOOGLE_OAUTH_ENABLED=false
MALWARE_SCANNER_MODE=disabled
MALWARE_SCAN_WORKER_ENABLED=false
MALWARE_SCAN_WORKER_RUNTIME=external
SRIKANDI_ENABLED=false
DB_POOL_MAX=3
DB_CONNECT_TIMEOUT_MS=15000
```

`VERCEL=1` dan `VERCEL_ENV` berasal dari platform. Untuk Production, masukkan `DATABASE_URL`, `BETTER_AUTH_SECRET` (acak kriptografis, minimal 32 karakter), `FRONTEND_URL`, dan `BETTER_AUTH_URL` lewat pengaturan rahasia platform. Kedua URL aplikasi harus sama persis, berupa origin HTTPS tanpa path/trailing slash. Jangan mencetak atau menaruh nilai rahasia dalam Git, URL browser, maupun argumen CLI. Kosongkan `COOKIE_DOMAIN`, `ADDITIONAL_TRUSTED_ORIGINS`, `PGOPTIONS`, `SIMSA_FRONTEND_DIST`, `DB_HOST`, `CLOUD_SQL_UNIX_SOCKET`, serta konfigurasi penyimpanan lama. Backend menolak kombinasi yang bertentangan sebelum impor aplikasi/database.

Pada **frontend**, tetapkan `SIMSA_VERCEL_METADATA_ENABLED=true` dan `API_PROXY_ORIGIN` ke backend lingkungan yang tepat. Build otomatis mematok mode full, profil internal, Better Auth, storage disabled, SRIKANDI false, serta API same-origin; hasilnya `frontend/dist-vercel-metadata`. Jangan meletakkan database/secret pada variabel `VITE_*`.

Preview memerlukan `SIMSA_PREVIEW_ENABLED=true` serta empat sumber tersendiri: `PREVIEW_DATABASE_URL`, `PREVIEW_BETTER_AUTH_SECRET`, `PREVIEW_FRONTEND_URL`, `PREVIEW_BETTER_AUTH_URL`. Database, secret, dan origin tidak boleh memakai nilai Production yang diwarisi. SMTP dikosongkan pada Preview metadata agar tindakan uji tidak mengirim email melalui kredensial Production. Frontend Preview tetap memerlukan API proxy ke alias branch backend yang sesuai dan `BACKEND_VERCEL_PROTECTION_BYPASS` bila dilindungi Vercel. Tidak adanya sumber Preview menghasilkan respons tidak tersedia; flag metadata tidak melewati isolasi.

## Verifikasi dan batas yang tersisa

Jalankan tes terarah `node --test scripts/vercel-deployment.test.mjs`, tes backend `database-pool-config`, `vercel-preview-runtime`, dan `cloud-platform.config`, serta tes frontend `vercel-config`. Verifikasi artefak `simsa-build.json` menunjukkan `mode=full`, `syntheticDataOnly=false`, `authProvider=better-auth`, `storageProvider=disabled`, dan `api=same-origin`. Kemudian gunakan pemeriksaan HTTP terautentikasi terhadap domain tujuan: session cookie, penolakan tanpa izin, create/read/update metadata, audit, logout, dan penolakan file ketika storage disabled. Tes lokal/build tidak membuktikan deployment cloud berhasil.

Menurut [dokumentasi Node Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), Node 24 tersedia. Handler Express default didukung tanpa adapter tambahan ([panduan Express](https://vercel.com/kb/guide/ship-a-express-app-on-vercel)). Dengan Fluid Compute, Hobby membatasi satu invocation hingga 300 detik; batas payload request **dan response** adalah 4,5 MB dan bundle standar tidak terkompresi 250 MB ([batas Functions](https://vercel.com/docs/functions/limitations)). Durasi 300 detik sudah ditetapkan pada handler. Build aktual platform tetap harus membuktikan ukuran paket, termasuk dependensi PDF/native; build lokal tidak membuktikan tracing Linux.

JSON aplikasi dan hasil ekspor bisa melewati batas platform walaupun jumlah baris sudah dibatasi. Gunakan filter ekspor dan CSV berukuran kecil; jangan menjanjikan dukungan berkas besar melalui function. Jalur berkas lengkap membutuhkan private direct upload/callback yang benar serta worker antivirus persisten di luar Vercel. Pool lifecycle mengikuti [panduan koneksi Vercel](https://vercel.com/kb/guide/connection-pooling-with-functions), tanpa mengubah password hashing, transaksi, atau advisory lock.
