# SIMSA Frontend

Frontend SIMSA untuk Ditjen Pengadaan Tanah dan Pengembangan Pertanahan. Profil build default adalah `internal`, dengan branding **SIMSA Internal Ditjen PTPP** dan penanda **Penggunaan Internal**.

## Menjalankan lokal

```bash
npm install
copy .env.example .env.local
npm run dev
```

Konfigurasi build utama:

```dotenv
VITE_API_URL=http://localhost:3001
VITE_APP_PROFILE=internal
VITE_FEATURE_SRIKANDI=false
```

- `VITE_APP_PROFILE` menerima `internal` atau `integrated`. Nilai kosong/tidak dikenal kembali ke `internal`.
- `VITE_FEATURE_SRIKANDI` default `false`. Menu dan route SRIKANDI hanya tersedia jika profil build `integrated`, flag bernilai `true`, dan metadata `/api/health` mengonfirmasi backend `integrated` dengan connector aktif. Kegagalan verifikasi menyembunyikan fitur.
- Profil frontend dan backend harus sama pada deployment terintegrasi. Menampilkan menu bukan pengganti autentikasi, otorisasi role, dan kontrol akses API.

## Deployment production

Biarkan `VITE_API_URL` tidak disetel pada seluruh build production. Host frontend
wajib menyediakan reverse proxy same-origin untuk `/api`, `/health`, `/ready`,
dan `/uploads` agar cookie sesi, CSRF, probe readiness, serta token upload
bekerja. Pada Vercel,
tetapkan `API_PROXY_ORIGIN` sebagai environment server-side:

- Production boleh memakai default `https://simsa-backend.vercel.app` atau origin
  backend institusi yang eksplisit.
- Preview wajib memakai backend HTTPS terisolasi. Jika `API_PROXY_ORIGIN` belum
  ada, deployment tetap berhasil tetapi hanya melayani halaman pemeliharaan dan
  respons `503 preview_not_provisioned`; tidak ada fallback ke Production. Untuk
  mode ini build khusus hanya menghasilkan shell/status dan service worker
  pembersih cache lama, bukan bundle aplikasi penuh. Untuk
  project Vercel SIMSA yang sudah diprovisikan,
  gunakan branch alias `simsa-backend-git-...` yang cocok dengan
  `VERCEL_GIT_COMMIT_REF` frontend; konfigurasi menolak branch Production,
  alias branch lain, dan URL deployment yang environment-nya ambigu.
- Preview backend SIMSA saat ini memakai Vercel Deployment Protection. Buat
  Automation Bypass pada project backend, lalu simpan nilainya pada environment
  **Preview frontend** sebagai `BACKEND_VERCEL_PROTECTION_BYPASS`. Rewrite
  mengirim `x-vercel-protection-bypass` di routing layer; nilai secret tidak
  masuk JavaScript/browser. Jangan gunakan prefiks `VITE_`, jangan commit nilai,
  dan rotasi secret jika pernah terekspos.

Aktifkan Vercel System Environment Variables agar `VERCEL_ENV` dan
`VERCEL_GIT_COMMIT_REF` tersedia saat build. Jika referensi Git tidak tersedia,
target backend alias Vercel pada Preview ditolak secara fail-closed.

Database, Blob token/store, OAuth callback, serta secret backend Preview juga
wajib terpisah dari Production. Guard routing tidak dapat membuktikan isi
resource backend, sehingga entrypoint backend menolak mengimpor aplikasi sampai
`SIMSA_PREVIEW_ENABLED=true` dan seluruh kredensial `PREVIEW_*` yang tercantum di
`backend/.env.example` tersedia. Nilai tersebut baru dipetakan ke nama runtime
setelah kontrak lengkap; variabel Production generik yang diwariskan tidak
dipakai oleh Preview yang belum siap. Entrypoint juga menghapus konfigurasi
SMTP/reconciliation Production yang tidak mempunyai pasangan `PREVIEW_*` dan
memaksa API Preview ke mode antivirus internal quarantine-only tanpa host atau
jadwal worker Production. Direct-upload Blob memiliki callback server-to-server yang tidak
melewati proxy frontend; backend Preview wajib diberi
`PREVIEW_VERCEL_BLOB_CALLBACK_URL` custom yang tidak terkena Deployment Protection dan
alur callback/lease harus diuji dengan upload nyata.

Platform static-hosting selain Vercel harus menyediakan aturan reverse proxy
yang ekuivalen. Menetapkan `VITE_API_URL` ke origin backend lain bukan pengganti
proxy dan sengaja ditolak oleh build production.

## Verifikasi

```bash
npm test
npm run lint:profile
npm run build
```

`npm run lint` memeriksa seluruh source tree dan menjadi gate CI. `lint:profile`
tetap tersedia untuk pemeriksaan cepat modul profil internal.
