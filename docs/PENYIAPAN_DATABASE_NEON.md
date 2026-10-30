# Penyiapan database Neon untuk SIMSA

Panduan ini menyiapkan **database Neon baru yang kosong** untuk SIMSA: bootstrap peran dan skema, migrasi beserta grant, verifikasi akun runtime, dan administrator aplikasi pertama. Aplikasi sendiri berjalan di Vercel; konfigurasi proyek dan environment backend ada di [deployment Vercel dan Neon](DEPLOY_VERCEL_NEON.md). Data, file, akun, dan konfigurasi dari lingkungan lain tidak dipindahkan otomatis.

Template dan pemeriksaan lokal bukan bukti bahwa database tujuan sudah siap. Akun cloud, database tujuan yang dipilih, bootstrap, migrasi, pembuatan administrator pertama, serta uji HTTP/login pada deployment tujuan tetap harus selesai sebelum pengguna diundang. Aktivasi instrumen klasifikasi/JRA dan proses yang membutuhkan bukti file tetap mengikuti pengesahan normal; tidak ada `seed:all` atau pengesahan otomatis.

## Batas layanan

- Periksa paket proyek Neon serta penggunaan dan batas yang berlaku di akun. Batas paket bukan kapasitas arsip yang telah diuji. [Paket Neon](https://neon.com/pricing)
- Aplikasi tidak menyediakan heartbeat agar layanan tetap hidup. `/health` memeriksa proses; `/ready` dipakai operator untuk memeriksa dependensi saat penerimaan deployment.

## 1. Pilih target baru dan simpan rahasia secara privat

Gunakan Node.js 24 dan dependency backend dari lockfile proyek. Buat proyek Neon baru dengan **PostgreSQL 18**, versi yang telah diuji termasuk bentuk default ACL provider, lalu database khusus yang kosong, misalnya `simsa_cloud`. Jangan memilih database lokal, database milik aplikasi lain, atau proyek Neon yang sudah mempunyai peran `simsa_*`. Bootstrap sengaja menolak target tersebut.

Catat nama host **direct**, database, dan nama administrator pemilik database dari Neon Console. Peran administrator harus memiliki `CREATEROLE`; peran Neon bukan superuser PostgreSQL biasa. Jangan membuat akun aplikasi melalui Console/API karena akun yang dibuat melalui jalur tersebut dapat mewarisi `neon_superuser`. Bootstrap membuat akun aplikasi lewat SQL dengan hak terbatas. [Peran SQL Neon](https://neon.com/docs/manage/roles), [database Neon](https://neon.com/docs/manage/databases), [CREATE ROLE PostgreSQL](https://www.postgresql.org/docs/18/sql-createrole.html)

Semua URL koneksi harus menggunakan host langsung `ep-….neon.tech`, port 5432, satu nama database, serta `sslmode=verify-full`. Host berakhiran `-pooler` ditolak. Aplikasi memakai session advisory lock; mode pooling transaksi tidak mempertahankan seluruh keadaan sesi. Tidak ada parameter override `host`, `user`, atau `options` pada URL. [Pooling Neon](https://neon.com/docs/connect/connection-pooling), [TLS Neon](https://neon.com/docs/security/security-overview)

Salin `deploy/neon/neon-setup.env.example` ke direktori privat **di luar repository**, kemudian edit di sana. Isi tiga kata sandi acak berbeda untuk akun database, minimal 32 karakter; gunakan password manager dan lakukan URL-encoding untuk karakter khusus. Jangan menaruh URL berisi kredensial di argumen perintah, tangkapan layar, issue, Git, atau pesan. CLI membaca environment yang secara eksplisit dipilih dan tidak mencetak URL/password.

Contoh membuat direktori baru dengan ACL hanya untuk akun Windows saat ini, **sebelum** menyalin file rahasia:

```powershell
$cloudPrivate = Join-Path $env:USERPROFILE '.simsa-cloud-private'
New-Item -ItemType Directory -Path $cloudPrivate -ErrorAction Stop | Out-Null
$cloudSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& "$env:SystemRoot\System32\icacls.exe" $cloudPrivate /inheritance:r /grant:r "*${cloudSid}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Gagal membatasi ACL direktori privat' }
Copy-Item -LiteralPath 'deploy/neon/neon-setup.env.example' -Destination (Join-Path $cloudPrivate 'neon-setup.env')
```

Jika direktori sudah ada, periksa ACL-nya terlebih dahulu; jangan melemahkan izin agar perintah di atas lolos. Pada Linux/macOS gunakan direktori milik akun saat ini dengan mode `0700` dan file `0600`. Jangan menganggap `mode: 0600` Node cukup untuk membatasi ACL Windows.

`NEON_EXPECTED_HOST`, `NEON_EXPECTED_DATABASE`, dan `NEON_EXPECTED_ADMIN` adalah pin yang harus cocok dengan target yang dipilih. `NEON_EMPTY_PROJECT_ACKNOWLEDGED=true` menyatakan operator memang memilih proyek baru yang kosong. Ketiga URL akun aplikasi harus menuju host/database yang sama. Password dan URL administrator tidak diberikan kepada Vercel.

## 2. Bootstrap dan migrasi secara terpisah

Dari akar repository, tetapkan path Node 24 dan file privat. Contoh Windows berikut tidak berisi rahasia:

```powershell
$cloudNode = (Get-Command node).Source   # harus Node.js 24
$cloudEnv = Join-Path $env:USERPROFILE '.simsa-cloud-private/neon-setup.env'
& $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs preflight-empty
if ($LASTEXITCODE -ne 0) { throw 'Preflight gagal; tidak boleh lanjut bootstrap' }
& $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs bootstrap --apply
if ($LASTEXITCODE -ne 0) { throw 'Bootstrap gagal; periksa target sebelum melanjutkan' }
& $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs migrate --apply
if ($LASTEXITCODE -ne 0) { throw 'Migrasi/grant gagal; jangan deploy aplikasi' }
& $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs verify-runtime
if ($LASTEXITCODE -ne 0) { throw 'Verifikasi runtime gagal; jangan deploy aplikasi' }
```

`preflight-empty` hanya membaca. `bootstrap --apply` mengunci transaksi, memeriksa ulang bahwa target kosong, lalu membuat peran dan skema dalam satu transaksi. Jika sudah pernah berhasil, bootstrap berikutnya ditolak; ini bukan perintah reset atau mekanisme adopsi database lama. Kegagalan koneksi saat COMMIT perlu pemeriksaan keadaan target oleh administrator sebelum mengulang.

| Identitas | Fungsi |
| --- | --- |
| Administrator Neon pilihan operator | Pemilik database, pembuat peran, disimpan hanya untuk administrasi |
| `simsa_migrator` (NOLOGIN) | Pemilik skema dan objek aplikasi |
| `simsa_migration` | Login migrasi; otomatis `SET ROLE simsa_migrator` pada database terpilih |
| `simsa_api` | Login runtime backend; hanya mewarisi `simsa_api_runtime` |
| `simsa_operator` | Login maintenance; hanya mewarisi `simsa_maintenance` |

Peran kebijakan event/worker/cleanup/backup dibuat sebagai NOLOGIN agar kontrak migrasi/grant tetap lengkap; bootstrap tidak membuat login layanan tersebut atau memberikan `pg_read_all_data`. Login worker dan backup disiapkan terpisah (`scripts/neon-worker.mjs provision --apply`, `scripts/neon-backup.mjs provision --apply`; lihat [runbook kredensial database](RUNBOOK_KREDENSIAL_DATABASE.md) dan [backup Neon](BACKUP_NEON.md)). Akun runtime bukan superuser, tidak memiliki CREATEDB/CREATEROLE/BYPASSRLS, tidak dapat menjadi pemilik skema, dan tidak dapat mengubah/menghapus audit. Kredensial database bukan akun pengguna aplikasi.

Migrasi memakai runner versi repository, seluruh rantai hash dari journal checkout, lalu seluruh badan ACL `0002_converge_application_grants.sql` yang dipin hash. Pemeriksaan identitas memakai identitas SQL Neon, bukan nama IAM. Objek harus dimiliki `simsa_migrator`. Migrasi ulang setelah sukses menghasilkan `applied: 0`, lalu memverifikasi ulang grant. Jika provider menolak operasi peran/ACL, proses berhenti; jangan memperluas hak runtime untuk mengakalinya. Pengujian PostgreSQL lokal tidak membuktikan seluruh kebijakan provider Neon sampai langkah ini dijalankan pada tujuan sebenarnya.

Adapter mengenali satu default ACL bawaan Neon PostgreSQL 18 yang telah diperiksa: pemilik `cloud_admin` harus superuser, skema `public`, penerima `neon_superuser`, delapan hak tabel atau tiga hak sequence lengkap dengan grant option. Default tersebut berlaku untuk objek buatan akun sistem Neon; objek SIMSA tetap dimiliki `simsa_migrator`. Pengecualian tidak berlaku pada default milik aplikasi, role/skema lain, atau ACL langsung pada database, skema, tabel, dan fungsi. Jumlah dan timestamp migrasi diturunkan dari journal checkout, bukan angka versi terpisah. Pin hash helper tetap diperbarui saat kode grant/collector berubah; kewenangan ACL tidak diperluas. Bila seluruh migrasi sudah tercatat tetapi konvergensi grant gagal, periksa penyebab lalu ulangi `migrate --apply` setelah perbaikan yang ditinjau; jangan mengulang bootstrap.

Migrasi rilis berikutnya pada database produksi dijalankan lewat `scripts/ops/rilis-neon.ps1` sesuai runbook kredensial database.

## 3. Buat administrator aplikasi pertama

Operator harus memverifikasi kepemilikan alamat email administrator melalui jalur organisasi yang tersedia. Isi `FIRST_ADMIN_EMAIL`, `FIRST_ADMIN_NAME`, serta `FIRST_ADMIN_PASSWORD` privat (16–128 karakter) pada file setup. Jalankan:

```powershell
& $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs first-admin --apply --attest-email-owner
if ($LASTEXITCODE -ne 0) { throw 'Pembuatan administrator gagal; jangan membuka akses pengguna' }
```

Perintah ini menggunakan akun runtime `simsa_api`, hash native Better Auth, dan transaksi untuk akun, unit dasar, serta audit. Ini hanya menerima database yang belum mempunyai pengguna/akun/sesi aplikasi. Perintah tidak mencetak kata sandi atau menambahkan endpoint bootstrap publik. Jangan menjalankan seed lokal/test pada lingkungan ini. Simpan kredensial awal lewat pengelola rahasia organisasi dan ganti kata sandi melalui alur aplikasi setelah penerimaan.

## 4. Hubungkan backend

Simpan URL `simsa_api` yang sudah diverifikasi sebagai `DATABASE_URL` pada environment Production proyek `simsa-backend`, mengikuti [deployment Vercel dan Neon](DEPLOY_VERCEL_NEON.md). Jangan memasukkan URL admin/migrator/operator atau file setup ke layanan. Startup tidak menjalankan migrasi, seed, reset, atau impor data.

## 5. Penerimaan dan pemulihan

Sebelum mengundang pengguna, buktikan `/health` dan `/ready` berhasil pada deployment tujuan, login/logout administrator bekerja, sesi tersimpan, dan metadata sintetis dapat dibuat, dibaca, diperbarui, serta dicari sesuai unit/izin. Uji akses anonim dan akun tanpa izin tetap ditolak. Catat tanggal, commit, target nonrahasia, serta hasil; jangan menyebut preflight sebagai pengganti penerimaan ini.

Sebelum menaruh data penting, siapkan backup database Neon dan dokumen privat: workflow `operations-recovery.yml` ([cadangan dan pemulihan](OPERATIONS_RECOVERY.md)) dan backup manual [backup Neon](BACKUP_NEON.md). Uji restore ke target berbeda. Jangan mengandalkan kuota atau riwayat pemulihan provider sebagai SLA.

Jika deployment gagal, hentikan promosi/undangan pengguna, simpan error yang sudah disanitasi, dan periksa tahap yang gagal. Jangan menghapus database untuk memaksa bootstrap ulang. Rollback aplikasi ke commit yang sesuai skema harus ditinjau; jangan membalik migrasi otomatis. Perubahan grant/migrasi versi berikutnya memerlukan pembaruan adapter dan pengujian, bukan penghapusan pemeriksaan hash/ownership.

Pemeriksaan lokal yang tersedia:

```powershell
& $cloudNode --test scripts/neon-target.test.mjs scripts/neon-database.test.mjs scripts/neon-database-policy.test.mjs scripts/neon-first-admin.test.mjs
```

Tes mencakup pin endpoint/TLS/role, larangan target berisi data, PostgreSQL tanpa superuser, rantai migrasi dan grant, pembatasan akun runtime, serta kegagalan koneksi tanpa kebocoran rahasia.

## Riwayat verifikasi — 11 September 2026

- Neon Free PostgreSQL 18 di Singapore: bootstrap, 38 migrasi, konvergensi grant, verifikasi runtime `simsa_api`, serta pembuatan administrator pertama berhasil. Pengulangan migrasi menghasilkan `applied: 0`.
- PostgreSQL 18 disposable dengan administrator `NOSUPERUSER CREATEROLE`: bootstrap, 38 migrasi, akun runtime terbatas, serta administrator aplikasi pertama berhasil.
- Adapter default ACL provider diuji dan ditinjau terpisah; delapan kasus penyimpangan izin tetap ditolak.
