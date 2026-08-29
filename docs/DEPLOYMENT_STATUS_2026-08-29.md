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
  test pada PostgreSQL 18 nyata. Bukti run commit final masih menunggu push.
- Workflow backup kini menolak secret kosong, mengalirkan dump langsung ke
  enkripsi, memulihkannya ke database terisolasi dengan fail-fast, dan hanya
  mengunggah artifact yang lolos restore. Drill lokal nyata lulus dengan 58
  tabel, 30 migrasi, dan 486 entri TOC tanpa dump plaintext; run Production
  dengan secret resmi tetap wajib dibuktikan terpisah.

## Bukti remote branch

- Commit `02ce1ac` pada `codex/full-integration` lulus seluruh
  [SIMSA CI](https://github.com/bayilaras/simsa-atrbpn/actions/runs/33237018505):
  lint/typecheck/build, audit dependency, 107 test frontend, 1128 test backend,
  build/inspect image worker, migrasi PostgreSQL 18, seed paralel idempoten, dan
  concurrency lock.
- Vercel berhasil membangun Preview backend. Bukti remote sebelum gate Preview
  menunjukkan `/health` dan `/ready` mengembalikan 500 karena resource belum
  diprovisikan. Entrypoint sekarang tidak mengimpor aplikasi atau membaca
  kredensial Production generik sampai marker dan seluruh `PREVIEW_*` lengkap;
  keadaan belum siap melayani `/health` hidup dan
  `503 preview_not_provisioned` untuk readiness/route bisnis. Frontend tanpa
  `API_PROXY_ORIGIN` sekarang membangun shell pemeliharaan `503` tanpa fallback
  ke API Production. Build maintenance tidak memuat bundle SPA dan menyediakan
  service worker kecil untuk membuang cache deployment lama. Setelah gate
  aktif, API Preview tetap quarantine-only dan
  tidak mewarisi host/jadwal scanner Production; SMTP, TTL lease, dan batch
  reconciliation memakai pasangan `PREVIEW_*` atau default aman. Proxy
  same-origin juga meneruskan `/ready`, bukan menyajikan SPA 200 palsu.
  Perilaku remote baru harus dibuktikan pada redeployment.
- Project dokumentasi root semula menghasilkan nol output. Redeployment commit
  `4421bf5` sekarang berstatus `Ready`, membangun Docusaurus dari `docs-site`,
  dan asset halaman panduan dapat diambil dari URL Preview branch.
- Log deployment pertama menunjukkan project Vercel lama masih memilih Node 20.
  Seluruh package root kemudian dipatok ke `engines.node` `24.x`; metadata
  redeployment backend `46f4207` membuktikan build memakai Node `24.x` dan
  Lambda memakai `nodejs24.x`. Project settings frontend dan dokumentasi juga
  sudah menunjukkan Node `24.x`; shell Preview belum terprovision yang baru
  tetap perlu dibuktikan pada redeployment berikutnya.

## Blocker production

1. Sedikitnya sepuluh backup Neon terjadwal terakhir gagal; run terbaru yang
   diaudit adalah <https://github.com/bayilaras/simsa-atrbpn/actions/runs/33156207726>.
   Workflow yang diperbaiki sudah berada di branch, tetapi secret baru dan
   restore drill tetap belum dapat dibuktikan sebelum run manual yang sah.
2. Perubahan belum digabung ke `main`; CI branch `02ce1ac` sudah hijau, tetapi
   tidak menggantikan required checks pada commit final yang benar-benar akan
   dirilis.
3. Environment Vercel backend masih mewariskan database/Blob Production ke
   Preview. Gate baru tidak memakai nilai generik itu selama kontrak
   `PREVIEW_*` belum lengkap. Frontend memakai proxy same-origin setelah
   `API_PROXY_ORIGIN` terisolasi tersedia; sebelum itu hanya shell `503` yang
   dilayani. Branch
   alias backend juga mengembalikan redirect SSO karena Deployment Protection;
   routing frontend sudah mendukung bypass server-side, tetapi secret
   `BACKEND_VERCEL_PROTECTION_BYPASS` belum diprovisikan dan alur end-to-end
   belum dapat dibuktikan. Callback direct-upload Vercel Blob juga berjalan
   server-to-server dan tidak melewati proxy frontend; backend sekarang menolak
   Preview tanpa `PREVIEW_VERCEL_BLOB_CALLBACK_URL` custom yang tidak
   terlindungi, tetapi origin tersebut belum disediakan dan alur callback/lease
   belum diuji nyata.
4. Worker antivirus belum memiliki host persisten. Docker Desktop pada mesin
   verifikasi adalah instalasi parsial: binary ada, daemon tidak aktif, registry
   instalasi hilang, dan Compose hanya dapat dipanggil melalui plugin langsung.
   Repair/reinstall membutuhkan keputusan administrator dan penerimaan lisensi
   oleh pihak yang berwenang; itu tidak dilakukan otomatis.
5. Backend production masih versi lama: `/health` hidup, tetapi `/ready` 404 dan
   `/api/health` belum memuat kontrak dependency readiness baru.
6. `OCR_TESSDATA_PATH`, model `ind+eng`, domain institusi same-site, monitoring,
   backup bitstream, rotasi kredensial lama, dan persetujuan operasional belum
   mempunyai bukti lengkap.

## Urutan aman berikutnya

1. Pastikan CI branch hijau, selesaikan review PR, dan ulangi required checks
   pada commit final sebelum merge.
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
