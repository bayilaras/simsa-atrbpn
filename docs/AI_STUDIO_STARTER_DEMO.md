# Paket demo online Google AI Studio

## Status dan batas keputusan

Repositori menyediakan paket **satu origin** untuk frontend Vite dan API Node
pada satu proses HTTP. Paket ini ditujukan untuk demo metadata sintetis dan
bukan pengganti rancangan Production. Belum ada deployment cloud yang dilakukan
atau diklaim berhasil dari perubahan ini.

Kecocokan koneksi database Google AI Studio Starter Tier masih harus dibuktikan
setelah AI Studio benar-benar menyediakan project dan Cloud SQL developer
edition. Backend saat ini sengaja menolak kontrak database GCP yang tidak
memakai identitas IAM project yang sama dan koneksi Cloud SQL Auth Proxy lokal.
Jangan melemahkan batas tersebut dengan service-account JSON, password statis,
atau `DATABASE_URL` Production hanya agar deployment dapat menyala.

Starter Tier membuat project terkelola yang terpisah dari project Firebase
Spark yang sudah ada. Project itu mendukung Cloud Run, Firebase Authentication,
Firestore, dan Cloud SQL developer edition, tetapi tidak dapat mengaktifkan API
Google Cloud lain secara bebas. Cloud SQL developer edition Starter memiliki
0,5 vCPU, RAM 2 GB, storage 1 GB, dan tidak menyediakan backup/recovery atau
high availability. Karena itu target ini hanya boleh memakai data sintetis.

Referensi resmi:

- <https://docs.cloud.google.com/docs/starter-tier>
- <https://docs.cloud.google.com/sql/docs/postgres/ai-assisted-coding-and-cloud-sql>
- <https://ai.google.dev/gemini-api/docs/aistudio-deploying>

## Berkas paket

- `Dockerfile.demo` membangun frontend dan backend secara terpisah, lalu hanya
  menyalin `frontend/dist`, bundle backend, serta dependency runtime ke image.
- `package.json` menyediakan orkestrasi build/start dari root untuk importer
  source yang mengenali aplikasi Node pada root.
- `scripts/build-demo.mjs` memaksa kontrak demo pada waktu build. Build Firebase
  memerlukan konfigurasi Web SDK publik yang lengkap. Build Better Auth hanya
  tersedia melalui perintah lokal eksplisit.
- `scripts/start-demo.mjs` mengaktifkan lokasi static build sebelum mengimpor
  server backend. Perintah ini tidak menjalankan migrasi atau seed.
- `backend/src/middlewares/frontend-hosting.middleware.ts` memvalidasi build dan
  melayani SPA pada origin API yang sama.

## Kontrak build

Build demo Firebase:

```text
npm run build:demo
```

`npm run build` pada package root sengaja menunjuk ke build demo yang sama agar
importer source/buildpack tidak dapat membangun UI mode penuh secara diam-diam.
Build komponen mode penuh tetap tersedia secara eksplisit untuk jalur rilis lama
melalui `npm run build:full`; perintah itu bukan paket demo online.

Sebelum perintah tersebut, isi hanya variabel Web SDK publik berikut pada
environment build:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_APP_CHECK_SITE_KEY
```

Script memaksa `VITE_API_URL` kosong, `VITE_APP_MODE=metadata-demo`,
`VITE_APP_PROFILE=internal`, `VITE_AUTH_PROVIDER=firebase`,
`VITE_STORAGE_PROVIDER=disabled`, dan SRIKANDI nonaktif. Jangan memasukkan
service-account key atau secret backend ke variabel `VITE_*`.

Untuk integrasi lokal dengan database PostgreSQL terisolasi dan Better Auth:

Salin `.env.demo.example` ke `.env.demo.local` di root, kemudian isi secret dan
koneksi API-role untuk database demo yang sudah dimigrasikan. Nama database pada
URL wajib sama dengan `SIMSA_DEMO_DATABASE`. Contoh ini sengaja tidak berisi
password default atau kredensial yang dapat langsung dipakai.

```text
npm run build:demo:local
```

Perintah lokal ini mengaktifkan gate build `SIMSA_DEMO_LOCAL_BUILD=true`. Server
lokal juga harus menerima `SIMSA_DEMO_LOCAL_AUTH=true`. Kedua gate ditolak pada
runtime ter-deploy; tidak ada fallback otomatis dari Firebase ke Better Auth.
Simpan konfigurasi runtime lokal dalam `.env.demo.local` (sudah tercakup pola
ignore `.env.*.local`), gunakan secret Better Auth yang hanya untuk pengembangan,
dan arahkan `SIMSA_DEMO_DATABASE`/`DATABASE_URL` ke database demo terpisah. Setelah
build lokal selesai, jalankan layanan satu-origin dengan:

```text
node --env-file=.env.demo.local scripts/start-demo.mjs
```

Mode ini hanya bind ke `127.0.0.1`; ia tidak mempublikasikan Better Auth lokal ke
LAN. Jangan menyalin secret atau koneksi database Production ke file tersebut.

Setiap build menghasilkan `/simsa-build.json`. Manifest hanya memuat mode,
provider, serta identitas Firebase publik (project ID, auth domain, dan app ID),
tanpa API key atau secret. Saat startup metadata-demo, backend membandingkan
manifest itu dengan otoritas Firebase dan daftar App Check backend. Perbedaan
project, auth domain, app ID, provider, mode, atau field tambahan menghentikan
startup.

## Kontrak runtime

Image demo mendengarkan `PORT` (default image `8080`) dan menjalankan:

```text
node backend/dist/index.js
```

Root source/buildpack launcher menjalankan:

```text
npm start
```

Launcher root menolak startup kecuali `SIMSA_APP_MODE=metadata-demo` diberikan
secara eksplisit. Ia tidak pernah mengubah mode penuh menjadi demo secara
otomatis; hal ini mencegah package demo menerbitkan UI Production karena salah
konfigurasi.

Runtime Cloud harus mengisi konfigurasi database, Firebase, App Check, CSRF,
origin HTTPS, database demo, dan pengakuan data sintetis melalui secret/config
environment. Nilai aman yang dipaksa image mencakup:

```text
SIMSA_APP_MODE=metadata-demo
SIMSA_CLOUD_PLATFORM=gcp
APP_PROFILE=internal
AUTH_PROVIDER=firebase
OBJECT_STORAGE_PROVIDER=disabled
SRIKANDI_ENABLED=false
MALWARE_SCANNER_MODE=disabled
MALWARE_SCAN_WORKER_ENABLED=false
```

Nilai berikut tidak dipanggang ke image dan harus benar-benar berasal dari
environment terisolasi:

```text
SIMSA_DEMO_DATA_ACKNOWLEDGED=true
SIMSA_DEMO_DATABASE=simsa_demo...
DB_NAME=<sama dengan SIMSA_DEMO_DATABASE>
GOOGLE_CLOUD_PROJECT=<project Starter>
FIREBASE_PROJECT_ID=<project Starter yang sama>
FIREBASE_AUTH_DOMAIN=<domain build yang sama>
FIREBASE_SESSION_CSRF_SECRET=<secret minimal 32 karakter>
FIREBASE_APP_CHECK_APP_IDS=<exact VITE_FIREBASE_APP_ID>
FRONTEND_URL=https://<origin publik exact>
```

Kontrak database GCP yang saat ini diwajibkan adalah Cloud SQL Auth Proxy pada
loopback atau socket `/cloudsql/<project>:...`, `DB_PASSWORD` kosong, dan
`DB_USER` berupa principal IAM `...@<project>.iam`. AI Studio Starter mungkin
menyediakan bentuk koneksi atau hak PostgreSQL yang berbeda. Catat environment
non-rahasia dan atribut role yang benar-benar diberikan, lalu review sebelum
menambahkan adapter kompatibilitas; jangan menebak kontraknya.

Identitas service account API yang benar-benar terpasang juga memerlukan
`roles/firebaseappcheck.tokenVerifier` pada project Firebase yang sama.
Role ini hanya memberi `firebaseappcheck.appCheckTokens.verify`, yang dipakai
ketika login dan pencabutan sesi mengonsumsi token App Check sekali pakai.
Terraform mengikatnya hanya ke `simsa-api-runtime`; identitas worker, event,
migrasi, dan backup tidak menerimanya. Untuk Starter, periksa identitas runtime
yang benar-benar disediakan sebelum provisioning; jangan menganggapnya sama
dengan identitas Terraform atau mengganti role ini dengan Firebase Admin.
Lihat [kontrak replay protection Firebase](https://firebase.google.com/docs/app-check/custom-resource-backend#replay_protection_beta)
dan [permission role resmi](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseappcheck).

`/ready` menguji akses konfigurasi Firebase Auth, bukan konsumsi token App Check.
Sebelum URL dibagikan, uji login dengan token limited-use baru dan pastikan
pemakaian ulang token tersebut ditolak. Keberhasilan probe saja belum membuktikan
kontrak IAM replay protection atau login live.

## Routing dan keamanan static

- `/api`, `/health`, `/ready`, dan `/internal` tidak pernah menerima fallback
  SPA dan tidak dapat ditimpa file static.
- Hanya file build dengan ekstensi yang diizinkan yang dilayani. Dotfile,
  `package.json`, lockfile, TypeScript, source map, dan source tree ditolak.
- Fallback SPA hanya berlaku untuk request `GET`/`HEAD`, menerima HTML, dan path
  tanpa ekstensi. Request JSON, mutation, serta asset yang hilang tetap 404.
- Asset `/assets/*` memakai cache immutable; HTML, manifest, dan service worker
  memakai `no-store`.
- Startup gagal bila directory build, `index.html`, atau manifest demo hilang,
  tidak valid, atau tidak cocok dengan backend.

`/health` adalah liveness proses tanpa dependency remote. `/ready` adalah gate
dependency dan harus 200 sebelum URL dibagikan. Database migration dan seed
tetap pekerjaan maintenance eksplisit; keduanya tidak pernah dijalankan saat
web service boot.

## Gerbang sebelum percobaan online

1. Import branch/commit yang sudah direview ke Google AI Studio dan aktifkan
   database/auth pada project Starter yang dibuat AI Studio, bukan project/data
   Production.
2. Verifikasi kontrak koneksi dan hak role Cloud SQL yang benar-benar diberikan.
   Jika tidak cocok dengan guard backend, berhenti dan implementasikan adapter
   terbatas beserta tes; jangan memberikan role superuser.
3. Jalankan migrasi dan seed sintetis secara eksplisit pada database demo.
4. Pastikan `/health` dan `/ready` 200, manifest build cocok, login Firebase dan
   pembatasan App Check berfungsi, serta route file/upload tetap tidak tersedia.
5. Uji logout, CSRF, RBAC/unit scope, CRUD metadata, ekspor metadata, restart,
   dan scale-to-zero/wake-up. Jangan unggah arsip asli.

Docker daemon lokal belum tersedia, tetapi build dan pemeriksaan image
`Dockerfile.demo` telah lulus pada runner Linux dalam
[CI PR #4](https://github.com/bayilaras/simsa-atrbpn/actions/runs/33943749921)
untuk head `72ee8236a0ba491a1babe25b9232a25b78bd6da1`.
Setiap perubahan berikutnya tetap memerlukan CI baru. Bukti image tersebut
tidak membuktikan kompatibilitas Starter Tier atau koneksi cloud live.

## Pemeriksaan PR dan batas promosi

Setelah dependency frontend/backend terpasang, `npm test` dari root menjalankan
kontrak launcher, manifest, dan hosting. CI juga membangun `Dockerfile.demo`
dengan konfigurasi Firebase publik inert, lalu memeriksa user non-root, mode,
manifest, aset, serta ketiadaan source dan tooling maintenance. Container
pemeriksaan tidak memiliki jaringan; hasilnya bukan pengujian Firebase live.

Perubahan demo harus mendapat review manusia pada exact head PR yang terbaru.
Approval untuk commit lama tidak berlaku untuk perubahan ini. Setelah merge,
ulangi required checks pada merge commit sebelum provisioning atau promosi.
Jangan mengaktifkan billing, mengubah project Spark `arsip-d16d3`, atau memakai
data arsip asli untuk membuktikan kelayakan Starter Tier.

Konfigurasi Vercel untuk root repositori, backend, frontend, dan dokumentasi
menonaktifkan deployment otomatis dari `main`. Gate root juga penting ketika
project dokumentasi memakai root repositori, bukan `docs-site` sebagai root.
Semua entry point tersebut diuji oleh tes konfigurasi frontend. Promosi tetap
harus dilakukan secara eksplisit setelah checks merge commit; jangan mengandalkan
merge Git untuk mempromosikan alias Production. Mekanismenya mengikuti
[konfigurasi Git Vercel](https://vercel.com/docs/project-configuration/git-configuration).

Saat impor GitHub memerlukan OAuth/instalasi aplikasi baru, pemilik akun harus
memeriksa dan menyetujui izin yang diminta. Batasi akses ke repositori ini bila
pilihan tersebut tersedia. Persetujuan itu terpisah dari review PR dan tidak
memberi izin otomatis untuk deploy atau menulis database Production.
