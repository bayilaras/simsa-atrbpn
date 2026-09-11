# SIMSA — Pengelolaan Surat dan Arsip

SIMSA mendukung pencatatan surat, pemberkasan, pencarian arsip, lokasi fisik,
peminjaman, klasifikasi/JRA, dan pengendalian akses per unit kerja.

## Gunakan pada komputer ini

Untuk lingkungan Windows lokal yang sudah disiapkan, jalankan dari folder ini:

- **Mulai-SIMSA.cmd** — menyalakan layanan lokal dan membuka `http://127.0.0.1:3000` setelah siap.
- **Cek-SIMSA.cmd** — memeriksa status layanan.
- **Hentikan-SIMSA.cmd** — menghentikan layanan lokal yang dikelola launcher.

Launcher memakai SIMSA lengkap dalam mode **internal/full**, menggunakan data dan
konfigurasi lingkungan yang sudah ada; proses mulai tidak membuat ulang database,
mengulang seed, atau menjalankan migrasi. Alamat loopback ini untuk komputer ini
saja. Penyimpanan berkas digital pada lingkungan lokal ini belum dikonfigurasi;
mulai dengan pencatatan metadata, impor CSV, dan penelusuran arsip fisik.

Ikuti [Mulai Inventaris Internal](docs-site/docs/mulai-inventaris-internal.md)
untuk login, akun per unit, surat, impor, serta pencarian lokasi. Lampiran digital
dan proses berbukti file digunakan setelah fasilitasnya siap; panduan ini tidak
menyatakan seluruh fitur atau integrasi eksternal sudah operasional.

Untuk membangun ulang setelah perubahan kode, operator dapat menjalankan
`npm run build:internal` dengan dependensi yang sudah terpasang. Perintah ini
membangun frontend mode full dengan Better Auth dan API pada origin yang sama,
beserta backend. Perintah build dan launcher tidak menjalankan `npm ci` atau
migrasi secara otomatis; penyiapan dependensi/database mengikuti petunjuk
pengembangan di bawah.

## Pilih aplikasi

| Jalur | Direktori | Cakupan |
| --- | --- | --- |
| SIMSA lengkap | `frontend/` + `backend/` | React, Express, PostgreSQL; berkas digital membutuhkan private object storage dan antivirus yang dikonfigurasi. |
| SIMSA Spark | `spark/` | Edisi terpisah berbasis Firebase Auth/Firestore untuk metadata dan lokasi arsip fisik; belum mencakup unggah dokumen atau seluruh alur versi lengkap. |

Lihat [panduan pengguna](docs/README.md), [spesifikasi fitur](product_specification.md),
dan [hasil pemeriksaan kesiapan](docs/KESIAPAN_PENGGUNA_2026-09-11.md).
Panduan [Spark](spark/README.md) menjelaskan batas dan cara menjalankan edisi tersebut.

## Pengembangan versi lengkap

Gunakan Node **24.x**, npm, dan database PostgreSQL **16+** terpisah untuk pengujian.
Petunjuk konfigurasi, bootstrap role, migrasi, seed, dan akun sintetis ada di
[LOCAL_TESTING.md](LOCAL_TESTING.md). Contoh konfigurasi ada di
`backend/.env.example` dan `frontend/.env.example`; isi kredensial lokal sendiri.

Dari direktori repositori:

```sh
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix backend test
npm --prefix backend exec -- tsc --noEmit
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix backend run build
npm --prefix frontend run build
```

Setelah database dan environment siap, jalankan backend dari direktori `backend`
dengan `npm run dev`, dan frontend dari direktori `frontend` dengan
`npm run dev -- --host 127.0.0.1 --port 3000 --strictPort`.
Buka `http://localhost:3000`; `FRONTEND_URL` dan `BETTER_AUTH_URL` harus memakai
origin yang sama persis. Biarkan `VITE_API_URL` kosong agar `/api` diproksi Vite.
Untuk juga menguji login email melalui `http://127.0.0.1:3000`, tambahkan
`ADDITIONAL_TRUSTED_ORIGINS=http://127.0.0.1:3000` pada environment backend,
lalu restart backend. Browser menganggap `localhost` dan `127.0.0.1` sebagai
host berbeda, sehingga perlu login terpisah pada masing-masing alamat.
Konfigurasi tambahan ini hanya untuk pengembangan lokal; domain deployment
harus dikonfigurasi secara eksplisit dengan HTTPS.
Batasi listener backend ke loopback atau gunakan lingkungan pengembangan terisolasi.

Perintah `npm start`/`npm run build` di akar repositori adalah launcher **demo
metadata** yang memerlukan konfigurasi eksplisit; perintah itu bukan startup
default versi lengkap. Seed tester hanya untuk database uji.

## Menuju operasional

Untuk target Firebase/Google Cloud, ikuti [arsitektur dan infrastruktur](docs/infra/firebase-gcp/README.md),
[pemeliharaan database](GCP_DATABASE_MAINTENANCE.md),
[backup dan pemulihan](CLOUD_SQL_BACKUP_RECOVERY.md), serta
[prosedur rilis](GCP_BACKEND_RELEASE.md).
Hasil pengujian lokal perlu dilengkapi uji layanan penyimpanan, antivirus,
backup/restore, akun, domain, dan penerimaan pengguna pada lingkungan tujuan.
