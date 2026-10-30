# SIMSA — Pengelolaan Surat dan Arsip

SIMSA (Sistem Informasi Manajemen Surat dan Arsip) mendukung pencatatan surat,
pemberkasan, pencarian arsip, lokasi fisik, peminjaman, klasifikasi/JRA, dan
pengendalian akses per unit kerja di Direktorat Jenderal Pengadaan Tanah dan
Pengembangan Pertanahan (Ditjen PTPP), Kementerian ATR/BPN.

SIMSA digunakan sebagai aplikasi mandiri dengan profil **internal/full**.
Pengelolaan surat dan arsip tidak memerlukan koneksi, akun, atau sinkronisasi
SRIKANDI. Pengembangan difokuskan pada kemudahan alur kerja, pencarian, dan
ketertelusuran di SIMSA; hasilnya dinilai melalui pengujian dan UAT pengguna.
[Profil aplikasi](docs/PROFIL_APLIKASI_INTERNAL.md) menjelaskan ruang lingkup,
konfigurasi, prasyarat setiap fitur, dan rujukan regulasinya.

## Akses pengguna

Staf membuka SIMSA di **https://simsa-frontend.vercel.app** dengan akun yang
dibuat Super Admin. Menu **Panduan** di aplikasi membuka panduan pengguna.
Panduan yang lebih lengkap ada di [Mulai Inventaris Internal](docs-site/docs/mulai-inventaris-internal.md)
(login, akun per unit, surat, impor, serta pencarian lokasi), situs panduan
`docs-site/`, dan [Buku Panduan Penggunaan](PANDUAN_PENGGUNAAN_SIMSA.md).
Lampiran digital dan proses berbukti file digunakan setelah fasilitasnya siap;
panduan ini tidak menyatakan seluruh fitur atau integrasi eksternal sudah
operasional.

## Produksi

| Bagian | Layanan |
| --- | --- |
| Frontend | React + Vite, proyek Vercel `simsa-frontend` (https://simsa-frontend.vercel.app). |
| Backend API | Express, proyek Vercel `simsa-backend` di region `sin1`. Jadwal cron ada di `backend/vercel.json`; pemindaian malware memakai ClamAV native pada fungsi `api/internal-malware-scan.js`. |
| Database | Neon PostgreSQL; skema dan migrasi Drizzle di `backend/src/db/migrations`. |
| Berkas digital | Vercel Blob privat; berkas dibuka melalui gateway backend yang terautentikasi. |
| Login | Better Auth dengan Google OAuth dan email/kata sandi. |
| Situs panduan | Docusaurus (`docs-site/`), proyek Vercel `simsa-atrbpn`; dipublikasikan manual. |

Rilis produksi berjalan lewat workflow `.github/workflows/release-vercel.yml`
yang memerlukan persetujuan, atau lewat jalur manual di
[runbook kredensial database dan rilis](docs/RUNBOOK_KREDENSIAL_DATABASE.md).
Migrasi database tetap langkah operator terpisah (`scripts/ops/rilis-neon.ps1`).
Workflow `operations-monitor.yml`, `operations-fixity.yml`, dan
`operations-recovery.yml` menjalankan pemantauan, pemeriksaan integritas berkas,
serta cadangan dan uji pemulihan harian terhadap produksi.

## Struktur repositori

| Direktori | Isi |
| --- | --- |
| `frontend/` | Aplikasi React (Vite); proyek Vercel `simsa-frontend`. |
| `backend/` | API Express dan PostgreSQL (Drizzle); proyek Vercel `simsa-backend`. |
| `docs-site/` | Situs panduan Docusaurus; `vercel.json` di akar membangunnya. |
| `scripts/` | Skrip operasional Neon, cadangan dan pemulihan, rilis (`scripts/ops/`), serta pemeriksaan deployment. |
| `docs/` | Runbook operasional dan panduan pengguna versi Markdown. |
| `deploy/neon/` | Template environment untuk menyiapkan database Neon baru. |

## Pengembangan

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

Akar repositori tidak memiliki perintah `npm start`/`npm run build` aplikasi;
`npm test` di akar menjalankan tes skrip operasional dan kontrak deployment
(jalankan `npm ci` di `backend/` dan `frontend/` lebih dahulu).
Seed tester hanya untuk database uji.

## Runbook operasional

| Topik | Dokumen |
| --- | --- |
| Rilis, kredensial database, dan rollback | [RUNBOOK_KREDENSIAL_DATABASE.md](docs/RUNBOOK_KREDENSIAL_DATABASE.md) |
| Konfigurasi Vercel dan Neon | [DEPLOY_VERCEL_NEON.md](docs/DEPLOY_VERCEL_NEON.md) |
| Menyiapkan database Neon baru | [PENYIAPAN_DATABASE_NEON.md](docs/PENYIAPAN_DATABASE_NEON.md) |
| Cadangan dan pemulihan | [OPERATIONS_RECOVERY.md](docs/OPERATIONS_RECOVERY.md), [BACKUP_NEON.md](docs/BACKUP_NEON.md) |
| Monitoring operasional | [OPERASI_MONITORING.md](docs/OPERASI_MONITORING.md) |
| Antivirus dan integritas berkas | [OPERASI_ANTIVIRUS_BITSTREAM.md](docs/OPERASI_ANTIVIRUS_BITSTREAM.md), [OPERASI_PEMERIKSAAN_INTEGRITAS.md](docs/OPERASI_PEMERIKSAAN_INTEGRITAS.md), [OPERATIONS_FIXITY.md](docs/OPERATIONS_FIXITY.md) |
| Operasional backend dan rekonsiliasi unggahan | [OPERASIONAL_BACKEND.md](docs/OPERASIONAL_BACKEND.md), [BLOB_UPLOAD_RECONCILIATION.md](docs/BLOB_UPLOAD_RECONCILIATION.md) |
| Verifikasi akses setelah deploy | [VERIFIKASI_AKSES_CLOUD.md](docs/VERIFIKASI_AKSES_CLOUD.md) |
| Impor dan ekspor data | [IMPOR_CSV_DAN_EKSPOR.md](docs/IMPOR_CSV_DAN_EKSPOR.md) |
| Integrasi surat masuk dan keluar | [RILIS_INTEGRASI_SURAT_P0_P5.md](docs/RILIS_INTEGRASI_SURAT_P0_P5.md), [RUNBOOK_INTEGRASI_SURAT_P5.md](docs/RUNBOOK_INTEGRASI_SURAT_P5.md) |

Hasil pengujian lokal perlu dilengkapi uji layanan penyimpanan, antivirus,
backup/restore, akun, domain, dan penerimaan pengguna pada lingkungan tujuan.
