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

## Verifikasi

```bash
npm test
npm run lint:profile
npm run build
```

`npm run lint` tetap tersedia untuk audit seluruh source tree. Baseline lama masih memuat temuan pada file generated/legacy yang tidak terkait profil aplikasi; `lint:profile` memeriksa seluruh modul yang disentuh oleh perubahan profil internal.
