# SIMSA Spark pilot contract

This is an isolated Firebase Spark metadata/physical-archive pilot. All data
used by this edition lives in Firestore; identity lives in Firebase Auth.
There is no Express API, SQL database, Cloud Functions or object storage in
this edition. The existing reviewed backend is preserved. This is NOT a port
of every legacy archive workflow and NOT yet approved for real archive data.

## Data model (version 1)

- `sparkUsers/{uid}`: `{ displayName, unitId, role, active }`. Roles are
  `operator`, `viewer`, `admin`. A trusted operator provisions these documents;
  no client can create/change/list profiles. A signed-in verified-email user
  can get/listen to their own profile. Inactive/unknown users have no unit access.
- `sparkUnits/{unitId}`: `{ name }`; own-unit read only, no client writes/list.
- `sparkUnits/{unitId}/classifications/{id}`: `{ code, name, active }`.
- `sparkUnits/{unitId}/locations/{id}`: `{ name, description, active }`.
  Catalogues are readable by active unit members, immutable to clients.
- `sparkUnits/{unitId}/records/{recordId}` contains exactly:
  `title` (1..200), `referenceNumber` (1..100), `recordDate` (YYYY-MM-DD),
  `classificationId`, `locationId` (catalogue IDs, 1..100, path-safe),
  `description` (0..2000), `status` (`draft`, `active`, `archived`),
  `archiveReason` (empty unless archived; then 3..500),
  `unitId`, `createdBy`, `createdAt`, `updatedBy`, `updatedAt`, `version`.
- Every create/update atomically creates an immutable document at
  `records/{recordId}/history/v{version}` with exactly
  `{ snapshot: <entire new record>, actorUid, at }`. Rules must require the
  matching post-write history on each record mutation and require the matching
  record version transition on each history create (no orphan or forged event).
  This is bounded metadata change history, NOT a comprehensive independent
  security/audit trail. Trusted Admin SDK/IAM operators bypass client rules.

Only verified-email, active `operator`/`admin` profiles in the path's unit can
write. New records start `draft` or `active`, version 1. All times are server
timestamps equal to request.time. Updates increment version exactly once;
createdBy/createdAt/unitId stay immutable. Any non-archived record can be edited
or archived with reason. Archived records and all histories cannot be changed
or deleted by clients. Hard deletion is not supported. Actor IDs must match
the authenticated UID. Reject unknown fields, file/blob locators and roles.
Referenced catalogues must exist and be active for create/edit. Queries must
have limit <=50, with no collection-group or cross-unit access.

## Shared TypeScript API for UI and repository

`src/lib/domain.ts` exports `SparkProfile`, `SparkUnit`, `Classification`,
`StorageLocation`, `RecordInput`, `RecordRow`, `RecordPage`, validation and safe
metadata CSV export helpers. RecordInput contains the seven editable text
fields above plus status (`draft`|`active`); RecordRow adds id and server fields.
Catalogues include document `id`. RecordPage is `{ records, cursor, hasMore }`;
the opaque cursor must reset whenever unit/auth/reference-number filter changes.

`src/lib/repository.ts` exports `SparkRepository(db, actorUid)` with:

- `watchProfile(onProfile, onError)` returning unsubscribe; missing = null.
- `getUnit(unitId)`, `listClassifications(unitId)`, `listLocations(unitId)`.
- `listRecords(unitId, { cursor?, referenceNumber? })` with page size 25 and
  exact reference-number search across the unit, ordered updatedAt descending.
- `saveRecord(unitId, input, existing?)` returning id; transaction with expected
  version check on edits. No silent last-write-wins or offline-success claim.
- `archiveRecord(unitId, existing, reason)` with same optimistic concurrency.
- `listHistory(unitId, recordId)` returning latest <=25 snapshots.

Root owns `src/lib/firebase.ts`: `getSparkServices()` returns `{ auth, db }`
or throws a configuration error. App receives `{ services, configError? }`;
no initialization at module import. Firebase Auth uses session-only persistence,
email/password + Google popup; no self-signup UI. App clears unit data promptly
on sign-out, inactive profile, unit switch or request generation change. Memory
Firestore cache only. Never put administrator credentials into a frontend.

## Local / release boundaries

Tests and seeds use only `demo-simsa-spark` on 127.0.0.1:8088 (Firestore)
and 127.0.0.1:9098 (Auth); emulator hub on 4408. Synthetic fixtures only.
No live project defaults, resource creation, billing or Production deploy.
Production App Check configuration/enforcement and Spark entitlement must be
verified on a separate pilot project before first release. Emulator builds
must use a different output directory and cannot run on non-loopback origins.
Do not overwrite existing arsip-d16d3 rules or migrate existing databases.
