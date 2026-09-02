# Persistent integration workers

Vercel functions do not provide a persistent loop, so antivirus scanning and
optional SRIKANDI delivery must run outside Vercel. This Compose definition
runs a worker artifact produced from the same backend commit used by the API
and starts:

- a private ClamAV network plus the durable malware-scan worker; and
- an optional SRIKANDI worker, guarded by the `srikandi` Compose profile and
  the application's existing fail-closed configuration validation.

## Runtime prerequisites

- Use a persistent Linux host with Docker Engine and Docker Compose 2.33.1 or
  newer (`docker compose version --short`). The worker is not suitable for a
  serverless function; older Compose releases do not support the explicit
  default-gateway priority used by this deployment.
- Reserve at least the configured limits: about 5 GiB RAM/3 CPU for the default
  pair, 5.5 GiB/3.5 CPU with SRIKANDI, or 6 GiB/4 CPU if the one-shot
  maintenance profile overlaps both. Tune from measured usage.
- Permit outbound DNS/HTTPS from `clamav-updates` so FreshClam can refresh
  signatures. Port 3310 is not published to the host; the worker reaches it
  only over the internal `scanner` network, while only ClamAV joins the update
  network.
- Load `.env` values from an approved secret manager or a host file readable
  only by the service account. Container environment variables are visible to
  Docker administrators.
- Repository Node tooling is pinned to Node 24 by `.nvmrc`, `.node-version`, and
  package metadata. The Node 24 and ClamAV base images are pinned by digest. Review release notes,
  refresh the digest deliberately, and repeat clean/EICAR/restart tests before
  upgrading them.

### GCP persistent-host profile

`docs/infra/firebase-gcp/terraform/worker.tf` defines one deliberately simple,
recoverable Compute Engine VM for ClamAV and the malware worker. It has no
public IP, accepts SSH only through IAP plus OS Login/2FA, uses a single-purpose
service account, enables every Shielded VM control, and attaches the ClamAV
signature disk before boot. Cloud NAT is required because FreshClam and image
pulls need outbound internet even though inbound internet is forbidden.

The low-cost starting point is `e2-standard-2` (2 vCPU/8 GiB). The Compose
limits reserve roughly 5.25 GiB before the host OS and filesystem cache.
`e2-micro`, `e2-small`, and similar free/very small shapes are therefore
explicitly rejected; ClamAV must load a large signature database into memory.
Size from observed peak RSS and scan latency, not from idle CPU alone.

The exact `worker_boot_image` is a reviewed golden image, never an image family.
It must contain:

- Docker Engine and Docker Compose 2.33.1 or newer;
- `gcloud`, `curl`, `python3`, `iptables`, `e2fsprogs`, and an optional Google
  Ops Agent;
- this directory installed root-owned at `/opt/simsa-workers`; and
- no user credentials, registry token, service-account JSON key, `.env`, or
  secret payload.

The VM metadata contains only non-secret identifiers and immutable image
references. Its minimal startup script installs the reviewed systemd unit and
starts `bootstrap-gcp.sh`. The bootstrap then:

1. waits for and mounts the dedicated signature PD at
   `/var/lib/simsa/clamav` using its UUID;
2. reads one pinned numeric `simsa-worker-environment` Secret Manager version
   into a root-only tmpfs file under `/run`;
3. appends Terraform-controlled database, bucket, socket, and digest values,
   rejecting any attempt by the secret to override them;
4. obtains short-lived ADC from the VM metadata server, logs into the exact
   Artifact Registry host, and pulls the worker digest;
5. starts the digest-pinned Cloud SQL Auth Proxy with private IP, automatic IAM
   database authentication, and a shared Unix socket—no password or JSON key;
6. blocks only the ClamAV update subnet from the metadata server while leaving
   ADC available to the Node worker and proxy; and
7. enables an hourly systemd timer for exact-generation quarantine cleanup.

The worker service account can read/delete objects only in the upload bucket
and read/create objects only in the final bucket. It cannot list either bucket
or delete final records. The scheduled reconciler shares this identity and may
delete only the exact upload generation selected from a durable lease; it is
not an unscoped prefix cleaner.

The golden-image builder must run these static checks before publishing a new
boot image:

```text
shellcheck deploy/workers/bootstrap-gcp.sh
docker compose --env-file <generated-test-env> \
  -f deploy/workers/compose.yml -f deploy/workers/compose.gcp.yml \
  --profile gcp --profile maintenance config --quiet
```

Production worker images must be published or mirrored into the environment's
Artifact Registry repository by digest. Private GHCR would require another
long-lived credential and is not used by the GCP profile. Record the source
commit, SBOM/provenance, source registry digest, destination digest, and copy
verification as one release artifact.

### Secret-managed GCP environment

Copy `.env.gcp.secret.example` outside the repository, adjust only bounded
worker/resource tunables, then add it out-of-band as a new secret version:

```text
gcloud secrets versions add simsa-worker-environment \
  --project <environment-project> \
  --data-file /secure/path/simsa-worker.env
```

Never put `DATABASE_URL`, `DB_PASSWORD`, `GOOGLE_APPLICATION_CREDENTIALS`, JSON
key material, image references, project/bucket identifiers, or Cloud SQL
connection names in this payload. Update
`worker_environment_secret_version = "<numeric-version>"` and the reviewed
`worker_image = "...@sha256:..."` in the environment tfvars together. The
Terraform module creates only the secret container/IAM binding; it never reads
or stores the payload.

Operators are empty by default. For an approved, time-bounded maintenance
window, add a JIT group to `worker_operator_members`, apply through the normal
change process, and connect with:

```text
gcloud compute ssh simsa-malware-worker \
  --project <environment-project> --zone <worker-zone> --tunnel-through-iap
```

Anyone with root access can use the attached service account through metadata;
IAP, OS Login admin, and `iam.serviceAccounts.actAs` must therefore be granted
and revoked together. Do not add an external IP as a troubleshooting shortcut.

The Cloud SQL IAM user for this VM is a runtime identity, not a migration
owner. Bootstrap its PostgreSQL grants out-of-band with a separate migrator:
`CONNECT` on the application database, `USAGE` on the application schema, and
only the DML union required by the two processes. The malware worker needs
`SELECT/UPDATE` on `file_attachments`, `client_blob_uploads`, `surat_masuk`,
`surat_keluar`, and `regulatory_rule_sets`; `INSERT` on `audit_log`; and
`SELECT/INSERT/UPDATE/DELETE` on `operational_heartbeats`. The reconciler needs
`SELECT/UPDATE` on `client_blob_uploads`, `bulk_upload_batches`, and
`bulk_upload_items`, plus read access to `file_attachments` and
`ocr_processing_leases`. Grant sequence use only where a committed schema
default actually requires it. Never grant schema ownership, `CREATE`, migration
DDL, superuser, or broad database-owner rights to the VM identity. Re-run the
worker and reconciliation integration tests after every grant change.

The GCP Compose overlay is invoked by systemd, not by an interactive login:

```text
sudo systemctl status simsa-workers-bootstrap.service
sudo systemctl status simsa-blob-reconciler.timer
sudo docker compose --env-file /run/simsa-workers/worker.env \
  -f /opt/simsa-workers/compose.yml \
  -f /opt/simsa-workers/compose.gcp.yml --profile gcp ps
```

### Immutable artifact workflow for the base profile

The following GHCR workflow applies to the original non-GCP Compose profile.
For the GCP VM, use the reviewed Artifact Registry publish/mirror process above
and deploy only its resulting digest. For a base-profile production host, run
the GitHub Actions workflow **Publish Immutable Worker Image
(No Deployment)** from the current default-branch head, or create a controlled
`worker-v*` tag whose commit is already on that branch. The workflow first tests
all worker entrypoints, then publishes
`ghcr.io/<owner>/<repository>-worker:sha-<commit>` and records the immutable
`name@sha256:<digest>` reference in its job summary. BuildKit provenance, an SPDX
SBOM attestation, and GitHub build provenance are attached to that digest. The
workflow deliberately has no deployment job and changes no runtime environment.

Only the digest reference from a successful workflow is valid for production;
the commit tag is for discovery and must not be deployed by itself. The base
`compose.yml` never builds source and always pulls that artifact. Local
validation adds `compose.local.yml`, which builds the `simsa-worker:local` tag.
Do not combine an image digest with `--build`.

## Start antivirus scanning

1. Copy `.env.example` to `.env` and replace every required value.
2. Make sure the database and private Blob token point to the same environment
   as the API.
3. Apply every committed database migration with `npm run db:migrate`.
4. For local/staging source validation, run:

   ```text
   docker compose --env-file .env -f compose.yml -f compose.local.yml up -d --build clamav malware-worker
   ```

   For production, authenticate Docker to GHCR (when the package is private),
   put the released digest in the host `.env`, and export the exact same value in
   the deployment shell. The export makes Compose use the reference that the
   preflight validated even if a stale `.env` is accidentally present. Run the
   preflight before every pull or rollout; it rejects tags, implicit registries,
   malformed digests, unsupported Compose versions, and inaccessible manifests:

   ```text
   export SIMSA_WORKER_IMAGE='ghcr.io/owner/repository-worker@sha256:<64-lowercase-hex>'
   sh ./preflight-worker-image.sh
   docker compose --env-file .env -f compose.yml config --quiet
   docker compose --env-file .env -f compose.yml pull clamav malware-worker
   docker compose --env-file .env -f compose.yml up -d --no-build clamav malware-worker
   ```

5. Confirm `/ready` reports a fresh `malware-scan` heartbeat, then upload a clean sample and EICAR test
   sample, and verify that only the clean object leaves quarantine.

For GCP, do not use the local command above. Terraform configures the Cloud Run
API as `clamav + external worker`, so `/ready` requires a fresh database
heartbeat without opening port 3310 from Cloud Run to the VM. Only the Node
worker and ClamAV share the internal Compose scanner network.

The `ClamAV Clean, EICAR & Restart Smoke` CI job also exercises the application's
real `INSTREAM` client against the pinned Linux ClamAV image, verifies clean and
EICAR verdicts, restarts the container, and repeats both scans. A passing unit
suite or Docker image build alone is not treated as antivirus proof.

The first ClamAV start may remain in its health-check start period for up to six
minutes while signatures initialize. Inspect `docker compose ps` and bounded
container logs rather than bypassing the health check. Worker entrypoints run
Node directly under an init process and receive a one-minute Compose grace
period. The malware worker bounds its own shutdown at 30 seconds; if a scan
cannot finish, the bitstream remains quarantined and the durable claim becomes
eligible for safe stale recovery rather than being marked clean.

## GCP acceptance and recovery drill

Run this drill in Preview first and retain timestamped logs, object generations,
attachment/lease state, heartbeat evidence, instance/disk IDs, container
digests, and the exact commit.

1. **Baseline and clean path.** Confirm the signature PD UUID/mount and proxy,
   ClamAV, and worker health. Upload an approved clean PDF through the real
   frontend origin. Prove `pending -> claimed`, a generation-pinned scan,
   `integrity_status=verified`, `malware_scan_status=clean`, final-object
   creation, and source lease `release_cleanup`. Run the reconciler service and
   prove only the source generation is removed while the final object remains.
2. **EICAR.** Upload the standard EICAR antivirus test fixture through the same
   flow. Prove `infected`, no final-object promotion, no public/download access,
   and audit evidence containing the scanner signature. Treat EICAR as test
   malware and keep it only in the isolated Preview bucket.
3. **ClamAV failure.** Stop `clamav`, submit a clean fixture, and prove the
   attachment stays unavailable with retry/error state and a degraded worker
   heartbeat; `/ready` must become not-ready. Start ClamAV again and prove stale
   claim recovery completes exactly once.
4. **Database/proxy failure.** Stop `cloud-sql-proxy`; prove no attachment is
   marked clean and the heartbeat becomes stale. Restart the proxy and worker,
   then prove queue progress resumes without duplicate promotion.
5. **Container restart.** Restart ClamAV and the worker during an in-flight
   scan. The claim must remain quarantined until its stale deadline and then be
   recovered. Record `docker inspect` digests before and after.
6. **VM restart and PD recovery.** Record the signature disk UUID, database file
   names/timestamps, and FreshClam version; reboot the VM. Prove the same disk is
   mounted, systemd starts the same digests, signatures remain populated, the
   metadata-blocking `DOCKER-USER` rule is restored, and `/ready` becomes ready
   only after a fresh heartbeat.
7. **Cleanup failure.** Deny or interrupt upload deletion for one timer run.
   Prove the lease remains retryable and the final object is untouched. Restore
   permission, rerun `simsa-blob-reconciler.service`, and prove exact-generation
   deletion succeeds without object listing.

Useful bounded evidence commands:

```text
sudo findmnt /var/lib/simsa/clamav
sudo systemctl status simsa-workers-bootstrap.service --no-pager
sudo systemctl list-timers simsa-blob-reconciler.timer --no-pager
sudo iptables -C DOCKER-USER -s 172.31.250.0/28 \
  -d 169.254.169.254/32 -j REJECT
sudo journalctl -u simsa-workers-bootstrap.service --since '-30 min' --no-pager
```

Do not print `/run/simsa-workers/worker.env`, access tokens, resumable upload
URIs, or object URLs into the evidence bundle.

### Worker rollback

Keep the previous worker and proxy digests plus the previous golden-image name
in the release record. A container-only rollback changes `worker_image` to the
last accepted digest, reviews the Terraform plan, applies through the approved
pipeline, then restarts `simsa-workers-bootstrap.service` over IAP. A host-image
rollback recreates the VM from the last accepted exact boot image while
reattaching the preserved `simsa-clamav-signatures` disk. Never roll back a
database migration by replacing the worker image; use forward-fix/restore rules
from the database maintenance plan.

The single VM is intentionally an inexpensive first production shape, not high
availability. Automatic restart and the preserved signature PD shorten host
recovery, but VM/zone loss pauses scanning and `/ready` must fail closed. A
future multi-instance design needs one signature disk per instance and the
existing `SKIP LOCKED` queue semantics; do not share one read-write PD.

## Reconcile abandoned direct uploads

Run the one-shot maintenance profile from an external hourly scheduler. In
production the immutable image is pulled by the base file and no build context
is available:

```text
docker compose --env-file .env -f compose.yml --profile maintenance run --rm blob-reconciler
```

The client-upload lease table and durable bulk-upload item rows are the
authorities. The job reserves expired, unclaimed client uploads and tombstones
expired bulk batches before deleting only unreferenced source objects. Failed
object deletions remain retryable and make the job exit non-zero; a non-zero
exit must alert and retry. Never replace this job with an unscoped Blob prefix
delete.

On the GCP VM the external scheduler is the provisioned
`simsa-blob-reconciler.timer`. It invokes the same one-shot maintenance profile
hourly with `--pull never`, so it cannot silently adopt a newer image tag.

The current multipart bulk-ingest endpoint is intentionally bounded to 50 PDF
files, 50 MB per file, and 100 MB total per batch. Larger ingest workloads must
use a future direct-to-private-Blob lease flow rather than raising API memory
limits.

## Enable SRIKANDI conditionally

Do not use the placeholder endpoint or field names. Obtain the official
contract, sandbox, authentication material, payload mapping, ACK value, and
remote-ID definition first. Then set `SRIKANDI_ENABLED=true` and start the
released image with
`docker compose --env-file .env -f compose.yml --profile srikandi up -d --no-build`.
For local contract testing only, also add `-f compose.local.yml` and `--build`.

Activation is an operational decision. The application remains usable in its
internal profile with SRIKANDI disabled; it must never claim official delivery
from an HTTP 2xx response alone.

`/health` is process liveness only. `/ready` and `/api/health` perform live
database/private-Blob probes and require a fresh heartbeat for each enabled
persistent worker. A missing, stale, degraded, or stopped required worker is
reported as not ready rather than inferred from environment variables.
