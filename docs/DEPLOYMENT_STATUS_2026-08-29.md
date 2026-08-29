# Status Deployment SIMSA — 29 Agustus 2026

## Keputusan

Status production saat verifikasi ini adalah **NO-GO**. Kode dapat dilanjutkan
ke review/CI dan deployment preview terisolasi, tetapi migrasi atau promosi
production belum aman. Tidak ada migrasi, seed, penggantian alias, atau
promosi Production yang dilakukan selama audit ini.

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
  test pada PostgreSQL 18 nyata. Seluruh job tersebut lulus pada kandidat
  hardening `fa8b137` melalui run push dan synthetic merge PR.
- Kandidat workflow backup memakai koneksi Neon langsung dengan TLS ketat,
  snapshot sumber tunggal, dump yang langsung dienkripsi, artifact beranggotakan
  file terenkripsi saja, serta job runner baru yang mengunduh, memulihkan, dan
  membandingkan bukti sumber–restore. Profil schema harus cocok persis dengan
  `0000`–`0020` atau `0000`–`0029`; run Production dengan dua secret resmi tetap
  wajib lulus sebelum migrasi.
- Migration forward `0021` sekarang fail-closed sebelum DDL jika pengguna aktif
  dengan role administratif tidak mempunyai account identity. Migration historis
  `0009` tetap immutable agar hash yang sudah tercatat di Production tidak
  menyimpang dari file repository.

## Bukti remote branch

- [PR #2](https://github.com/bayilaras/simsa-atrbpn/pull/2) telah keluar dari
  status draft dan siap untuk review independen dengan target `main`. Branch
  protection `main` strict/up-to-date, berlaku untuk admin, memerlukan satu
  approval independen, penyelesaian percakapan, approval setelah push terakhir,
  dan lima required checks. Force-push serta deletion dilarang.
- Environment GitHub `production-backup` dibatasi ke protected branch dan dua
  variable non-secret telah mengikat workflow ke direct host serta nama database
  Production yang diaudit. Nilainya sengaja tidak dicatat di repository.
- Commit `fa8b137` pada `codex/full-integration` lulus seluruh
  [SIMSA CI push](https://github.com/bayilaras/simsa-atrbpn/actions/runs/33255150798):
  lint/typecheck/build, audit dependency, 130 test frontend, 1.153 test backend,
  build/inspect image worker, validasi Compose/preflight digest, migrasi
  PostgreSQL 18, seed paralel idempoten, concurrency lock, dan ClamAV
  clean/EICAR/restart.
- [Preview backend](https://simsa-backend-fq89wrew0-bayilaras-projects.vercel.app)
  berstatus `Ready`. Pemeriksaan dengan bypass Deployment Protection yang sah
  membuktikan `/health` mengembalikan `200`/`applicationReady:false`, sedangkan
  `/ready` dan route bisnis mengembalikan `503 preview_not_provisioned`, seluruhnya
  `no-store`. Entrypoint tidak mengimpor aplikasi atau membaca kredensial
  Production generik sampai marker dan seluruh `PREVIEW_*` lengkap.
- [Preview frontend](https://simsa-frontend-8tywry4hf-bayilaras-projects.vercel.app)
  telah memakai `API_PROXY_ORIGIN` branch alias backend yang sesuai commit dan
  Automation Bypass yang hanya ada pada environment Preview frontend. Melalui
  origin frontend, `/health` mengembalikan `200` dan `/ready` mengembalikan
  fail-closed `503 preview_not_provisioned` tanpa redirect SSO dari backend.
  `VITE_API_URL` tetap kosong.
- [Preview dokumentasi](https://simsa-atrbpn-f6mbjvh3g-bayilaras-projects.vercel.app)
  berstatus `Ready`. Ketiga project Vercel untuk commit `fa8b137` berhasil
  dibangun; runtime tetap memakai Node `24.x` dan backend Lambda `nodejs24.x`.
- Synthetic merge PR pada SHA `b17629f` lulus kelima job required di
  [run 33255152073](https://github.com/bayilaras/simsa-atrbpn/actions/runs/33255152073).
  Log checkout mengonfirmasi `refs/pull/2/merge` dan SHA tersebut.
  Bukti ini adalah pre-merge; checks pada commit merge aktual tetap wajib
  diulang sebelum promosi.

## Blocker production

1. Workflow backup lama pada `main` telah dinonaktifkan karena memakai
   `NEON_DATABASE_URL` berhak tinggi dan pernah mengunggah dump terkompresi tanpa
   enkripsi. Environment GitHub `production-backup` sudah dibatasi ke protected
   branch dan identitas sumber non-secret sudah dikunci, tetapi
   `NEON_BACKUP_DATABASE_URL` untuk role read-only khusus dan
   `BACKUP_ENCRYPTION_PASSPHRASE` dari secret manager belum tersedia. Artifact
   terenkripsi dan restore drill independen karena itu belum terbukti.
2. Perubahan belum digabung ke `main`; CI branch dan synthetic merge sudah
   hijau, tetapi belum ada reviewer independen dan keduanya tidak menggantikan
   required checks pada commit merge aktual.
3. Database Production berada tepat pada 21 migration `0000`–`0020`. Temuan
   audit privat terkait secret historis dan rekonsiliasi identitas privileged
   masih terbuka; migration `0021` sengaja fail-closed sampai keduanya ditangani
   setelah backup terverifikasi. Rincian insiden aktif tidak disimpan dalam
   repository publik ini.
4. Kontrol akses dan backup independen bitstream Production belum lulus gate
   rilis. Store private baru, salinan terenkripsi, checksum, restore drill, dan
   migrasi tervalidasi wajib selesai sebelum Production aman; rincian inventory
   aktif disimpan pada bukti audit privat.
5. Environment Vercel backend masih mewariskan database/Blob Production ke
   Preview. Gate baru tidak memakai nilai generik itu selama kontrak
   `PREVIEW_*` belum lengkap. Proxy same-origin menggunakan branch alias yang
   sesuai commit dan bypass server-side Preview-only; respons tanpa redirect SSO
   sudah terbukti. Callback direct-upload berjalan server-to-server dan tidak
   melewati proxy frontend; backend menolak Preview tanpa
   `PREVIEW_VERCEL_BLOB_CALLBACK_URL` custom yang tidak terlindungi, tetapi origin,
   database, serta private Blob Preview belum disediakan dan alur
   upload–callback–lease–claim belum diuji nyata.
6. Worker antivirus belum memiliki host persisten. CI Linux sudah membangun dan
   memeriksa image worker serta menjalankan ClamAV clean/EICAR/restart. Docker
   Desktop pada mesin verifikasi memiliki binary, tetapi service daemon berhenti
   dan tidak dapat dijalankan tanpa hak administrator; Compose tidak tersedia
   dan WSL belum mempunyai distro. Bukti host Linux persisten tetap diperlukan.
7. Backend production masih versi lama: `/health` hidup, tetapi `/ready` 404 dan
   `/api/health` belum memuat kontrak dependency readiness baru.
8. `OCR_TESSDATA_PATH`, model `ind+eng`, domain institusi same-site, monitoring,
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
