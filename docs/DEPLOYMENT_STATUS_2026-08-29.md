# Status Deployment SIMSA — 29 Agustus 2026

## Keputusan

Status production saat verifikasi ini adalah **NO-GO**. Kode dapat dilanjutkan
ke review/CI dan deployment preview terisolasi, tetapi migrasi atau promosi
production belum aman.

BSrE/PSrE tetap di luar ruang lingkup. Profil inti tetap `internal` dan
SRIKANDI tetap nonaktif sampai kontrak resmi, sandbox, serta persetujuannya ada.

## Bukti yang sudah lulus

- Migrasi `0000`–`0027`, dua proses seed klasifikasi/JRA paralel plus rerun, dan
  concurrency lock diuji terhadap PostgreSQL 18 disposable.
- API lokal memakai driver PostgreSQL native dan melaporkan `/health` serta
  `/ready` sehat; CORS exact-origin lulus, origin asing/sibling Vercel ditolak,
  dan wildcard Preview telah dihapus.
- Compose empat service berhasil dirender dan divalidasi. Node/ClamAV dipatok
  digest, scanner tetap internal, FreshClam memperoleh egress terpisah, dan
  resource/log/shutdown limits diterapkan.
- CI telah diselaraskan ke Node 24, lint frontend menjadi blocking, image worker
  benar-benar dibangun/diperiksa, dan job backend menjalankan migrasi, seed
  paralel idempoten, serta concurrency test pada PostgreSQL 18 nyata.
- Workflow backup kini menolak secret kosong, mengenkripsi dump, memulihkannya
  ke database terisolasi dengan fail-fast, dan hanya mengunggah artifact yang
  lolos restore.

## Bukti remote branch

- Commit `02ce1ac` pada `codex/full-integration` lulus seluruh
  [SIMSA CI](https://github.com/bayilaras/simsa-atrbpn/actions/runs/33237018505):
  lint/typecheck/build, audit dependency, 107 test frontend, 1128 test backend,
  build/inspect image worker, migrasi PostgreSQL 18, seed paralel idempoten, dan
  concurrency lock.
- Vercel berhasil membangun Preview backend dan dokumentasi. Backend Preview
  sengaja gagal tertutup saat dipanggil (`/health` dan `/ready` mengembalikan
  500) karena callback Blob Preview publik belum dikonfigurasi. Frontend Preview
  juga sengaja ditolak saat kompilasi konfigurasi karena `API_PROXY_ORIGIN`
  terisolasi belum tersedia; tidak ada fallback ke API production.
- Log deployment menunjukkan project Vercel lama masih memilih Node 20.
  Seluruh package root kini mematok `engines.node` ke `24.x`; redeployment harus
  membuktikan build/function menggunakan Node 24 sebelum promosi.

## Blocker production

1. Sedikitnya sepuluh backup Neon terjadwal terakhir gagal; run terbaru yang
   diaudit adalah <https://github.com/bayilaras/simsa-atrbpn/actions/runs/33156207726>.
   Workflow yang diperbaiki sudah berada di branch, tetapi secret baru dan
   restore drill tetap belum dapat dibuktikan sebelum run manual yang sah.
2. Perubahan belum digabung ke `main`; CI branch `02ce1ac` sudah hijau, tetapi
   tidak menggantikan required checks pada commit final yang benar-benar akan
   dirilis.
3. Preview Vercel backend masih berbagi database/Blob dengan production.
   Frontend sekarang memakai proxy same-origin dan menolak Preview tanpa
   `API_PROXY_ORIGIN` terisolasi, branch alias yang tidak cocok, serta target
   backend production, tetapi resource Preview terpisah belum tersedia. Branch
   alias backend juga mengembalikan redirect SSO karena Deployment Protection;
   routing frontend sudah mendukung bypass server-side, tetapi secret
   `BACKEND_VERCEL_PROTECTION_BYPASS` belum diprovisikan dan alur end-to-end
   belum dapat dibuktikan. Callback direct-upload Vercel Blob juga berjalan
   server-to-server dan tidak melewati proxy frontend; backend sekarang menolak
   Preview tanpa `VERCEL_BLOB_CALLBACK_URL` custom yang tidak terlindungi, tetapi
   origin tersebut belum disediakan dan alur callback/lease belum diuji nyata.
   Bukti remote mengonfirmasi guard frontend dan backend gagal tertutup ketika
   dua prasyarat ini tidak ada.
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
   `VERCEL_BLOB_CALLBACK_URL`, dan buktikan direct upload → callback bertanda
   tangan → lease `pending` → claim transaksi secara end-to-end.
4. Sediakan host Linux/VM persisten untuk Compose, isi `.env` dari secret
   manager, uji ClamAV clean/EICAR/failure/restart, dan verifikasi heartbeat.
5. Setelah backup production terverifikasi, jalankan `npm run db:migrate` dan
   `npm run seed:all` dalam maintenance window; jangan gunakan `db:push`.
6. Deploy backend tanpa alias, uji `/health` dan `/ready`, lalu promote. Ulangi
   untuk frontend dan dokumentasi; simpan URL/commit/artifact serta bukti
   rollback.
