# Runbook kredensial database dan rilis SIMSA

Runbook ini mengatur di mana setiap kredensial produksi disimpan, cara memakainya saat rilis, cara merotasinya tanpa (atau dengan jeda sesingkat mungkin) gangguan layanan, dan cara memverifikasinya. Alat yang dipakai ada di `scripts/ops/`. Alat itu menggantikan helper yang sebelumnya disimpan di luar repository, di folder rilis (`rilis-neon.ps1`, `diag-neon.mjs`, `rotasi-migrasi.mjs`, `make-manifest.py`). Status per 1 November 2026: produksi backend C66 dan frontend C62 dari `main` `93dbe98`, dengan journal 54 migrasi.

Aturan dasar:

- **Rahasia hanya diketik di dua tempat:** prompt tersembunyi `scripts/ops/rilis-neon.ps1`, atau kolom secret di GitHub/Vercel. Jangan pernah menaruhnya di chat, tiket, argumen perintah, berkas, tangkapan layar, atau laporan rilis.
- **Sumber kebenaran operator adalah password manager.** Setiap entri berisi username, password, dan connection string lengkap. Dengan begitu, nilai untuk secret GitHub dapat langsung disalin dari password manager tanpa disusun di editor teks.
- **Repository ini publik.** Jangan menambahkan host lengkap, ID project, atau nilai lain yang tidak perlu ke dokumen. Nilai non-rahasia disimpan sebagai variabel GitHub.

## Penyiapan manual (README)

Repository tidak dapat menyiapkan hal-hal berikut sendiri. Lakukan sekali, dengan urutan seperti di bawah.

1. **Password manager.** Buat entri terpisah, masing-masing dengan connection string lengkap untuk endpoint direct dan `sslmode=verify-full`:
   - `SIMSA Neon neondb_owner`: password pemilik database dari Neon Console.
   - `SIMSA Neon simsa_backup`: diisi saat rotasi `simsa_backup` (lihat [celah 1](#celah-yang-diketahui)).
   - `SIMSA Neon simsa_api`: opsional, diisi pada rotasi `simsa_api` berikutnya. Entri ini dibutuhkan untuk `verify-runtime`.
   - `SIMSA Neon simsa_migration`: hanya bila tidak memakai `rotate-migrate` (lihat [simsa_migration](#simsa_migration)).
   - `SIMSA Vercel token rilis GitHub`: hanya metadata (tanggal kedaluwarsa). Tokennya sendiri cukup disimpan di GitHub.
2. **Workstation operator.** Node.js 24 (mis. `output/local-runtime/node-v24.21.0-win-x64/node.exe`, diberikan ke parameter `-Node`) dan, untuk backup lokal, PostgreSQL 18 (`pg_dump`). Isi variabel non-rahasia berikut di profil PowerShell agar tidak perlu diketik ulang:
   ```powershell
   $env:SIMSA_NEON_HOST = '<nilai variabel GitHub NEON_BACKUP_EXPECTED_HOST>'
   $env:SIMSA_NEON_DATABASE = '<nilai variabel GitHub NEON_BACKUP_EXPECTED_DATABASE>'
   ```
3. **Token Vercel untuk GitHub.** Buka Vercel → Account Settings → Tokens. Buat token `simsa-github-release` dengan scope tim SIMSA (`bayilaras-projects`) dan masa berlaku 90 hari. Catat tanggal kedaluwarsanya. Token Vercel tidak dapat dibatasi per project, jadi perlakukan token ini setara akses penuh ke tim.
4. **GitHub → Settings → Environments.** Buat environment **sebelum** mengaktifkan workflow. GitHub membuat environment yang belum ada secara otomatis **tanpa** aturan proteksi saat workflow pertama kali berjalan.
   - `production-candidate`: Deployment branches = hanya `main`. Secret: `VERCEL_TOKEN`. **Karena `VERCEL_TOKEN` berlaku untuk seluruh tim (termasuk mempromosikan dan mengubah env), environment ini wajib tetap dibatasi ke `main`.** Hanya kode yang sudah lolos review yang boleh memegang token ini. Secret opsional (Vercel project → Settings → Deployment Protection → Protection Bypass for Automation): `VERCEL_BACKEND_BYPASS_SECRET` dan `VERCEL_FRONTEND_BYPASS_SECRET`. Tanpa keduanya, smoke kandidat dilewati dengan peringatan di ringkasan run. Pemeriksaan HTTP pertama lalu baru terjadi setelah promosi, dan kegagalannya memicu rollback otomatis.
   - `production`: **Required reviewers** minimal satu orang yang bukan pemicu rilis (mis. efanwahyu atau Kasubbag TU). Aktifkan *Prevent self-review* dan batasi deployment branches ke `main`. Secret: `VERCEL_TOKEN` (token yang sama) dan `OPERATIONS_MONITOR_TOKEN` (nilai yang sama dengan environment `production-monitor`).
5. **GitHub → Settings → Variables (repository).** `VERCEL_ORG_ID` (Team ID), `VERCEL_BACKEND_PROJECT_ID`, dan `VERCEL_FRONTEND_PROJECT_ID`. Nilainya ada di Vercel → Settings → General, atau di `.vercel/project.json` folder rilis lama. Terakhir, setel `RELEASE_VERCEL_ENABLED` = `true`.
6. **Uji coba kering.** Jalankan workflow pada `main` HEAD yang sudah dirilis. Biarkan kedua kandidat selesai dibangun, lalu **tolak** (Reject) persetujuan `production`. Langkah ini membuktikan gate, manifest, deploy CLI, dan pemeriksaan kandidat tanpa menyentuh alias produksi. Kandidat yang tidak dipromosikan boleh dibiarkan atau dihapus dari Vercel.

## Peran database

Semua login `simsa_*` dibuat dengan SQL oleh pemilik database: `bootstrap` di `scripts/neon-database.mjs`, serta `provision` di `scripts/neon-backup.mjs` dan `scripts/neon-worker.mjs`. **Neon Console tidak dapat me-reset role yang dibuat lewat SQL.** Rotasinya selalu memakai `ALTER ROLE` oleh pemilik database yang membuatnya. Sejak PostgreSQL 16, pemilik itu memegang ADMIN OPTION atas role buatannya. Helper hanya mengirim verifier SCRAM-SHA-256, sehingga password tidak pernah sampai ke server. Verifier itu sendiri dapat tercatat di log statement dan `pg_stat_statements`. Karena itu, password baru harus acak dan panjang, agar tidak dapat ditebak offline dari verifier.

| Role login | Peran kebijakan (NOLOGIN) | Dipakai oleh | Lokasi kredensial | Rotasi |
|---|---|---|---|---|
| `neondb_owner` | pemilik database, `CREATEROLE` | operator: rotasi dan bootstrap | password manager saja; **tidak pernah** di GitHub/Vercel | Neon Console → Roles & Databases → Reset password |
| `simsa_migration` | `simsa_migrator` (pemilik schema) | migrasi saat rilis | tidak disimpan (`rotate-migrate`) atau password manager | `rotate-migrate` setiap rilis, atau `rotate-role` |
| `simsa_api` | `simsa_api_runtime` | runtime backend | Vercel `simsa-backend` Production `DATABASE_URL`; opsional password manager | `rotate-role` + kandidat + promosi |
| `simsa_worker` | `simsa_worker_runtime` | pemindai malware, fixity | Vercel `MALWARE_WORKER_DATABASE_URL`; GitHub `NEON_WORKER_DATABASE_URL` (env `production-integrity`) | `rotate-role` + kandidat + promosi + secret |
| `simsa_backup` | `simsa_backup_reader` (baca saja) | `operations-recovery.yml` harian, backup lokal | GitHub `NEON_BACKUP_DATABASE_URL` (env `production-recovery`); password manager | `rotate-role` + secret |
| `simsa_operator` | `simsa_maintenance` | tidak dipakai layanan | password manager atau tidak disimpan | `rotate-role` bila diperlukan |

Peran kebijakan `simsa_api_runtime`, `simsa_event_runtime`, `simsa_worker_runtime`, `simsa_final_cleanup`, `simsa_maintenance`, `simsa_migrator`, dan `simsa_backup_reader` tidak dapat login dan tidak memiliki kredensial. Batasnya diperiksa oleh `assertNeonRoleBoundaries` setiap kali `migrate` atau `verify-runtime` berjalan.

Backup terjadwal berjalan lewat `.github/workflows/operations-recovery.yml` (env `production-recovery`). Workflow lama `backup-neon.yml` sudah dihapus dari repository; salinan `NEON_BACKUP_DATABASE_URL` di env lama `production-backup` sudah basi dan sebaiknya dihapus.

Kredensial non-database yang ikut menentukan rilis:

| Nama | Lokasi | Catatan |
|---|---|---|
| `VERCEL_TOKEN` | GitHub env `production-candidate`, `production` | rotasi: buat token baru, ganti di dua env, hapus token lama |
| `OPERATIONS_MONITOR_TOKEN` | Vercel backend; GitHub env `production-monitor`, `production` | perubahan di Vercel baru berlaku setelah deployment baru |
| `SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN` | Vercel backend; GitHub env `production-recovery`, `production-integrity` | |
| `BACKUP_ENCRYPTION_PASSPHRASE` | GitHub env `production-recovery`; **salinan offline di password manager** | tanpa nilai ini arsip backup tidak dapat dibuka |
| `BETTER_AUTH_SECRET`, `MALWARE_SCAN_DISPATCH_TOKEN`, `CRON_SECRET`, `GOOGLE_CLIENT_SECRET` | Vercel backend Production | di luar cakupan runbook ini |

## Alat di `scripts/ops/`

| Berkas | Fungsi |
|---|---|
| `rilis-neon.ps1` | Prompt tersembunyi (`Read-Host -AsSecureString`) lalu `rilis-neon.mjs`. Aksi: `backup`, `diag-backup`, `migrate`, `verify-runtime`, `rotate-migrate`, `rotate-role` |
| `rilis-neon.mjs` | Memvalidasi aksi dan pin target, mengambil kredensial dari env lalu langsung menghapusnya, dan menjalankan helper resmi dari `-Checkout` dengan tepat satu URL kanonik |
| `neon-credential.mjs` | Menerima password **atau** connection string utuh. Role, host (direct atau `-pooler`), dan database harus cocok. Hanya password yang dipakai, dan koneksi selalu ke endpoint direct dengan `verify-full` + channel binding |
| `neon-role-rotation.mjs` | Verifier SCRAM-SHA-256 (diuji dengan vektor RFC 7677 dan PostgreSQL nyata) serta `ALTER ROLE` untuk role yang ada di daftar izin |
| `diag-neon-backup.mjs` | Langkah `neon-backup.mjs create` dengan galat tersaring; tidak menulis bundle atau kunci |
| `release-source.mjs` | `git archive` + manifest (`prepare`), ekstraksi dengan cek hash (`extract`), dan cek ulang (`verify`) |
| `vercel-release.mjs` | Pemeriksaan REST Vercel baca-saja: status kandidat, alias aktif, dan alias setelah promosi |
| `release-smoke.mjs` | Smoke HTTP tanpa sesi seperti di laporan rilis: `/health`, `/ready`, 401 rute terlindungi, shell SPA, bundel, dan proxy |

Contoh pemakaian (dari akar repository, dengan `SIMSA_NEON_HOST`/`SIMSA_NEON_DATABASE` sudah terisi):

```powershell
$node = (Resolve-Path 'output/local-runtime/node-v24.21.0-win-x64/node.exe').Path
.\scripts\ops\rilis-neon.ps1 -Action migrate -Checkout ..\simsa-rilis-c57\source -Node $node
.\scripts\ops\rilis-neon.ps1 -Action rotate-role -Role simsa_backup -Node $node
.\scripts\ops\rilis-neon.ps1 -Action diag-backup -Checkout ..\simsa-rilis-c56\source -Node $node
```

Saat prompt muncul, tempel password **atau** connection string dari password manager. Pesan `Connection string untuk role 'x', bukan 'y'` atau `untuk host lain` berarti entri yang ditempel salah. Tidak ada yang dikirim ke server dalam kasus itu. Kode `28P01` dari server berarti password ditolak. Endpoint Neon yang tidak dikenal **juga** menghasilkan `28P01`, jadi periksa pin host lebih dulu.

`-Checkout` menunjuk sumber beku rilis. Contohnya: `source/` hasil `release-source.mjs`, atau checkout lama untuk backup dari rantai migrasi lama. Helper resmi (`neon-database.mjs`, `neon-backup.mjs`) diambil dari folder itu karena manifest backup mengikat hash helper dan journal migrasi.

Sumber hasil `git archive` tidak memuat `node_modules`, padahal semua helper memuat `pg` dari `backend` checkout itu. Urutannya:

1. `node scripts/ops/release-source.mjs verify --dir <folder-rilis>` (selagi manifest masih utuh);
2. `npm ci --prefix <folder-rilis>\source\backend --ignore-scripts`;
3. baru jalankan `rilis-neon.ps1`.

Wrapper memeriksa dependensi ini **sebelum** prompt muncul dan mencetak perintah `npm ci` yang tepat bila belum terpasang. Setelah `npm ci`, `verify` akan melaporkan berkas tambahan; itu memang diharapkan.

## Prosedur rilis

1. **Pra-cek.** PR sudah di-merge ke `main` dan kelima check wajib hijau pada commit merge. Run `operations-recovery.yml` terakhir sukses. Produksi sehat (Operations Monitor).
2. **Bila rilis memuat migrasi.** Merge ke `main` membuat backup harian gagal sampai migrasi diterapkan, karena rantai journal berbeda. Ini sudah diperkirakan. Sebelum migrasi:
   - buat branch Neon `pra-00xx-<tanggal>` dari branch produksi (Neon Console → Branches);
   - pastikan backup terakhir dari rantai lama ada.
3. **Migrasi** dari sumber beku rilis, setelah `npm ci --prefix <source>\backend --ignore-scripts` (lihat [alat](#alat-di-scriptsops)). Ada dua pilihan:
   - `rilis-neon.ps1 -Action rotate-migrate -Checkout <source>`: memakai kredensial `neondb_owner`, merotasi `simsa_migration` ke password acak sekali pakai, lalu menjalankan `migrate --apply`. Ini alur yang dipakai pada rilis 0051.
   - `rilis-neon.ps1 -Action migrate -Checkout <source>`: memakai `simsa_migration` dari password manager.
4. **Backup pasca-migrasi.** Jalankan `operations-recovery.yml` secara manual (workflow_dispatch) dan pastikan sukses.
5. **Verifikasi runtime.** Jalankan `rilis-neon.ps1 -Action verify-runtime` (memakai `simsa_api`). Bila `simsa_api` tidak tersedia ([celah 2](#celah-yang-diketahui)), andalkan `/ready`, smoke, dan Operations Monitor setelah promosi.
6. **Deploy dan promosi** lewat GitHub Actions → *Release SIMSA to Vercel (manual, approved)* → Run workflow dari `main`, dengan input:
   - `commit_sha`: SHA penuh `main` HEAD (harus commit merge PR);
   - `release_label`: mis. `C57 backend + C54 frontend`;
   - `components`: `both`, `backend`, atau `frontend`;
   - `database_migrations`: jumlah migrasi yang **sudah** diterapkan di produksi. Workflow menolak bila jumlahnya berbeda dari journal rilis.

   Workflow menjalankan langkah berikut:
   1. `source`: gate `check-gcp-backend-production-gate.py` (SHA = `main` HEAD, satu PR ter-merge, approval non-author pada head terakhir, check wajib sukses), tes alat, `release-source.mjs prepare`, lalu mengunggah arsip dan manifest.
   2. `backend-candidate`: ekstraksi dengan cek hash, `vercel deploy --prod --skip-domain --build-env SIMSA_VERIFY_CANDIDATE_SOURCE=1`, cek baris `SIMSA candidate backend: source checks passed` di log build, cek REST (READY, target production, project benar, belum melayani alias), dan smoke kandidat bila ada secret bypass.
   3. `frontend-candidate`: sama seperti backend, didahului `npm ci` di `source/frontend`. CLI mengevaluasi `frontend/vercel.mjs` secara lokal.
   4. `promote` menunggu **persetujuan reviewer** environment `production`. Ringkasan run menampilkan ID kandidat dan deployment yang akan diganti. Setelah disetujui, job mencatat target rollback dan menolak berjalan bila produksi berubah sejak kandidat dibuat. Lalu: `vercel promote` backend → cek alias → `check-operations.mjs` (scanner-wake dan probe, hanya peringatan) → smoke backend → `vercel promote` frontend → cek alias → smoke frontend → probe akhir.
   5. **Rollback otomatis.** Bila promosi, cek alias, atau smoke produksi gagal, setiap komponen yang sedang melayani kandidatnya dipromosikan kembali ke deployment yang tercatat (frontend dulu, lalu backend). Alias kemudian diperiksa, kedua origin di-smoke, dan job gagal dengan judul *Release FAILED and was rolled back automatically*. Bila rollback otomatis sendiri gagal, ringkasan menulis `INCOMPLETE` dan mencetak perintah `vercel promote` yang harus dijalankan saat itu juga. Kegagalan probe akhir **tidak** memicu rollback: smoke sudah lulus, dan probe juga mencakup backup/fixity yang tidak diubah rilis. Job tetap gagal dan meminta pemeriksaan.
7. **Laporan.** Tulis `docs/rilis/HASIL_RILIS_<label>_<tanggal>.md` dari ringkasan run dan artefak (`simsa-release-*`: manifest, gate, kandidat, `rollback.md`).

Manifest dari `release-source.mjs` memakai akhir baris LF (`core.autocrlf=false` dipatok). Akibatnya, manifest ini berbeda dari manifest rilis lama yang dibuat di Windows dengan `autocrlf=true`. Contoh untuk `1f125b0`: laporan C56 mencatat `9a1392…297807f` (CRLF), sedangkan `release-source.mjs` menghasilkan `04bb9266…722d8f`. Keduanya terdiri atas 1.656 berkas. Algoritma digest identik dengan `make-manifest.py`: arsip yang sama menghasilkan `9a1392…` lagi.

### Jalur manual (cadangan bila workflow tidak tersedia)

```powershell
node scripts/ops/release-source.mjs prepare --commit <sha-40> --label "<label>" --output ..\simsa-rilis-<label>
cd ..\simsa-rilis-<label>\source
vercel link --project simsa-backend --scope bayilaras-projects --yes
vercel deploy --prod --skip-domain --yes --build-env SIMSA_VERIFY_CANDIDATE_SOURCE=1
vercel inspect <url-kandidat> --logs      # wajib memuat "SIMSA candidate backend: source checks passed"
vercel promote <dpl-backend> --yes --scope bayilaras-projects
npm ci --prefix frontend
vercel link --project simsa-frontend --scope bayilaras-projects --yes
vercel deploy --prod --skip-domain --yes --build-env SIMSA_VERIFY_CANDIDATE_SOURCE=1
vercel promote <dpl-frontend> --yes --scope bayilaras-projects
node <repo>\scripts\ops\release-smoke.mjs backend https://simsa-backend.vercel.app
node <repo>\scripts\ops\release-smoke.mjs frontend https://simsa-frontend.vercel.app
```

Urutannya selalu backend dulu, lalu frontend. Bila `/ready` mengembalikan 503 hanya karena `malwareWorker=not_ready/on_demand_verification_missing_or_expired`, jalankan Operations Monitor secara manual (scanner-wake), lalu ulangi pemeriksaan.

## Rotasi per role

Siapkan password baru di password manager: 40–64 karakter alfanumerik. Helper menerima 32–128 karakter ASCII tercetak tanpa spasi, karena PostgreSQL menerapkan SASLprep pada karakter non-ASCII. Password juga harus memuat minimal 12 karakter berbeda; yang terlalu seragam ditolak. `rotate-role` meminta kredensial pemilik lalu password baru dua kali. Helper menjalankan `ALTER ROLE`, membuktikan login dengan password baru, lalu mencetak langkah lanjutan. Simpan password lama di riwayat password manager sampai verifikasi selesai. Rollback rotasi cukup dilakukan dengan `rotate-role` ke password lama.

PostgreSQL hanya mengenal satu password per role, dan kebijakan role yang sudah ditinjau tidak mengizinkan login kedua di peran yang sama. Karena itu, rotasi role runtime dilakukan dengan menyiapkan deployment berkredensial baru lebih dulu, lalu memindahkan alias dalam hitungan detik.

### simsa_backup

Tidak ada gangguan bagi pengguna. Hindari jendela backup terjadwal (cron 00:15 UTC; run aktual sering baru mulai sekitar 04:40 UTC).

1. Jalankan `rilis-neon.ps1 -Action rotate-role -Role simsa_backup`. Output menampilkan `rotasi simsa_backup: ok` dan `login simsa_backup dengan password baru: ok`.
2. **Segera** perbarui secret `NEON_BACKUP_DATABASE_URL` di env `production-recovery` dengan connection string dari password manager. Format: `postgresql://simsa_backup:<password ter-URL-encode>@<host direct>/<db>?sslmode=verify-full`. Hanya `sslmode=verify-full` dan opsional `channel_binding=require` yang diterima.
3. Jalankan `operations-recovery.yml` secara manual → harus sukses.
4. Opsional: `rilis-neon.ps1 -Action diag-backup` atau `-Action backup` dari workstation.

### simsa_api

Akan ada jeda singkat, kira-kira 5–15 detik, ketika koneksi database **baru** ditolak. Koneksi pool yang sudah terbuka tetap berjalan. Lakukan di luar jam kerja.

Tidak ada jendela dua password: PostgreSQL hanya menyimpan satu password per role, dan kebijakan role yang sudah ditinjau tidak mengizinkan login kedua di `simsa_api_runtime`. Rotasi ini memakai **jalur manual dari workstation, bukan `release-vercel.yml`**, karena dua hal:

- persetujuan reviewer menambah jeda yang tidak dapat diperkirakan antara `ALTER ROLE` dan promosi;
- kandidat dibangun dengan password yang belum berlaku, sehingga `/ready`-nya 503 sampai `ALTER ROLE` dijalankan. Smoke kandidat di workflow (bila secret bypass ada) pasti gagal.

Langkahnya:

1. Siapkan password baru di password manager. Siapkan juga sumber beku rilis yang **sedang aktif**: folder rilis terakhir, atau `release-source.mjs prepare` untuk commit itu. Pastikan Vercel CLI sudah login.
2. Di Vercel → `simsa-backend` → Settings → Environment Variables, ganti `DATABASE_URL` (Production) dengan URL berpassword baru. Deployment yang sedang melayani tidak terpengaruh, karena env dikunci per deployment.
3. Bangun kandidat tanpa domain dari sumber itu (lihat [jalur manual](#jalur-manual-cadangan-bila-workflow-tidak-tersedia)): `vercel deploy --prod --skip-domain --yes --build-env SIMSA_VERIFY_CANDIDATE_SOURCE=1`. Tunggu sampai READY dan baris `source checks passed` muncul. **Jangan** smoke kandidat ini.
4. Jalankan rotasi dan promosi berturut-turut dalam satu baris. Dengan begitu, jeda hanya meliputi `ALTER ROLE`, bukti login, dan promosi (sekitar 3 detik). Prompt kredensial muncul **sebelum** `ALTER ROLE`, jadi waktu mengetik tidak termasuk jeda.
   ```powershell
   .\scripts\ops\rilis-neon.ps1 -Action rotate-role -Role simsa_api -Node $node; if ($LASTEXITCODE -eq 0) { vercel promote <dpl-kandidat> --yes --scope bayilaras-projects }
   ```
   Bila perintah gagal **sebelum** baris `rotasi simsa_api: ok`, belum ada yang berubah. Bila pesan berbunyi `Password baru simsa_api SUDAH berlaku, tetapi bukti login gagal`, password baru sudah aktif: segera jalankan `vercel promote <dpl-kandidat>` secara manual, atau kembalikan password lama.
5. Periksa: `release-smoke.mjs backend https://simsa-backend.vercel.app`, Operations Monitor, lalu `rilis-neon.ps1 -Action verify-runtime` dengan password baru.

Rollback: bila promosi atau smoke gagal, jalankan `rotate-role -Role simsa_api` dengan password lama. Deployment lama masih memakai env lama, jadi langsung pulih tanpa build. Setelah itu, kembalikan `DATABASE_URL` di Vercel ke URL lama.

### simsa_worker

Jalurnya sama dengan `simsa_api` (manual, satu baris rotasi + promosi), tetapi memakai `MALWARE_WORKER_DATABASE_URL`. Selama jeda, hanya pemindaian baru yang tertunda; antrean tetap tersimpan di database. Rotasikan worker dalam sesi terpisah dari `simsa_api`. Bila keduanya dirangkai, prompt rotasi kedua muncul setelah `ALTER ROLE` pertama, sehingga waktu mengetik ikut memperpanjang jeda. Setelah rotasi, perbarui juga secret `NEON_WORKER_DATABASE_URL` di env `production-integrity`, lalu jalankan `operations-fixity.yml` secara manual.

### simsa_migration

- **Disarankan:** `rotate-migrate` pada setiap rilis bermigrasi. Password acak hanya hidup di proses helper dan langsung dipakai untuk migrasi. Tidak ada salinan yang dapat bocor, tetapi kredensial `neondb_owner` diperlukan.
- **Alternatif:** `rotate-role -Role simsa_migration` dengan password dari password manager, lalu `migrate` pada rilis berikutnya.
- Jangan pernah menaruhnya di GitHub atau Vercel.

### neondb_owner

Role ini dikelola Neon. Reset lewat Neon Console → project → Branches → branch produksi → Roles & Databases → `neondb_owner` → Reset password, lalu simpan nilai baru di password manager. Tidak ada layanan yang memakainya, jadi reset tidak menimbulkan gangguan. Lakukan secara berkala (mis. per 6 bulan) dan segera setelah ada dugaan paparan (mis. tertempel di chat). Aksi `rotate-*` berikutnya ikut membuktikan password baru: bila password salah, aksi itu gagal dengan `28P01` sebelum mengubah apa pun.

### simsa_operator

Role ini tidak dipakai layanan. Rotasi dengan `rotate-role` hanya bila diperlukan untuk pemeliharaan, lalu simpan hasilnya di password manager.

## Verifikasi

| Kredensial | Cara verifikasi |
|---|---|
| `simsa_backup` (GitHub) | `operations-recovery.yml` manual sukses (snapshot, enkripsi, restore, publikasi status) |
| `simsa_backup` (operator) | `rilis-neon.ps1 -Action diag-backup` menampilkan `koneksi:` dan `snapshot: ok` |
| `simsa_api` | `rilis-neon.ps1 -Action verify-runtime` → `{"success":true,"operation":"verify-runtime",...}`; produksi: `/ready` 200 dan probe `database` sehat |
| `simsa_worker` | `operations-fixity.yml` manual sukses; `/ready` tanpa `malwareWorker` gagal |
| `simsa_migration` | `migrate` → `{"success":true,"operation":"migrate",...}` |
| `neondb_owner` | `rotate-*` berikutnya lolos tahap login |
| `VERCEL_TOKEN` | uji coba kering workflow (README langkah 6) |
| `OPERATIONS_MONITOR_TOKEN` | Operations Monitor manual sukses |

## Rollback

- **Otomatis.** Workflow sudah melakukan rollback sendiri bila promosi atau smoke produksi gagal (lihat langkah rilis 6.5). Periksa ringkasan run; yang perlu tindakan manual hanya hasil `INCOMPLETE`.
- **Kode (manual).** Promosikan kembali deployment sebelumnya: frontend dulu, lalu backend. Perintahnya tercetak di ringkasan run dan artefak `rollback.md`, misalnya `vercel promote <dpl-lama> --yes --scope bayilaras-projects`. Cara lain: Vercel → Deployments → deployment lama → Promote. Setelah itu jalankan `release-smoke.mjs` untuk kedua origin dan Operations Monitor. Pasangan versi harus kompatibel: frontend baru di atas backend lama sering tidak didukung (mis. C53 di atas C55), jadi rollback berpasangan atau backend saja.
- **Setelah rollback otomatis.** Perbaiki penyebabnya, lalu *Re-run failed jobs*. Produksi sudah kembali ke deployment yang tercatat, jadi job `promote` mempromosikan kandidat yang sama lagi. Bila produksi ternyata masih (sebagian) melayani kandidat, misalnya karena rollback `INCOMPLETE`, job mengenalinya dan tidak mempromosikannya dua kali.
- **Database.** Tidak ada migrasi turun. Migrasi harus aditif agar kode lama tetap berjalan di atas schema baru (contoh: 0051 hanya menambah kolom nullable). Bila migrasi harus dibatalkan, pulihkan dari branch Neon `pra-00xx`. Data sejak branch dibuat akan hilang, jadi keputusan ini ada pada Kasubbag TU.
- **Kredensial.** Jalankan `rotate-role` ke password lama dari riwayat password manager. Untuk `simsa_api`/`simsa_worker`, kembalikan juga env Vercel ke URL lama. Deployment lama memakai env lama, sehingga langsung pulih.

## Celah yang diketahui

Per 21 Oktober 2026:

1. **Password `simsa_backup` milik operator tidak berlaku (`28P01`).** Akibatnya, backup lokal dan diagnosa lokal pada rilis C55 dan C56 dilewati, dan `operations-recovery.yml` (env `production-recovery`) dipakai sebagai gantinya. Secret GitHub masih berlaku: run #42 dan #43 sukses. Perbaikan: rotasi `simsa_backup` mengikuti [prosedur di atas](#simsa_backup), sehingga password manager dan GitHub kembali memegang nilai yang sama. Pastikan juga pin host benar, karena endpoint yang salah juga menghasilkan `28P01`.
2. **`simsa_api` tidak tersedia di workstation**, sehingga `verify-runtime` dilewati pada C55 dan C56. Penggantinya: `/ready`, smoke, dan probe Operations Monitor (`database` sehat). Perbaikan: simpan password baru di password manager pada rotasi `simsa_api` berikutnya.
3. **Kredensial pernah ditolak tiga kali pada rilis 0051**, karena connection string utuh tertempel sebagai password. Kini helper menerima keduanya dan menolak role, host, atau database yang tidak cocok sebelum menghubungi server.
4. **Helper rilis sebelumnya berada di luar repository** dengan path mesin tertentu. Kini helper ada di `scripts/ops/` dengan tes di `npm run test:ops`. Tes PostgreSQL nyata berjalan di CI melalui `OPERATIONS_RECOVERY_TEST_PG_BIN`.
5. **`release-vercel.yml` belum pernah dijalankan.** Selama `RELEASE_VERCEL_ENABLED` belum `true`, setiap run gagal pada langkah pertama dengan pesan yang jelas. Perilaku Vercel CLI di runner GitHub (project ditautkan lewat env dengan Root Directory) baru dibuktikan oleh uji coba kering README langkah 6. Workflow sengaja tidak menerima kredensial database dan tidak menjalankan migrasi.
6. **Gate produksi mensyaratkan SHA = `main` HEAD.** Bila `main` sudah bergerak (mis. merge dokumen), rilislah HEAD terbaru, atau gunakan jalur manual untuk commit lama.
