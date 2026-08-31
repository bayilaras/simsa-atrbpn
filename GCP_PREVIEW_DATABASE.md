# Bootstrap database GCP Preview

Workflow `.github/workflows/database-bootstrap-gcp-preview.yml` adalah jalur
manual untuk menginisialisasi atau mengonvergensikan Cloud SQL pada project
Preview yang terisolasi. Workflow ini tidak membaca Environment, variable,
secret, backup, atau database Production.

## Batas keselamatan

- Dispatch hanya boleh dilakukan dari current default branch dengan exact
  merge commit 40-karakter. Gate yang sama dengan rilis memverifikasi merge PR,
  approval manusia independen pada final PR head, dan seluruh required check
  pada merge commit tersebut.
- Job memakai Environment `gcp-preview-database-bootstrap` dan private runner
  Linux berlabel `simsa-gcp-private` serta `simsa-gcp-preview-db`. Concurrency
  bersifat serial dan run yang aktif tidak dibatalkan.
- Semua konfigurasi memakai variable Environment dengan prefix
  `PREVIEW_GCP_`. Satu-satunya secret yang dibaca adalah `GITHUB_TOKEN`
  ephemeral. Google authentication memakai WIF/OIDC; service-account key dan
  JSON credential tidak diterima.
- Sebelum mutation pertama, workflow membaca Cloud SQL metadata dan wajib
  membuktikan label Terraform `application=simsa`, `environment=preview`, dan
  `managed_by=terraform`, region/project/instance exact, IAM database
  authentication aktif, serta public IPv4 nonaktif.
- Grant-admin, migrator, maintenance, dan backup memakai service account
  berbeda dalam project Preview. Seluruh login database juga wajib berbeda dan
  pasangan principal IAM harus cocok dengan service account tanpa suffix
  `.gserviceaccount.com`.
- Image maintenance dibangun sekali dari exact merge commit dan direkam dengan
  content digest. Cloud SQL Auth Proxy checksum-pinned memakai private IP dan
  automatic IAM authentication.

Tidak ada reset/drop database dan tidak ada `db:push`. Untuk Preview baru,
Terraform harus sudah membuat instance, database, IAM users, jaringan, dan
service accounts. Ceremony grant-admin satu kali pada
`GCP_DATABASE_MAINTENANCE.md` juga harus sudah dilakukan menggunakan
administrator Cloud SQL yang sah; workflow tidak menaikkan privilege dirinya.

## Konfigurasi Environment

Buat GitHub Environment `gcp-preview-database-bootstrap`, batasi deployment
branch ke default branch, lalu isi variables berikut dari output Terraform
Preview:

```text
PREVIEW_GCP_DB_PROJECT_ID
PREVIEW_GCP_DB_REGION
PREVIEW_GCP_DB_INSTANCE
PREVIEW_GCP_DB_DATABASE
PREVIEW_GCP_DB_WIF_PROVIDER
PREVIEW_GCP_DB_GRANT_ADMIN_SERVICE_ACCOUNT
PREVIEW_GCP_DB_API_SERVICE_ACCOUNT
PREVIEW_GCP_DB_EVENT_SERVICE_ACCOUNT
PREVIEW_GCP_DB_WORKER_SERVICE_ACCOUNT
PREVIEW_GCP_DB_FINAL_CLEANUP_SERVICE_ACCOUNT
PREVIEW_GCP_DB_MIGRATOR_SERVICE_ACCOUNT
PREVIEW_GCP_DB_MAINTENANCE_SERVICE_ACCOUNT
PREVIEW_GCP_DB_BACKUP_SERVICE_ACCOUNT
PREVIEW_GCP_DB_GRANT_ADMIN_PRINCIPAL
PREVIEW_GCP_DB_API_PRINCIPAL
PREVIEW_GCP_DB_EVENT_PRINCIPAL
PREVIEW_GCP_DB_WORKER_PRINCIPAL
PREVIEW_GCP_DB_FINAL_CLEANUP_PRINCIPAL
PREVIEW_GCP_DB_MIGRATOR_PRINCIPAL
PREVIEW_GCP_DB_MAINTENANCE_PRINCIPAL
PREVIEW_GCP_DB_BACKUP_PRINCIPAL
PREVIEW_GCP_UPLOAD_BUCKET
PREVIEW_GCP_FINAL_BUCKET
PREVIEW_GCP_CLOUD_SQL_PROXY_IMAGE
PREVIEW_GCP_FIREBASE_APP_CHECK_APP_IDS
PREVIEW_GCP_FRONTEND_URL
PREVIEW_GCP_ADDITIONAL_TRUSTED_ORIGINS
PREVIEW_GCP_EVENTARC_INVOKER_SERVICE_ACCOUNT
```

WIF provider harus membatasi subject ke repository ini, workflow exact,
default branch, dan Environment Preview tersebut. Service accounts hanya
memerlukan Cloud SQL client/instance-user sesuai blueprint. Jangan menyalin
variable atau principal dari Environment Production. Grant-admin memiliki
custom role metadata-only (`resourcemanager.projects.get` dan
`storage.buckets.get`) tanpa izin object agar workflow dapat membuktikan target
bucket live.
Workflow mencocokkan semua nama service account dengan resource Terraform
kanonis pada project Preview yang sama, memastikan semuanya unik, dan menyegel
pasangan empat runtime service-account/SQL-login beserta exact role-membership
closure di artifact evidence.

## Menjalankan

Setelah PR sudah di-merge dan required checks sukses pada merge commit aktual,
dispatch `Bootstrap GCP Preview Database` dari `main` dengan:

```text
environment=preview
commit_sha=<current exact merge SHA pada main>
preview_confirmation=BOOTSTRAP_ISOLATED_PREVIEW
```

Urutan fail-closed yang dijalankan adalah:

1. `npm run db:roles:bootstrap` sebagai grant-admin (`bootstrap-initial`);
2. `npm run db:migrate` sebagai migrator;
3. `npm run db:roles:bootstrap` lagi sebagai grant-admin (`bootstrap-final`);
4. `npm run db:grants:converge` sebagai migrator;
5. `npm run seed:all` sebagai maintenance identity;
6. evidence read-only sebagai migrator.

Bootstrap final wajib mencabut database `CREATE` migrator. Evidence harus
membuktikan tepat 34 migration, manifest/hash sesuai source, tidak ada
ownership violation, membership principal benar, ACL fingerprint tersedia,
dan seed kanonis terverifikasi.

Artifact bernama
`gcp-preview-database-<sha>-<run-id>-<attempt>-evidence`, disimpan 30 hari,
dan berisi source gate, snapshot boundary Cloud SQL, content digest image,
log per fase, database evidence, exact runtime/proxy/Eventarc identity, snapshot
metadata bucket private (project/location/UBLA/PAP/label/purpose), summary,
serta manifest SHA-256. Catat URL
run, commit, artifact ID/digest, image digest, operator, dan waktu approval.
Artifact tidak boleh berisi token, ADC file, cookie, resumable upload URI, atau
payload secret.

Backend Preview baru boleh dideploy dengan exact run ID, artifact ID, dan
artifact digest ini. Gate deploy mengunduh exact artifact, memverifikasi
manifest, lalu mengikat revision aktif+kandidat API/event ke DB, bucket,
security environment, entrypoint, proxy digest, ingress, dan Eventarc invoker.
Jika fase
mana pun gagal, perbaiki penyebab dan rerun exact SHA; jangan menjalankan SQL
ad-hoc, menukar project target, atau memakai Production sebagai fallback.
