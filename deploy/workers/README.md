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
- The Node 24 and ClamAV base images are pinned by digest. Review release notes,
  refresh the digest deliberately, and repeat clean/EICAR/restart tests before
  upgrading them.

For production, build and push the worker image from the exact released commit,
then set `SIMSA_WORKER_IMAGE` to an immutable registry tag plus digest. The base
`compose.yml` never builds source and always pulls that artifact. Local
validation adds `compose.local.yml`, which builds the `simsa-worker:local` tag.
Do not combine an image digest with `--build`.

## Start antivirus scanning

1. Copy `.env.example` to `.env` and replace every required value.
2. Make sure the database and private Blob token point to the same environment
   as the API.
3. Apply database migrations through `0027_canonical_user_unit_mandates`.
4. For local/staging source validation, run:

   ```text
   docker compose --env-file .env -f compose.yml -f compose.local.yml up -d --build clamav malware-worker
   ```

   For production, set `SIMSA_WORKER_IMAGE` to the released digest and run only
   the base file so the host cannot rebuild a different artifact:

   ```text
   docker compose --env-file .env -f compose.yml pull clamav malware-worker
   docker compose --env-file .env -f compose.yml up -d --no-build clamav malware-worker
   ```

5. Confirm `/ready` reports a fresh `malware-scan` heartbeat, then upload a clean sample and EICAR test
   sample, and verify that only the clean object leaves quarantine.

The first ClamAV start may remain in its health-check start period for up to six
minutes while signatures initialize. Inspect `docker compose ps` and bounded
container logs rather than bypassing the health check. Worker entrypoints run
Node directly under an init process and receive a one-minute Compose grace
period. The malware worker bounds its own shutdown at 30 seconds; if a scan
cannot finish, the bitstream remains quarantined and the durable claim becomes
eligible for safe stale recovery rather than being marked clean.

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
