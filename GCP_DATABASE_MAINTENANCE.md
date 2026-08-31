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
  menyatakan `schema_profile=pre_migration`, commit dan run/attempt yang sama,
  nama file aman, serta SHA-256 yang cocok untuk dump dan source evidence.
  Sebelum gate ini, workflow me-resolve target Production dari Environment dan
  menghitung SHA-256 format kanonis
  `project:region:instance/database/backup_principal` (UTF-8, tanpa newline).
  Hash manifest harus identik; target dihitung ulang sebelum sesi mutasi dan
  mismatch menghentikan workflow;
- image target `maintenance` dibangun tepat sekali dari commit itu. Content ID,
  label revision/source, hash Dockerfile, dan hash lockfile masuk evidence;
- urutan database tetap: bootstrap awal, migration, bootstrap final, grant
  convergence, seed, lalu evidence. Bootstrap awal memberi migrator hak
  `CREATE` database yang sementara diperlukan Drizzle untuk
  `CREATE SCHEMA IF NOT EXISTS drizzle`; bootstrap final wajib mencabutnya;
- evidence serializable/read-only mencocokkan seluruh 34 timestamp/hash journal
  dengan manifest kode yang direview, terakhir `0033`, kepemilikan aplikasi,
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
5. `npm run seed:all` sebagai maintenance;
6. koleksi evidence read-only sebagai migrator.

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
   `pre_migration`. Tunggu seluruh run, termasuk independent restore, sukses.
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
`pre_migration` baru. Bila migration telah commit, pilih forward-fix ter-review
atau restore independen dari encrypted artifact sesuai incident decision;
jangan memakai schema push atau rollback SQL ad-hoc. Rollback traffic aplikasi
tidak dengan sendirinya membatalkan perubahan database, sehingga revision lama
harus tetap kompatibel dengan migration yang dipromosikan.

Sebelum Production pertama, latih seluruh ceremony pada clone terisolasi,
termasuk kegagalan setelah bootstrap awal, kegagalan setelah migration,
bootstrap final yang membuktikan migrator tidak lagi mempunyai `CREATE`, seed
idempotent, restore artifact, dan forward-fix.
