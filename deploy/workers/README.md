# Persistent integration workers

Vercel functions do not provide a persistent loop, so antivirus scanning and
optional SRIKANDI delivery must run outside Vercel. This Compose definition
builds the same backend commit used by the API and starts:

- a private ClamAV network plus the durable malware-scan worker; and
- an optional SRIKANDI worker, guarded by the `srikandi` Compose profile and
  the application's existing fail-closed configuration validation.

## Start antivirus scanning

1. Copy `.env.example` to `.env` and replace every required value.
2. Make sure the database and private Blob token point to the same environment
   as the API.
3. Apply database migrations through `0027_canonical_user_unit_mandates`.
4. Run `docker compose --env-file .env -f compose.yml up -d --build clamav malware-worker`.
5. Confirm `/ready` reports a fresh `malware-scan` heartbeat, then upload a clean sample and EICAR test
   sample, and verify that only the clean object leaves quarantine.

## Reconcile abandoned direct uploads

Run the one-shot maintenance profile from an external hourly scheduler:

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
remote-ID definition first. Then set `SRIKANDI_ENABLED=true` and start with
`docker compose --env-file .env -f compose.yml --profile srikandi up -d --build`.

Activation is an operational decision. The application remains usable in its
internal profile with SRIKANDI disabled; it must never claim official delivery
from an HTTP 2xx response alone.

`/health` is process liveness only. `/ready` and `/api/health` perform live
database/private-Blob probes and require a fresh heartbeat for each enabled
persistent worker. A missing, stale, degraded, or stopped required worker is
reported as not ready rather than inferred from environment variables.
