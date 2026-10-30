# SIMSA — Pengelolaan Surat dan Arsip

SIMSA mendukung pencatatan surat, pemberkasan, pencarian arsip, lokasi fisik,
peminjaman, klasifikasi/JRA, dan pengendalian akses per unit kerja.

SIMSA digunakan sebagai aplikasi mandiri dengan profil **internal/full**.
Pengelolaan surat dan arsip tidak memerlukan koneksi, akun, atau sinkronisasi
SRIKANDI. Pengembangan difokuskan pada kemudahan alur kerja, pencarian, dan
ketertelusuran di SIMSA; hasilnya dinilai melalui pengujian dan UAT pengguna.
Lihat [profil aplikasi](docs/PROFIL_APLIKASI_INTERNAL.md) untuk konfigurasi dan
prasyarat masing-masing fitur.

## Akses pengguna

Staf membuka SIMSA di **https://simsa-frontend.vercel.app** dengan akun yang
dibuat Super Admin. Ikuti [Mulai Inventaris Internal](docs-site/docs/mulai-inventaris-internal.md)
untuk login, akun per unit, surat, impor, serta pencarian lokasi. Lampiran digital
dan proses berbukti file digunakan setelah fasilitasnya siap; panduan ini tidak
menyatakan seluruh fitur atau integrasi eksternal sudah operasional.

Perubahan alur harian, perlindungan formulir, dan pemeriksaan tampilan dijelaskan
dalam [hasil perbaikan UX](docs/HASIL_PERBAIKAN_UX_2026-09-11.md).

Pemeriksaan izin, nomor penelusuran gangguan, metrik administrator, serta
pemulihan unggahan dijelaskan dalam [panduan operasional backend](docs/OPERASIONAL_BACKEND.md).
Rincian perubahan, pengukuran lokal, dan batas pengujian ada di
[hasil penguatan backend](docs/HASIL_PENGUATAN_BACKEND_2026-09-11.md).

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

Akar repositori tidak memiliki perintah `npm start`/`npm run build` aplikasi;
`npm test` di akar menjalankan tes skrip operasional dan kontrak deployment.
Seed tester hanya untuk database uji.

## Operasional produksi

Produksi berjalan di Vercel (`simsa-frontend` dan `simsa-backend`), database
Neon PostgreSQL, dan Vercel Blob privat. Ikuti
[deployment Vercel dan Neon](docs/DEPLOY_VERCEL_NEON.md),
[runbook kredensial database](docs/RUNBOOK_KREDENSIAL_DATABASE.md), serta
[cadangan dan pemulihan](docs/OPERATIONS_RECOVERY.md).
Hasil pengujian lokal perlu dilengkapi uji layanan penyimpanan, antivirus,
backup/restore, akun, domain, dan penerimaan pengguna pada lingkungan tujuan.
