# Backend QA remediation — 14 September 2026

This candidate fixes three findings from the SIMSA UAT: an active duplicate cross-reference returned HTTP 500, an event dated today in WIB was rejected during early WIB hours, and location identifiers could collide within one unit. Work and tests used the isolated remediation copy. No production database or original working tree was modified.

## Behavior changes

- Cross-reference creation maps PostgreSQL SQLSTATE `23505` through nested driver/Drizzle `cause` objects to HTTP 409 with a fixed business message. The response does not include database query text or parameters. Cancellation still retains the original row, and a replacement active relation can be created afterward.
- Migration `0043_retention_event_business_date.sql` changes the event insertion guard to `(clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date`. The API already uses that calendar. Future dates remain rejected, independent of the database session timezone. Revision-chain checks and historical event dates remain intact.
- Migration `0044_storage_location_business_codes.sql` enforces unique `(unit_kerja_id, lower(btrim(code)))`. Creation and updates trim supplied codes; collisions return HTTP 409. Missing service-level codes use the next unused numeric suffix, including manual identifiers and gaps. Generation validates the 50-character limit rather than truncating an identifier. The HTTP form still requires an explicit code, as before.

The shared `src/utils/postgres-errors.ts` helper checks structured SQLSTATE and an optional constraint name through a bounded, cycle-safe cause chain. Location conflicts are restricted to the location-code index so another constraint failure is not misreported as a duplicate location.

## Location policy assumption

The selected business key is unique across all levels **within a unit**, with case ignored and outer spaces removed for comparison. The same identifier remains valid in another unit. This follows the existing unit-scoped hierarchy, code-based lookup/display, and generated identifiers that include their full parent prefix, such as `G1-R2-RAK3-B4`. It is an explicit policy decision for review by the archive owner, rather than a claim that the original PRD specified the exact index scope.

Existing location codes are not rewritten. Supplied identifiers retain their case for display; comparisons use PostgreSQL `lower(btrim(code))`. Changing a parent's code does not rename descendant identifiers or their references.

Each create/update transaction locks the authoritative unit with `FOR NO KEY UPDATE` before locking a location. That serializes application code allocation without blocking ordinary foreign-key key-share checks on the unit. The database unique index also protects direct SQL writes. Separate processes that bypass the service may receive a uniqueness error if they race an allocation.

## Migration preflight and rollout

Use the repository's normal migration runner with the owning migrator identity. Apply schema changes before deploying the new code. The journal reserves 0043 and 0044 above, followed by the separately implemented `0045_dosir_date_order.sql`. Historical migration files and their accepted hashes are unchanged.

Migration 0044 locks location writes, checks existing rows, and creates the unique index in a single atomic statement. If a duplicate group exists it aborts with the unit, normalized code, row count, and row IDs. It never deletes, merges, quarantines, or renames business records automatically. The migration runner rolls back the pending batch on this error. List all groups for a reviewed reconciliation plan using this read-only query:

```sql
SELECT unit_kerja_id, lower(btrim(code)) AS normalized_code,
       count(*) AS location_count,
       array_agg(id ORDER BY id) AS location_ids
FROM storage_locations
GROUP BY unit_kerja_id, lower(btrim(code))
HAVING count(*) > 1
ORDER BY unit_kerja_id, lower(btrim(code));
```

Resolve any group with the archive owner while preserving all archive, lending, and hierarchy references; then retry the migration. No automatic cleanup is included. A production data preflight and post-deployment UI retest remain necessary; passing local tests does not mean the deployed site is already fixed.

## Validation

From `backend`, the focused command is:

```powershell
npm test -- src/__tests__/qa-backend-regressions.integration.test.ts src/__tests__/postgres-errors.test.ts src/__tests__/tunjuk-silang.service.test.ts src/__tests__/tunjuk-silang.routes.test.ts src/__tests__/storage-location.service.test.ts src/__tests__/retention-governance.schemas.test.ts src/__tests__/migration-chain.integration.test.ts src/__tests__/retention-governance.migration.test.ts
```

The initial baseline had 51 passing tests. The new regression run first reproduced 10 failures, including actual Drizzle-wrapped PostgreSQL errors and deterministic database clocks at 00:00 and 05:56 WIB. Logs are stored outside the candidate in `../simsa-remediation-evidence-20260914/backend-*.txt`. Expanded validation covers helper behavior, safe HTTP error messages, create/update rollback on collisions, unit boundaries, hierarchy prefixes, length limits, restricted API database privileges, full migration-chain compatibility, preservation of legacy duplicate rows, and future-date rejection across session timezones.

PGlite supplies isolated PostgreSQL behavior and serializes its transactions; the parallel allocation case checks service outcomes but is not a two-connection production lock/load test. Consolidated backend tests and the existing real-PostgreSQL lock suite should be included in release verification when a disposable PostgreSQL test database is available.
