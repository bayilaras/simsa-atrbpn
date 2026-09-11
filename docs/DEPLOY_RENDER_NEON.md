# Uji cloud SIMSA dengan Render Free dan Neon Free

Konfigurasi ini menyiapkan **uji aplikasi dengan data baru**: login email/kata sandi melalui Better Auth, PostgreSQL, dan pengelolaan metadata. File, OCR, antivirus, login Google, dan integrasi SRIKANDI dimatikan secara eksplisit. Data, file, akun, dan konfigurasi aplikasi lokal tidak dipindahkan otomatis. Ini tetap mode aplikasi `full` dengan profil `internal`, bukan dataset contoh `metadata-demo`.

Template dan pemeriksaan lokal bukan bukti bahwa deployment Neon/Render sudah berhasil. Akun cloud, database tujuan yang dipilih, bootstrap, migrasi, pembuatan administrator pertama, serta uji HTTP/login di layanan tujuan tetap harus selesai sebelum pengguna diundang. Jangan gunakan jalur ini untuk menyatakan kesiapan produksi arsip atau kepatuhan hukum. Aktivasi instrumen klasifikasi/JRA dan proses yang membutuhkan bukti file tetap mengikuti pengesahan normal ketika penyimpanan sudah tersedia; tidak ada `seed:all` atau pengesahan otomatis.

## Batas biaya dan layanan

- Blueprint `deploy/render/render.yaml` mendeklarasikan tepat satu web service `plan: free`, tanpa database Render, disk, worker, cron, atau pekerjaan keep-alive. Periksa ringkasan paket sebelum membuat layanan; jangan menerima peningkatan berbayar otomatis.
- Paket Free tidak menjamin pembuatan layanan tanpa kartu: Render dapat meminta verifikasi akun. Bila dialog **Add Card** muncul, operator harus memutuskan apakah akan melanjutkan verifikasi; jangan memasukkan data kartu atau mengubah paket secara otomatis. Render menjelaskan otorisasi kartu sementara sampai US$1. Setelah metode pembayaran ditambahkan, penggunaan bandwidth atau menit build yang melewati kuota dapat ditagihkan; batas biaya pipeline tidak membatasi tagihan bandwidth. Untuk batas biaya ketat Rp0, jangan menganggap pilihan Free saja sebagai jaminan. [Verifikasi akun Render](https://community.render.com/t/the-deployement-of-a-web-service-fails/36005), [otorisasi kartu](https://render.com/terms), [tagihan layanan Free](https://render.com/docs/faq)
- Render Free dapat tidur setelah 15 menit tidak aktif dan perlu sekitar satu menit untuk bangun. Render menyatakan paket gratis tidak ditujukan untuk produksi. Jangan menjanjikan ketersediaan atau waktu respons tetap. [Dokumentasi Render Free](https://render.com/docs/free)
- Pilih paket **Free** pada proyek Neon baru. Periksa penggunaan dan batas yang berlaku di akun; batas yang ditinjau saat panduan ini ditulis adalah 0,5 GB penyimpanan per proyek dan 100 CU-jam per bulan. Batas tersebut bukan kapasitas arsip yang telah diuji. [Paket Neon](https://neon.com/pricing)
- Aplikasi tidak menyediakan heartbeat agar layanan gratis terus hidup. `/health` dipakai sebagai pemeriksaan proses Render; `/ready` dipakai operator untuk memeriksa dependensi saat penerimaan deployment.

## 1. Pilih target baru dan simpan rahasia secara privat

Gunakan Node.js 24 dan dependency backend/frontend dari lockfile proyek. Buat proyek Neon Free baru dengan **PostgreSQL 18**, versi yang telah diuji termasuk bentuk default ACL provider, lalu database khusus yang kosong, misalnya `simsa_cloud`. Jangan memilih database lokal, database milik aplikasi lain, atau proyek Neon yang sudah mempunyai peran `simsa_*`. Bootstrap sengaja menolak target tersebut.

Catat nama host **direct**, database, dan nama administrator pemilik database dari Neon Console. Peran administrator harus memiliki `CREATEROLE`; peran Neon bukan superuser PostgreSQL biasa. Jangan membuat akun aplikasi melalui Console/API karena akun yang dibuat melalui jalur tersebut dapat mewarisi `neon_superuser`. Bootstrap membuat akun aplikasi lewat SQL dengan hak terbatas. [Peran SQL Neon](https://neon.com/docs/manage/roles), [database Neon](https://neon.com/docs/manage/databases), [CREATE ROLE PostgreSQL](https://www.postgresql.org/docs/18/sql-createrole.html)

Semua URL koneksi harus menggunakan host langsung `ep-….neon.tech`, port 5432, satu nama database, serta `sslmode=verify-full`. Host berakhiran `-pooler` ditolak. Aplikasi memakai session advisory lock; mode pooling transaksi tidak mempertahankan seluruh keadaan sesi. Tidak ada parameter override `host`, `user`, atau `options` pada URL. [Pooling Neon](https://neon.com/docs/connect/connection-pooling), [TLS Neon](https://neon.com/docs/security/security-overview)

Salin `deploy/render/neon-setup.env.example` ke direktori privat **di luar repository**, kemudian edit di sana. Isi tiga kata sandi acak berbeda untuk akun database, minimal 32 karakter; gunakan password manager dan lakukan URL-encoding untuk karakter khusus. Jangan menaruh URL berisi kredensial di argumen perintah, tangkapan layar, issue, Git, atau pesan. CLI membaca environment yang secara eksplisit dipilih dan tidak mencetak URL/password.

Contoh membuat direktori baru dengan ACL hanya untuk akun Windows saat ini, **sebelum** menyalin file rahasia:

```powershell
$cloudPrivate = Join-Path $env:USERPROFILE '.simsa-cloud-private'
New-Item -ItemType Directory -Path $cloudPrivate -ErrorAction Stop | Out-Null
$cloudSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& "$env:SystemRoot\System32\icacls.exe" $cloudPrivate /inheritance:r /grant:r "*${cloudSid}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Gagal membatasi ACL direktori privat' }
Copy-Item -LiteralPath 'deploy/render/neon-setup.env.example' -Destination (Join-Path $cloudPrivate 'neon-setup.env')
```

Jika direktori sudah ada, periksa ACL-nya terlebih dahulu; jangan melemahkan izin agar perintah di atas lolos. Pada Linux/macOS gunakan direktori milik akun saat ini dengan mode `0700` dan file `0600`. Jangan menganggap `mode: 0600` Node cukup untuk membatasi ACL Windows.

`NEON_EXPECTED_HOST`, `NEON_EXPECTED_DATABASE`, dan `NEON_EXPECTED_ADMIN` adalah pin yang harus cocok dengan target yang dipilih. `NEON_EMPTY_PROJECT_ACKNOWLEDGED=true` menyatakan operator memang memilih proyek baru yang kosong. Ketiga URL akun aplikasi harus menuju host/database yang sama. Password dan URL administrator tidak diberikan kepada Render.

## 2. Bootstrap dan migrasi secara terpisah

Dari akar repository, tetapkan path Node 24 dan file privat. Contoh Windows berikut tidak berisi rahasia:

```powershell
$cloudNode = (Resolve-Path 'output/local-runtime/node-v24.21.0-win-x64/node.exe').Path
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
| `simsa_api` | Login runtime Render; hanya mewarisi `simsa_api_runtime` |
| `simsa_operator` | Login maintenance; hanya mewarisi `simsa_maintenance` |

Peran kebijakan event/worker/cleanup/backup dibuat sebagai NOLOGIN agar kontrak migrasi/grant tetap lengkap; deployment ini tidak membuat login layanan tersebut atau memberikan `pg_read_all_data`. Akun runtime bukan superuser, tidak memiliki CREATEDB/CREATEROLE/BYPASSRLS, tidak dapat menjadi pemilik skema, dan tidak dapat mengubah/menghapus audit. Kredensial database bukan akun pengguna aplikasi.

Migrasi memakai runner versi repository, rantai hash 0000–0038, lalu seluruh badan ACL `0002_converge_application_grants.sql` yang dipin hash. Pemeriksaan IAM khusus GCP diganti pemeriksaan identitas SQL Neon, bukan nama IAM palsu. Objek harus dimiliki `simsa_migrator`. Migrasi ulang setelah sukses menghasilkan `applied: 0`, lalu memverifikasi ulang grant. Jika provider menolak operasi peran/ACL, proses berhenti; jangan memperluas hak runtime untuk mengakalinya. Pengujian PostgreSQL lokal tidak membuktikan seluruh kebijakan provider Neon sampai langkah ini dijalankan pada tujuan sebenarnya.

Adapter mengenali satu default ACL bawaan Neon PostgreSQL 18 yang telah diperiksa: pemilik `cloud_admin` harus superuser, skema `public`, penerima `neon_superuser`, delapan hak tabel atau tiga hak sequence lengkap dengan grant option. Default tersebut berlaku untuk objek buatan akun sistem Neon; objek SIMSA tetap dimiliki `simsa_migrator`. Pengecualian tidak berlaku pada default milik aplikasi, role/skema lain, atau ACL langsung pada database, skema, tabel, dan fungsi. Ketika migrasi 0038 ditambahkan, jumlah/timestamp rantai dan pin hash helper diperbarui bersama; kewenangan ACL tidak diperluas. Bila seluruh migrasi sudah tercatat tetapi konvergensi grant gagal, periksa penyebab lalu ulangi `migrate --apply` setelah perbaikan yang ditinjau; jangan mengulang bootstrap.

## 3. Buat administrator aplikasi pertama

Operator harus memverifikasi kepemilikan alamat email administrator melalui jalur organisasi yang tersedia. Isi `FIRST_ADMIN_EMAIL`, `FIRST_ADMIN_NAME`, serta `FIRST_ADMIN_PASSWORD` privat (16–128 karakter) pada file setup. Jalankan:

```powershell
& $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs first-admin --apply --attest-email-owner
if ($LASTEXITCODE -ne 0) { throw 'Pembuatan administrator gagal; jangan membuka akses pengguna' }
```

Perintah ini menggunakan akun runtime `simsa_api`, hash native Better Auth, dan transaksi untuk akun, unit dasar, serta audit. Ini hanya menerima database yang belum mempunyai pengguna/akun/sesi aplikasi. Perintah tidak mencetak kata sandi atau menambahkan endpoint bootstrap publik. Jangan menjalankan seed lokal/test pada lingkungan ini. Simpan kredensial awal lewat pengelola rahasia organisasi dan ganti kata sandi melalui alur aplikasi setelah penerimaan.

## 4. Buat layanan Render Free

1. Pastikan branch `fix/user-readiness` yang memuat perubahan ini sudah dipublikasikan ke repository tujuan, lalu hubungkan repository tersebut ke Render. Pada pembuatan Blueprint pilih **branch `fix/user-readiness`** dan path **`deploy/render/render.yaml`**. Branch layanan juga dipin ke `fix/user-readiness` di YAML; jangan menerima pilihan default `main` yang belum memuat kode ini. Alternatifnya, gunakan **New Web Service** secara manual dengan branch yang sama, paket **Free**, wilayah **Singapore**, auto-deploy **Off**, serta build/start, health check, dan variabel yang sama dengan template. Konfirmasi **satu web service Free**. Tidak ada database Render yang perlu dibuat.
2. Isi secret `DATABASE_URL` dengan URL `simsa_api` yang sudah diverifikasi. Blueprint dapat menghasilkan `BETTER_AUTH_SECRET` melalui `generateValue`; untuk pembuatan layanan manual, gunakan rahasia acak kriptografis minimal 32 karakter yang dibuat sekali dan disimpan di file privat seperti `render-secrets.env` di luar repository. Pertahankan nilainya antar deployment karena penggantian dapat membatalkan sesi. Jangan memasukkan URL admin/migrator/operator atau file setup ke layanan.
3. Tinjau seluruh flag pada Blueprint dan `deploy/render/runtime.env.example`. Storage/scanner/OAuth Google tetap disabled. Pool dibatasi 3 koneksi, idle timeout 10 detik dan connect timeout 15 detik. Ini pembatas awal, bukan hasil uji kapasitas untuk jumlah pengguna tertentu.
4. `npm run build:cloud-metadata` membangun `backend/dist-cloud-metadata` dan `frontend/dist-cloud-metadata`, terpisah dari hasil build lokal. `npm run start:cloud-metadata` memvalidasi konfigurasi dan manifest, lalu menjalankan aplikasi dengan origin yang sama. URL publik diturunkan dari `RENDER_EXTERNAL_URL` bila `FRONTEND_URL`/`BETTER_AUTH_URL` kosong; domain kustom harus memakai nilai HTTPS eksplisit yang cocok.
5. Auto-deploy dimatikan. Setelah bootstrap/migrasi/administrator berhasil, jalankan deployment manual dan periksa log tanpa menyalin secret. Startup tidak menjalankan migrasi, seed, reset, atau impor data.

## 5. Penerimaan dan pemulihan

Sebelum mengundang pengguna, buktikan `/health` dan `/ready` berhasil pada URL Render, halaman menunjukkan keterbatasan file, login/logout administrator bekerja, sesi tersimpan, dan metadata sintetis dapat dibuat, dibaca, diperbarui, serta dicari sesuai unit/izin. Permintaan upload file harus ditolak dengan status unavailable yang jelas. Uji akses anonim dan akun tanpa izin tetap ditolak. Catat tanggal, commit, target nonrahasia, serta hasil; jangan menyebut preflight sebagai pengganti penerimaan ini.

Belum ada pemindahan backup lokal ke cloud. Backup terverifikasi untuk database lokal tetap mengikuti `docs/BACKUP_LOKAL.md`; backup lokal itu **bukan** backup data baru di Neon. Sebelum menaruh data penting, tentukan backup terpisah untuk database cloud, tempat penyimpanan/kunci privat, dan uji restore ke target berbeda. Jangan mengandalkan kuota gratis atau riwayat pemulihan provider sebagai SLA.

Jika deployment gagal, hentikan promosi/undangan pengguna, simpan error yang sudah disanitasi, dan periksa tahap yang gagal. Jangan menghapus database untuk memaksa bootstrap ulang. Rollback aplikasi ke commit yang sesuai skema harus ditinjau; jangan membalik migrasi otomatis. Perubahan grant/migrasi versi berikutnya memerlukan pembaruan adapter dan pengujian, bukan penghapusan pemeriksaan hash/ownership.

Pemeriksaan lokal yang tersedia:

```powershell
& $cloudNode --test scripts/neon-target.test.mjs scripts/neon-database.test.mjs scripts/neon-database-policy.test.mjs scripts/neon-first-admin.test.mjs
```

Tes mencakup pin endpoint/TLS/role, larangan target berisi data, PostgreSQL tanpa superuser, rantai migrasi dan grant, pembatasan akun runtime, kegagalan koneksi tanpa kebocoran rahasia, serta Blueprint tanpa sumber daya berbayar. Bukti penerimaan native PostgreSQL dan HTTP terpisah dicatat saat drill; itu tidak mengubah status verifikasi layanan cloud yang sebenarnya.

## Hasil verifikasi implementasi — 11 September 2026

- Build frontend/backend cloud, pemeriksaan TypeScript, dan lint berkas frontend yang berubah berhasil.
- Suite konfigurasi/deployment Neon: **14 tes lulus**, termasuk rollback pembuatan administrator dan penolakan penggantian akun yang sudah ada.
- Pengujian frontend terkait: **80 tes lulus**. Tiga tes formulir sempat melewati batas waktu saat build berjalan bersamaan; pengulangan satu berkas secara serial lulus tanpa mengubah batas waktu atau assertion.
- Pengujian backend storage disabled: **146 tes lulus**; konfigurasi/provider login terkait: **40 tes unik lulus**.
- PostgreSQL 18 disposable dengan administrator `NOSUPERUSER CREATEROLE`: bootstrap, **38 migrasi**, akun runtime terbatas, serta administrator aplikasi pertama berhasil.
- API hasil build terhadap database disposable: **39 pemeriksaan lulus**, meliputi login, provisioning akun, CRUD surat, pembatasan unit/role, CSRF, audit, serta penolakan berkas/OCR. Buktinya berada di `output/neon-deployment-tests/acceptance-1789124587692/http-acceptance.json` pada workstation pengujian, bukan repository publik.

Uji API memakai HTTP loopback dengan header origin HTTPS dan pemindahan cookie secara manual. Uji browser terpisah memeriksa tampilan login hasil build dengan fixture capabilities tanpa database. Keduanya tidak menggantikan login browser HTTPS pada Render. Database dan proses lokal aktif tidak dipakai sebagai target drill. Penerimaan pada Neon/Render, backup database cloud, dan pemindahan data lama belum dibuktikan oleh hasil di atas.

### Percobaan layanan cloud sebenarnya — 11 September 2026

- Neon Free PostgreSQL 18 di Singapore: bootstrap, 38 migrasi, konvergensi grant, verifikasi runtime `simsa_api`, serta pembuatan administrator pertama berhasil. Pengulangan migrasi menghasilkan `applied: 0`.
- Adapter default ACL provider diuji dan ditinjau terpisah; delapan kasus penyimpangan izin tetap ditolak.
- Formulir Render disiapkan untuk Free, Singapore, branch `fix/user-readiness`, dan auto-deploy Off. Setelah operator menyetujui pengiriman dua secret runtime, klik deploy membuka dialog **Add Card**, sehingga layanan belum dibuat dan URL publik belum diterbitkan.
- Belum ada bukti login HTTPS pada Render, penerimaan aplikasi cloud, backup cloud, atau pemindahan data lokal. Jangan membagikan URL perkiraan atau mengundang pengguna sampai deployment dan penerimaan benar-benar selesai.
