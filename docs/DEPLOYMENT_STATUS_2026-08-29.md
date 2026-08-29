# Status Deployment SIMSA — 29 Agustus 2026

## Keputusan

Status production saat verifikasi ini adalah **NO-GO**. Kode dapat dilanjutkan
ke review/CI dan deployment preview terisolasi, tetapi migrasi atau promosi
production belum aman.

BSrE/PSrE tetap di luar ruang lingkup. Profil inti tetap `internal` dan
SRIKANDI tetap nonaktif sampai kontrak resmi, sandbox, serta persetujuannya ada.

## Bukti yang sudah lulus

- Migrasi `0000`–`0029`, dua proses seed klasifikasi/JRA paralel plus rerun, dan
  concurrency lock diuji terhadap PostgreSQL 18 disposable. Migrasi `0029`
  membuktikan rekod surat keluar lama tetap `NULL`/efektif Terbatas, sedangkan
  rekod baru memperoleh klasifikasi eksplisit `biasa` dan constraint nilai.
- API lokal memakai driver PostgreSQL native dan melaporkan `/health` serta
  `/ready` sehat dengan kontrak 30 migrasi/kolom/constraint terbaru; CORS
  exact-origin lulus, origin asing/sibling Vercel ditolak, dan wildcard Preview
  telah dihapus.
- Pengujian lokal Node 24 lulus: 101 file/1.153 test backend, 27 file/130 test
  frontend, typecheck, lint, build backend/frontend/dokumentasi, serta 2 test
  concurrency PostgreSQL nyata. Audit lulus pada ambang CI: backend tanpa
  high/critical, frontend tanpa kerentanan, dan dokumentasi tanpa critical.
- E2E browser + PostgreSQL membuktikan alur surat masuk dan surat keluar dari
  pembuatan, maker-checker oleh dua akun berbeda, persetujuan, pencarian kode
  klasifikasi exact-match, pemilihan JRA, sampai registrasi di daftar arsip.
  Penyapuan 29 rute utama menghasilkan HTTP 200 tanpa 5xx, page error, console
  error, atau halaman fatal.
- Compose empat service berhasil dirender dan divalidasi. Node/ClamAV dipatok
  digest, scanner tetap internal, FreshClam memperoleh egress terpisah, dan
  resource/log/shutdown limits diterapkan. Preflight menerima hanya referensi
  image immutable `@sha256` dan menolak tag mutable.
- CI telah diselaraskan ke Node 24, lint frontend menjadi blocking, image worker
  benar-benar dibangun/diperiksa, job ClamAV menjalankan clean/EICAR/restart,
  dan job backend menjalankan migrasi, seed paralel idempoten, serta concurrency
  test pada PostgreSQL 18 nyata. Seluruh job tersebut lulus pada commit
  implementasi `d88b176`.
- Workflow backup kini menolak secret kosong, mengalirkan dump langsung ke
  enkripsi, memulihkannya ke database terisolasi dengan fail-fast, dan hanya
  mengunggah artifact yang lolos restore. Drill lokal nyata lulus dengan 58
  tabel, 30 migrasi, dan 486 entri TOC tanpa dump plaintext; run Production
  dengan secret resmi tetap wajib dibuktikan terpisah.

## Bukti remote branch

- Commit `d88b176` pada `codex/full-integration` lulus seluruh
  [SIMSA CI](https://github.com/bayilaras/simsa-atrbpn/actions/runs/33242350291):
  lint/typecheck/build, audit dependency, 130 test frontend, 1.153 test backend,
  build/inspect image worker, validasi Compose/preflight digest, migrasi
  PostgreSQL 18, seed paralel idempoten, concurrency lock, dan ClamAV
  clean/EICAR/restart.
- [Preview backend](https://simsa-backend-6ecbh83y8-bayilaras-projects.vercel.app)
  berstatus `Ready`. Pemeriksaan dengan bypass Deployment Protection yang sah
  membuktikan `/health` mengembalikan `200`/`applicationReady:false`, sedangkan
  `/ready` dan route bisnis mengembalikan `503 preview_not_provisioned`, seluruhnya
  `no-store`. Entrypoint tidak mengimpor aplikasi atau membaca kredensial
  Production generik sampai marker dan seluruh `PREVIEW_*` lengkap.
- [Preview frontend](https://simsa-frontend-3ga82wmb8-bayilaras-projects.vercel.app)
  berstatus `Ready` dan, karena `API_PROXY_ORIGIN` terisolasi belum tersedia,
  sengaja hanya menyajikan shell pemeliharaan HTML serta respons API JSON
  `503 preview_not_provisioned`. Build ini tidak memuat bundle SPA Production,
  menggunakan `no-store`, dan membersihkan cache deployment lama melalui
  service worker kecil.
- [Preview dokumentasi](https://simsa-atrbpn-4li12c05a-bayilaras-projects.vercel.app)
  berstatus `Ready` dan mengembalikan halaman Docusaurus `200`. Ketiga project
  Vercel menggunakan Node `24.x`; backend Lambda memakai `nodejs24.x`.

## Blocker production

1. Sedikitnya sepuluh backup Neon terjadwal terakhir gagal; run terbaru yang
   diaudit adalah <https://github.com/bayilaras/simsa-atrbpn/actions/runs/33156207726>.
   Workflow yang diperbaiki sudah berada di branch, tetapi secret baru dan
   restore drill tetap belum dapat dibuktikan sebelum run manual yang sah.
2. Perubahan belum digabung ke `main`; CI branch commit implementasi `d88b176`
   sudah hijau, tetapi tidak menggantikan review dan required checks pada merge
   commit yang benar-benar akan dirilis.
3. Environment Vercel backend masih mewariskan database/Blob Production ke
   Preview. Gate baru tidak memakai nilai generik itu selama kontrak
   `PREVIEW_*` belum lengkap. Frontend memakai proxy same-origin setelah
   `API_PROXY_ORIGIN` terisolasi tersedia; sebelum itu hanya shell `503` yang
   dilayani. Perilaku fail-closed remote tersebut sudah terbukti. Branch alias
   backend mengembalikan redirect SSO karena Deployment Protection; routing
   frontend sudah mendukung bypass server-side, tetapi secret
   `BACKEND_VERCEL_PROTECTION_BYPASS` belum diprovisikan dan alur end-to-end
   belum dapat dibuktikan. Callback direct-upload Vercel Blob juga berjalan
   server-to-server dan tidak melewati proxy frontend; backend sekarang menolak
   Preview tanpa `PREVIEW_VERCEL_BLOB_CALLBACK_URL` custom yang tidak
   terlindungi, tetapi origin tersebut belum disediakan dan alur callback/lease
   belum diuji nyata.
4. Worker antivirus belum memiliki host persisten. CI Linux sudah membangun dan
   memeriksa image worker serta menjalankan ClamAV clean/EICAR/restart. Docker
   Desktop pada mesin verifikasi adalah instalasi parsial: binary ada, daemon
   tidak aktif, registry instalasi hilang, dan Compose hanya dapat dipanggil
   melalui plugin langsung.
   Repair/reinstall membutuhkan keputusan administrator dan penerimaan lisensi
   oleh pihak yang berwenang; itu tidak dilakukan otomatis.
5. Backend production masih versi lama: `/health` hidup, tetapi `/ready` 404 dan
   `/api/health` belum memuat kontrak dependency readiness baru.
6. `OCR_TESSDATA_PATH`, model `ind+eng`, domain institusi same-site, monitoring,
   backup bitstream, rotasi kredensial lama, dan persetujuan operasional belum
   mempunyai bukti lengkap.

## Urutan aman berikutnya

1. Selesaikan review PR dan ulangi required checks pada merge commit sebelum
   promosi apa pun ke Production.
2. Konfigurasi dua secret backup, jalankan workflow manual, unduh artifact
   terenkripsi, dan lakukan restore drill independen.
3. Sediakan database dan private Blob Preview terpisah; biarkan
   `VITE_API_URL` kosong pada Vercel dan tetapkan `API_PROXY_ORIGIN` Preview ke
   branch alias backend terisolasi yang cocok dengan `VERCEL_GIT_COMMIT_REF`.
   Buat Automation Bypass backend, simpan secret hanya pada environment Preview
   frontend sebagai `BACKEND_VERCEL_PROTECTION_BYPASS`, lalu uji API melalui
   origin frontend tanpa redirect SSO. Sediakan pula custom HTTPS callback
   backend Preview yang tidak terkena Deployment Protection, set
   `PREVIEW_VERCEL_BLOB_CALLBACK_URL`, lalu set `SIMSA_PREVIEW_ENABLED=true`
   hanya setelah seluruh `PREVIEW_*` lengkap, dan buktikan direct upload → callback bertanda
   tangan → lease `pending` → claim transaksi secara end-to-end.
4. Sediakan host Linux/VM persisten untuk Compose, isi `.env` dari secret
   manager, uji ClamAV clean/EICAR/failure/restart, dan verifikasi heartbeat.
5. Setelah backup production terverifikasi, jalankan `npm run db:migrate` dan
   `npm run seed:all` dalam maintenance window; jangan gunakan `db:push`.
6. Deploy backend tanpa alias, uji `/health` dan `/ready`, lalu promote. Ulangi
   untuk frontend dan dokumentasi; simpan URL/commit/artifact serta bukti
   rollback.
