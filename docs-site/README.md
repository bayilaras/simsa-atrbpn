# Situs panduan SIMSA

Situs Docusaurus untuk panduan pengguna. Gunakan Node 24 dan npm:

```sh
npm ci          # pasang dependensi sesuai lockfile
npm start       # server pengembangan lokal
npm run build   # hasil statis di build/
```

Halaman ada di `docs/` dan urutannya di `sidebars.js`. Konfigurasi Vercel
untuk proyek `simsa-atrbpn` ada di `vercel.json` (akar repositori) dan
`docs-site/vercel.json`; keduanya mematikan deploy otomatis dari `main`,
jadi publikasi dilakukan manual.
