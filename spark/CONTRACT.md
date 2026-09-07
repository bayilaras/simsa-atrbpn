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
- `createRecordAttempt(unitId, input)` returning an opaque `RecordCreateAttempt`
  bound to this repository/actor, unit, normalized input and one document ID.
- `saveRecord(unitId, input, existing?, createAttempt?)` returning id;
  transaction with expected version check on edits. UI creates retain the same
  attempt and submitted input through retries. A replay only acknowledges the
  same ID if both the record and its original immutable v1 history prove that
  exact create; it does not overwrite subsequent edits/closure. Missing,
  malformed, mismatched or unreadable evidence never counts as success.
  Attempts cannot be transferred between repositories/units, used for edits,
  or reused with changed input. Callers omitting the token start a new intent
  on each call; there is no deduplication by reference number. No silent
  last-write-wins or offline-success claim.
- `archiveRecord(unitId, existing, reason)` with same optimistic concurrency.
- `listHistory(unitId, recordId)` returning latest <=25 snapshots.

Root owns `src/lib/firebase.ts`: `getSparkServices()` returns `{ auth, db }`
or throws a configuration error. App receives `{ services, configError? }`;
no initialization at module import. Firebase Auth uses session-only persistence,
email/password + Google popup; no self-signup UI. App clears unit data promptly
on sign-out, inactive profile, unit switch or request generation change. Memory
Firestore cache only. Never put administrator credentials into a frontend.

Create attempts exist only in memory for the current editor/context. After an
uncertain save the UI locks the submitted payload and offers same-attempt retry.
Explicitly discarding the editor, reloading, changing account/unit or closing
the browser loses that retry identity; none of these actions rolls back a write
that may already have committed. Confirm the record/history before starting a
replacement draft. This is not durable exactly-once delivery across sessions.
Pending/failed sign-out hides unit data and blocks new login until sign-out can
be confirmed. Transient catalogue errors allow a full retry; incomplete
catalogues never enable record reads or writes. Access failures remain blocked.

## Local / release boundaries

Tests and seeds use only `demo-simsa-spark` on 127.0.0.1:8088 (Firestore)
and 127.0.0.1:9098 (Auth); emulator hub on 4408. Synthetic fixtures only.
No live project defaults, resource creation, billing or Production deploy.
Production App Check configuration/enforcement and Spark entitlement must be
verified on a separate pilot project before first release. Emulator builds
must use a different output directory and cannot run on non-loopback origins.
Do not overwrite existing arsip-d16d3 rules or migrate existing databases.
