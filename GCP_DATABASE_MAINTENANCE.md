# GCP Production database maintenance gate

Workflow `.github/workflows/database-maintenance-gcp.yml` adalah satu-satunya
jalur yang didokumentasikan untuk mengubah skema dan seed Cloud SQL Production.
Workflow ini belum menjalankan apa pun sampai Environment, WIF, runner, backup,
dan identitas database benar-benar disediakan.

## Jaminan yang diterapkan

- hanya `workflow_dispatch`, commit merge 40-karakter yang sama dengan HEAD
  default branch, approval PR final, dan seluruh required check yang sukses;
- Environment `gcp-production-database-maintenance` dengan required reviewer,
  deployment branch default-only, concurrency serial, serta runner Linux VPC
  berlabel `simsa-gcp-private` dan `simsa-gcp-maintenance`;
- tidak ada service-account JSON key. Enam sesi WIF terpisah mengautentikasi
  grant-admin, migrator, grant-admin lagi, migrator lagi, maintenance seed, dan
  migrator evidence. Cloud SQL Auth Proxy selalu memakai private IP dan
  automatic IAM database authentication serta port loopback deterministic
  `30000-39999` yang diuji bebas per run/attempt;
- backup manual dari commit yang sama harus sudah sukses melewati independent
  restore drill. Metadata artifact diperiksa melalui GitHub API, artifact
  terenkripsi diunduh tanpa recovery identity, lalu manifest plaintext harus
  menyatakan `schema_profile=pre_migration` (baseline 0020) atau
  `schema_profile=pre_upgrade_0038` (baseline 0038), commit dan run/attempt yang sama,
  nama file aman, serta SHA-256 yang cocok untuk dump dan source evidence.
  Sebelum gate ini, workflow me-resolve target Production dari Environment dan
  menghitung SHA-256 format kanonis
  `project:region:instance/database/backup_principal` (UTF-8, tanpa newline).
  Hash manifest harus identik; target dihitung ulang sebelum sesi mutasi dan
  mismatch menghentikan workflow;
- image target `maintenance` dibangun tepat sekali dari commit itu. Content ID,
  label revision/source, hash Dockerfile, dan hash lockfile masuk evidence;
- urutan database tetap: bootstrap awal, migration, bootstrap final, grant
  convergence, seed, lalu evidence. Bootstrap awal masih mempertahankan grant
  `CREATE` database sementara untuk kompatibilitas bootstrap lama; bootstrap
  final wajib mencabutnya. Runner `db:migrate` tidak memerlukan grant tersebut
  dan tidak menjalankan `CREATE SCHEMA IF NOT EXISTS drizzle`;
- evidence serializable/read-only mencocokkan seluruh timestamp/hash journal
  dengan manifest dari journal checkout yang direview, kepemilikan aplikasi,
  exact direct/transitive membership closure, pasangan empat runtime login ke
  service account Terraform kanonis, fingerprint ACL/membership,
  `CREATE=false` untuk migrator, serta
  baris seed kanonis. Artifact evidence disegel manifest SHA-256 dan upload v4
  menghasilkan artifact ID/digest immutable dengan retensi 90 hari. Summary
  juga menyegel project, region, instance dan connection name Cloud SQL,
  database, seluruh runtime/backup IAM database principal, proxy image digest,
  Eventarc invoker, security environment API, serta exact bucket upload/final
  berikut project/location/UBLA/PAP/label/purpose;
  checker menghitung ulang hubungan dan hash seluruh field tersebut;

Tidak ada jalur `db:push`. Perintah terkendali yang dijalankan adalah:

1. `npm run db:roles:bootstrap` sebagai grant-admin;
2. `npm run db:migrate` sebagai migrator;
3. `npm run db:roles:bootstrap` lagi sebagai grant-admin;
4. `npm run db:grants:converge` sebagai migrator dengan manifest migrasi exact;
5. `npm run seed:deployment` sebagai maintenance: tambah unit yang belum ada dan verifikasi instrumen aktif yang disahkan;
6. koleksi evidence read-only sebagai migrator.

`db:migrate` memakai `scripts/migrate-database.mjs`, bukan CLI migrasi Drizzle.
Schema `public` dan `drizzle` harus sudah dimiliki `simsa_migrator`, dan koneksi
harus memiliki effective role tersebut melalui bootstrap yang disetujui.
Runner memegang transaction-scoped advisory lock pada satu koneksi, memeriksa
seluruh prefix timestamp/hash journal, lalu menerapkan SQL dan ledger secara
atomik. UTC ditetapkan hanya selama transaksi agar default/backfill timestamp
konsisten dengan runtime, tanpa mengubah timezone server atau data historis.
Timeout menunggu lock adalah 30 detik; kegagalan membatalkan transaksi.
Rerun tanpa perubahan harus menghasilkan `0 applied` meskipun database
`CREATE` sudah dicabut. Hash historis yang diizinkan dibaca dari manifest JSON
yang sama dengan verifier backup; jangan mengedit SQL migrasi yang sudah
diterapkan atau menambahkan hash untuk melewati error divergensi.

## Gate instrumen dan setup pertama

`seed:deployment` mempertahankan konfigurasi unit yang sudah ada dan tidak menulis butir, versi aturan, pemetaan, atau keputusan pengesahan. SQL yang sama dipakai kembali oleh collector evidence: harus ada tepat satu edisi aktif per instrumen, butir selectable, sumber PDF privat dengan verifier/ukuran/generation, manifest dan laporan dampak, aktor serta waktu pengajuan/telaah/persetujuan/publikasi, dan event `activate` yang cocok. Edisi pengganti yang sah diterima tanpa mewajibkan UUID baseline 2018/2020 tetap aktif. Pemetaan tematik dihitung bila ada, tetapi bukan syarat pengesahan instrumen.

Pada database baru, gate berhenti dengan `GOVERNANCE_REQUIRED` sampai tata kelola selesai. Rerun edisi aktif yang lengkap menghasilkan sukses tanpa aktivasi ulang. Database hasil clone dari seed development juga tetap ditolak jika publikasinya hanya berupa `bootstrap_activate` atau tidak mempunyai bukti/aktor yang dipersyaratkan.

Urutan setup administratif sebelum pembukaan layanan:

1. Selesaikan provisioning, backup, bootstrap role, migrasi, dan convergence melalui workflow yang disetujui. Kegagalan `GOVERNANCE_REQUIRED` pada tahap seed tidak membatalkan migrasi yang telah dicatat; dua unit awal tersedia untuk setup. Simpan log kegagalan sebagai status belum siap, bukan evidence sukses.
2. Operator perlu menyediakan instance administrasi terisolasi dari artifact API/frontend yang direview, memakai database, Firebase Auth/App Check, scanner, dan private storage **lingkungan tujuan**. Pertahankan `NODE_ENV=production`; gunakan akun runtime terbatas, jaringan privat serta akses administratif terautentikasi, dan jangan mengarahkan traffic pengguna umum ke instance setup. Instance tersebut belum dibuat oleh perubahan kode ini dan tetap memerlukan target/project serta provisioning yang disetujui operator.
3. Provision akun penyusun, penelaah, dan penyetuju berwenang. Melalui **Master Data > Versi Aturan**, pilih draft awal hasil migrasi; impor array butir yang telah diperiksa (`items`, bukan seluruh envelope asset seed), unggah PDF sumber melalui alur privat aplikasi, lalu verifikasi manifest dan laporan dampak. Jalankan **Ajukan → Telaah → Setujui → Aktifkan** dengan akun independen. Untuk clone development yang baseline-nya sudah aktif, buat draft revisi dan terbitkan edisi pengganti dengan bukti yang lengkap; jangan memodifikasi status melalui SQL.
4. Periksa PDF dapat diakses melalui endpoint terautentikasi dan rantai audit aplikasi valid. Rerun maintenance dari commit yang direview, lalu simpan evidence baru dengan `seed.governance_verified=true` dan ID kedua edisi aktif. Hanya evidence sukses ini yang boleh dipakai untuk gate release normal.

Gate maintenance memeriksa **bukti yang tersimpan di database**. Principal maintenance tidak mendapat akses object storage; ketersediaan byte sumber instrumen diperiksa oleh alur aktivasi dan akses runtime, bukan oleh job fixity lampiran arsip. Nilai `governance_verified` tidak menyatakan sertifikasi hukum atau keberhasilan pemeriksaan storage secara real time. `seed:all` tetap khusus development/test lokal dan tidak dipakai oleh workflow deployment.

## Provisioning sebelum run pertama

Terraform membuat empat service account/SQL IAM user terpisah yang relevan
untuk maintenance dan backup:

- `simsa-db-grant-admin` untuk bootstrap role dan ownership saja;
- `simsa-db-migrator` untuk DDL yang direview saja;
- `simsa-db-maintenance` untuk seed kanonis saja;
- `simsa-db-backup` sebagai login read-only untuk workflow backup.

Keempatnya menerima `roles/cloudsql.client` dan
`roles/cloudsql.instanceUser` dari blueprint. Grant-admin juga menerima custom
role metadata-only berisi `resourcemanager.projects.get` dan
`storage.buckets.get`, tanpa izin object. Provider WIF harus membatasi tiga
account maintenance ke workflow/Environment maintenance, sedangkan account
backup hanya ke workflow/Environment backup, semuanya pada repository dan
default branch yang tepat. Jangan membuat key atau memberi keempatnya akses
runtime, Cloud Storage, Firebase Auth, Secret Manager, maupun Cloud Run
deployment.

Terraform tidak dan memang tidak boleh memberi atribut PostgreSQL
`CREATEROLE`. Setelah SQL IAM user dibuat, lakukan ceremony satu kali dalam
maintenance window menggunakan administrator `postgres`/`cloudsqlsuperuser`
yang sudah ada:

1. verifikasi exact principal dari output Terraform
   `database_maintenance.grant_admin_principal`;
2. pada database aplikasi yang tepat, inventaris pemilik seluruh object
   `public`/`drizzle` non-extension dan extension `pgcrypto`;
3. untuk database baru, beri `CREATEROLE` hanya kepada principal grant-admin;
4. untuk database legacy, pindahkan hanya ownership aplikasi dan `pgcrypto`
   dari owner lama ke grant-admin dalam sesi ter-review. Jangan melakukan
   `REASSIGN OWNED` sebelum inventaris membuktikan owner lama tidak memiliki
   object lain yang berada di luar scope aplikasi;
5. pastikan API, event, worker, final-cleanup, migrator, maintenance, dan backup
   tidak memiliki `CREATEROLE`, `CREATEDB`, superuser, replication, atau bypass
   RLS;
6. simpan transcript yang sudah disanitasi sebagai evidence operasi, bukan di
   repository. Password/token/ADC file tidak boleh masuk transcript.

Bootstrap fail-closed bila grant-admin bukan `session_user`, tidak memiliki
`CREATEROLE`, owner legacy tidak sesuai, atau principal runtime beratribut
berbahaya. Setelah itu grant-admin tetap memiliki `CREATEROLE` hanya sebagai
control-plane identity yang memerlukan Environment approval; runtime dan
migrator tidak mewarisinya.

## Konfigurasi GitHub Environment

Isi variables berikut pada `gcp-production-database-maintenance` (bukan
repository-wide secrets):

- `GCP_DB_PROJECT_ID`, `GCP_DB_REGION`, `GCP_DB_INSTANCE`, `GCP_DB_DATABASE`;
- `GCP_DB_WIF_PROVIDER`;
- `GCP_DB_GRANT_ADMIN_SERVICE_ACCOUNT`,
  `GCP_DB_API_SERVICE_ACCOUNT`, `GCP_DB_EVENT_SERVICE_ACCOUNT`,
  `GCP_DB_WORKER_SERVICE_ACCOUNT`, `GCP_DB_FINAL_CLEANUP_SERVICE_ACCOUNT`,
  `GCP_DB_MIGRATOR_SERVICE_ACCOUNT`,
  `GCP_DB_MAINTENANCE_SERVICE_ACCOUNT`,
  `GCP_DB_BACKUP_SERVICE_ACCOUNT`;
- `GCP_DB_GRANT_ADMIN_PRINCIPAL`, `GCP_DB_API_PRINCIPAL`,
  `GCP_DB_EVENT_PRINCIPAL`, `GCP_DB_WORKER_PRINCIPAL`,
  `GCP_DB_FINAL_CLEANUP_PRINCIPAL`, `GCP_DB_BACKUP_PRINCIPAL`,
  `GCP_DB_MIGRATOR_PRINCIPAL`, dan `GCP_DB_MAINTENANCE_PRINCIPAL`.
- `GCP_UPLOAD_BUCKET`, `GCP_FINAL_BUCKET`, `GCP_CLOUD_SQL_PROXY_IMAGE`;
- `GCP_FIREBASE_APP_CHECK_APP_IDS`, `GCP_FRONTEND_URL`,
  `GCP_ADDITIONAL_TRUSTED_ORIGINS`, dan
  `GCP_EVENTARC_INVOKER_SERVICE_ACCOUNT`.

Semua service account harus berasal dari output state Terraform untuk project
yang sama. Workflow menolak nama yang bukan `simsa-api-runtime`,
`simsa-event-runtime`, `simsa-malware-worker`, `simsa-final-cleanup`, atau
identitas database-control kanonis lainnya; setiap principal harus sama dengan
email service account tanpa akhiran `.gserviceaccount.com`.

Workflow memverifikasi bahwa empat service account berbeda, berasal dari
project yang sama, dan principal IAM database masing-masing tepat sama dengan
email service account tanpa suffix `.gserviceaccount.com`. Gunakan pasangan
`cloud_sql_backup_identity.service_account` dan
`cloud_sql_backup_identity.database_principal` dari output Terraform untuk
backup. Seluruh principal login juga harus saling berbeda.
Bootstrap memetakan login backup itu ke fixed NOLOGIN role
`simsa_backup_reader`; jangan mengisi nama fixed role tersebut sebagai
variable. Satu-satunya secret yang dibaca workflow adalah ephemeral
`GITHUB_TOKEN`.

## Menjalankan maintenance

1. Pastikan merge commit final sudah direview dan required checks dijalankan
   ulang pada exact merge SHA.
2. Dari exact SHA/default branch itu, jalankan manual
   `Cloud SQL PostgreSQL Backup and Restore Drill` dengan profile
   `pre_migration` untuk sumber tepat sampai 0020, atau `pre_upgrade_0038`
   untuk sumber tepat sampai 0038 sebelum migrasi 0039. Kedua baseline memeriksa
   urutan dan hash lengkap; jumlah migrasi di antaranya tidak diterima.
   Tunggu seluruh run, termasuk independent restore, sukses.
3. Catat workflow run ID, encrypted artifact ID, dan digest `sha256:...` dari
   output/artifact API, serta cocokkan `source_identity_sha256` dengan target
   Production yang akan dimutasi. Jangan menyalin age recovery identity ke
   Environment maintenance.
4. Dispatch `GCP Production Database Maintenance` dari exact ref yang sama.
   Isi environment `production`, exact SHA, ketiga identifier backup, dan
   konfirmasi `MAINTAIN_PRODUCTION`.
5. Sesudah sukses, catat maintenance workflow run URL, artifact name, artifact
   ID, artifact digest, maintenance image content digest, commit, operator, dan
   waktu approval. Unduh artifact untuk arsip audit terkontrol.
6. Berikan run ID/artifact ID/digest maintenance yang sama kepada workflow
   deploy backend. Gate deploy mengunduh dan memverifikasi isi evidence sekali,
   lalu memeriksa ulang keberadaan, digest, status, environment, dan commit
   sebelum event traffic serta canary API 5%, 25%, dan 100%. Project/region
   deployment serta konfigurasi database/storage/security revision API dan
   event aktif+kandidat wajib sama persis dengan `database_target`,
   `storage_target`, dan `runtime_security`. Deploy membaca metadata bucket live
   lagi; mismatch atau drift menghentikan promosi.

## Kegagalan dan recovery

Kegagalan fase mana pun menghentikan fase berikutnya dan tidak memberi traffic
Cloud Run. Jangan mengulang dengan SHA lain atau artifact lain tanpa backup
pra-upgrade baru pada baseline yang telah direview. Bila migration telah commit, pilih forward-fix ter-review
atau restore independen dari encrypted artifact sesuai incident decision;
jangan memakai schema push atau rollback SQL ad-hoc. Rollback traffic aplikasi
tidak dengan sendirinya membatalkan perubahan database, sehingga revision lama
harus tetap kompatibel dengan migration yang dipromosikan.

Sebelum Production pertama, latih seluruh ceremony pada clone terisolasi,
termasuk kegagalan setelah bootstrap awal, kegagalan setelah migration,
bootstrap final yang membuktikan migrator tidak lagi mempunyai `CREATE`, seed
idempotent, restore artifact, dan forward-fix.
