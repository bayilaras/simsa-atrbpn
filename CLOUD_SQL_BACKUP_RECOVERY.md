# Cloud SQL Backup and Independent Restore Drill

This runbook covers the Firebase/Google Cloud target only. The existing Neon
workflow remains available as a temporary rollback path and is not modified or
disabled by this design.

## What the workflow guarantees

After this workflow is reviewed, merged, and enabled on the default branch,
`.github/workflows/backup-cloud-sql.yml` is scheduled daily and can also be
dispatched manually. Until then it is an unexecuted target configuration, not
backup evidence. Both jobs reject any ref other than the repository default
branch and use the protected `gcp-production-backup` GitHub Environment.

The backup job:

1. validates the exact project, region, instance, database, and database user;
2. obtains short-lived ADC credentials through GitHub OIDC and Workload
   Identity Federation;
3. connects through a checksum-pinned Cloud SQL Auth Proxy v2 using automatic
   IAM database authentication;
4. proves the database login has exactly one safe membership to
   `simsa_backup_reader`, that role has exactly one safe membership to
   `pg_read_all_data`, the transitive closure contains no other role/SET path,
   and there are no write/CREATE or PostgreSQL administrative attributes;
5. captures the existing migration/schema/count/fixity evidence and exports a
   custom-format `pg_dump` from the same PostgreSQL snapshot;
6. pipes the dump directly into `age` encryption; and
7. uploads only the encrypted dump, encrypted evidence, and a non-secret hash
   manifest for 14 days.

Manifest juga mengikat artifact ke target sumber exact melalui
`source_identity_sha256`. Nilainya adalah SHA-256 bytes UTF-8 tanpa newline dari
format kanonis
`project:region:instance/database/database_user`. Komponen mengikuti exact
identifier Environment `gcp-production-backup`; separator `:`, `/` tidak valid
di komponen tersebut sehingga format tidak ambigu. Independent restore wajib
memverifikasi field ini tetap berada di manifest yang hash-nya sudah disegel.
Manifest juga memuat `backup_role_membership_closure=exact`; restore drill dan
maintenance gate menolak artifact bila exact closure proof tersebut hilang.

A separate job on a fresh runner downloads that artifact, validates its hashes,
streams decryption directly into `pg_restore`, restores into an ephemeral
PostgreSQL service, reruns the existing evidence collector, and requires an
exact match. The workflow never executes migrations, seed commands, deployment,
or Production data mutation.

## Protected Environment configuration

Create two GitHub Environments with separate responsibility:

- `gcp-production-backup` for the private source dump and WIF identity;
- `gcp-production-restore-drill` for offline decryption and the fresh PostgreSQL
  restore only.

Configure both with:

- deployment branches: only the repository default branch;
- required reviewers for manual dispatches, preferably from separate backup
  and recovery groups;
- prevent administrators from bypassing protection if organizational policy
  requires it; and
- no environment URL or deployment target.

Set these variables **only** on `gcp-production-backup`, with real, exact values from the selected
Cloud SQL Production instance. The examples below are labels, not values to
copy:

| Variable | Required value |
|---|---|
| `CLOUD_SQL_BACKUP_PROJECT_ID` | Exact Google Cloud project ID |
| `CLOUD_SQL_BACKUP_REGION` | Exact Cloud SQL region |
| `CLOUD_SQL_BACKUP_INSTANCE` | Exact instance name, not a connection string |
| `CLOUD_SQL_BACKUP_DATABASE` | Exact SIMSA application database |
| `CLOUD_SQL_BACKUP_DATABASE_USER` | Exact IAM PostgreSQL username used by the proxy |
| `CLOUD_SQL_BACKUP_WIF_PROVIDER` | Full WIF provider resource name |
| `CLOUD_SQL_BACKUP_SERVICE_ACCOUNT` | Dedicated backup service-account email in the same project |

Set repository variable `CLOUD_SQL_BACKUP_POSTGRES_MAJOR` to literal `16` or
`17`, matching the source instance. It is non-secret compatibility metadata
used by both jobs to select the same digest-pinned PostgreSQL image. Do not put
Cloud SQL project, instance, database, WIF provider, or service-account
variables on `gcp-production-restore-drill`.

Kedua job memakai official Debian Bookworm image, bukan Alpine, dengan digest
multi-architecture yang dipin. Restore menjalankan `pg_restore --create` agar
encoding, collation provider, locale, dan properti database dari archive benar-
benar diuji; basis Debian menghindari false failure umum ketika locale libc
Cloud SQL tidak tersedia pada musl/Alpine.

The workflow deliberately has no database password and no service-account JSON
key. The WIF service account needs only the Google Cloud permissions required to
connect to the selected Cloud SQL instance, normally `roles/cloudsql.client`
plus the IAM database-login role chosen by the organization. Bind the WIF
provider to the exact GitHub repository, default branch ref, and workflow path;
do not permit arbitrary repository subjects.

The backup job deliberately targets the runner labels
`self-hosted, linux, x64, simsa-gcp-backup` and starts the proxy with
`--private-ip`. Provision a dedicated ephemeral runner, or a runner that is
scrubbed and re-imaged between jobs, on the same VPC as the private Cloud SQL
instance. Do not attach the label to a general-purpose runner, and do not expose
a public database address merely to make this drill pass. The independent
restore job remains on a fresh GitHub-hosted runner and has no Cloud SQL or WIF
permission.

Proxy source memakai port loopback deterministic pada rentang `20000-29999`
yang diturunkan dari run ID/attempt dan diuji bebas sebelum proses dimulai.
Maintenance memakai rentang berbeda, sehingga dua workflow tidak berebut
`127.0.0.1:5432` bila label runner tanpa sengaja berada pada host yang sama.

## Dedicated read-only database role

Create the IAM database user through the normal Cloud SQL administration
process, then grant the least-privilege database membership from a controlled
administrator session. Substitute the exact quoted role name; do not paste the
placeholder:

```sql
GRANT pg_read_all_data TO "<exact-cloud-sql-iam-database-user>";
REVOKE CREATE ON DATABASE "<exact-application-database>"
  FROM "<exact-cloud-sql-iam-database-user>";
REVOKE CREATE ON SCHEMA public, drizzle
  FROM "<exact-cloud-sql-iam-database-user>";
```

Do not grant `pg_write_all_data`, `cloudsqlsuperuser`, object mutation
privileges, `CREATEDB`, `CREATEROLE`, `BYPASSRLS`, or ADMIN OPTION. The workflow
rechecks effective relation privileges and PostgreSQL role attributes every
run and fails closed if access expands.

## Two recovery secrets

Store the secrets with this separation:

- `CLOUD_SQL_BACKUP_AGE_RECIPIENT`: one active public X25519 `age1...`
  recipient. Store the same public value in both Environments so the source job
  can encrypt and the restore job can prove its identity derives that recipient.
- `CLOUD_SQL_BACKUP_AGE_IDENTITY`: the corresponding
  `AGE-SECRET-KEY-...` identity. During rotation it may contain both the old and
  new identities, one per line, until all old artifacts expire. Store it **only**
  on `gcp-production-restore-drill`.

Generate the pair offline on an administrator-controlled host with the pinned
or organization-approved `age-keygen`. Put the public recipient in the first
secret and the private identity in the second. Never store either value in the
repository, workflow inputs, step summaries, or Google Secret Manager under the
same principal used by the backup job.

Rotation without losing recoverability:

1. generate a new pair offline;
2. add the new private identity to `CLOUD_SQL_BACKUP_AGE_IDENTITY` while keeping
   the old identity;
3. change `CLOUD_SQL_BACKUP_AGE_RECIPIENT` to the new public recipient;
4. run a manual post-migration drill and verify it succeeds;
5. retain the old identity until every artifact encrypted to it has expired or
   been re-encrypted and independently drilled; and
6. remove the old identity and rerun the drill.

The source backup job never references or receives the private identity. The
restore job has no OIDC token permission, WIF action, Cloud SQL target
variables, or database network access. It derives public recipients from the private identities and
requires the active recipient to match before decrypting anything. WIF
credentials cannot decrypt backups, and the age identity grants no Google Cloud
access.

## First run and evidence retention

1. Verify required checks on the default-branch commit.
2. Confirm source variables/public recipient on `gcp-production-backup`, the
   private identity/public recipient on `gcp-production-restore-drill`, and the
   repository PostgreSQL-major variable.
3. Dispatch **Cloud SQL PostgreSQL Backup and Restore Drill** from the default
   branch and select the exact schema profile. New Cloud SQL targets should
   normally use `post_migration`; use `pre_migration` only while the database
   truly has that exact history.
4. Require both jobs to pass. The backup job alone is not a successful drill.
5. Record the workflow run URL, source commit, artifact name/digest, encrypted
   file hashes, `source_identity_sha256`, schema profile, and review approval in
   the release evidence.
6. Download the encrypted artifact to the approved offline recovery location
   if policy requires retention beyond the 14-day Actions window.

The logical dump complements Cloud SQL automated backups and point-in-time
recovery; it does not replace them. Periodically perform an additional restore
into an isolated Cloud SQL recovery project to validate IAM, network, engine
version, and operational runbooks outside GitHub's ephemeral PostgreSQL drill.

## Static validation

Before merging workflow changes, run:

```text
python .github/scripts/validate-cloud-sql-backup-workflow.py
```

Then parse the YAML with the repository's trusted YAML tool and inspect the
diff. The validator checks protected triggers, action commit pins, secret
separation, short retention, required evidence flow, and absence of migration
or deployment commands; it does not contact Google Cloud or read secrets.
