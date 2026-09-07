# Spark recovery verification — 2026-09-07

Scope: isolated Firebase Spark metadata pilot, synthetic local data only.
This change does not migrate the legacy backend or enable attachments, billing,
cloud resources, live backups, or Production use.

## Changes and regression evidence

- Reset a stale record request's loading state when a failed save invalidates
  its result, preserving the request-generation fence.
- Serialize logout, immediately hide data, ignore late auth callbacks, block
  competing login, and offer explicit retry when sign-out fails.
- Retry transient catalogue failures without treating them as access
  revocation. Read/write controls stay blocked until all references load;
  permission errors and missing units still fail closed.
- Bind a new-record attempt to one repository/actor, unit, normalized payload
  and fixed ID. Retry verifies both the original v1 history and immutable
  record origin without overwriting later edits/closure. The UI locks the
  submitted draft after uncertainty and retains the same attempt for retry.

Five UI recovery regressions failed before their fixes; three token-integration
expectations failed before wiring the UI to the new API. All pass afterwards.
The original repository was also reproduced creating two records when the
first write committed but its acknowledgement was lost and save was retried.
The fixed fault-injection suite verifies one ID and one initial history.

## Local results

Node 24.20, Java 21, Windows, 2026-09-07:

| Check | Result |
| --- | --- |
| `spark`: `npm test` | 115 passed: 39 script + 76 Vitest tests |
| UI recovery coverage within Vitest | 26 App tests, including 9 new regressions |
| Repository fault-injection coverage within Vitest | 22 new tests |
| `spark`: `npm run test:emulator` | 107 passed, enforced Firestore Rules |
| `spark`: `npm run build:emulator` | Typecheck and build passed |
| Root `npm test` | 109 passed across existing focused regression suites |
| `git diff --check` | Passed |

The real emulator tests include two simultaneous saves using one create
attempt, replay after subsequent edit/closure, and refusal of missing v1
history. Fault injection separately covers a committed write with lost
acknowledgement, failed readback, and later successful retry; this particular
transport failure is not claimed as a browser/live-cloud test.

Build retains Vite's existing large-chunk warning; no dependency or Rules
relaxation was introduced. An independent agent inspected the repository,
UI recovery state and documentation without finding another concrete must-fix
issue. This is functional review, not human PR approval or a pentest.

## Encrypted local backup regression

`npm run backup:drill` passed again at 2026-09-07T15:19:17.922Z:

- Separate demo source/restore namespaces; independent restore process.
- 281 Firestore documents and 55 Auth metadata accounts compared completely.
- Expected and actual digest:
  `d10482f94f0b2e48a7736c1ef0f6cb10683781b580adccacede0ae9769951476`.
- Three tamper/corruption cases rejected before network; repeated restore to
  the populated destination refused, with target unchanged.
- Restored accounts remain disabled. Passwords, hashes, tokens and sessions
  are not exported/restored. No user-login recovery or live backup claim.

Private archive and separately stored recovery key remain outside the repo.
They were not uploaded or added to source control. Separate folders on one
machine are not independent off-site custody. See [BACKUP-DRILL.md](BACKUP-DRILL.md).

## Browser recovery UAT

Playwright CLI, ephemeral Chrome profile, Auth/Firestore emulator plus local
Vite, 2026-09-07T15:20–15:25Z:

1. Login with the seeded synthetic operator. Create a complete draft using
   reference `RECOVERY/2026/001`, then switch the browser offline before save.
2. Save fails without a success notice. Original fields are disabled, the
   same editor's retry is enabled, and the non-rollback warning is visible.
3. Restore network and retry. Exactly one record and one v1 history appear.
   This browser case is a pre-commit network outage, not lost-ACK injection.
4. Logout clears table/dialog data; immediately login as the synthetic viewer.
   The record is readable, mutation controls absent. Reload preserves that
   viewer session and its read-only controls.
5. Logout and reload remain signed out. Browser and local servers were stopped;
   ports 5188, 8088, 9098, 4408, 4500 and 9150 have no remaining listeners.

Local ignored screenshots/helpers are under `output/playwright/` with prefix
`spark-recovery-`. Console errors during the explicit offline interval are
expected network-failure output, not an error-free-console claim.

## Remaining release gates

Attempts are memory-only: closing/discarding the editor, changing account/unit,
or reloading loses the retry identity and does not roll back a possible commit.
There is no cross-session exactly-once guarantee. See [README.md](README.md).

This branch is based on approved backup head `ae723641c61e1e283be98727ab22758f55a7bc00`.
At verification time PR #9 remains open despite its human approval. Do not use
its test-merge SHA as an actual merge commit. This new recovery change requires
its own human review and CI, then required checks on the actual merge commit.
Live pilot provisioning remains gated on an approved clean separate project;
the submitted quota request is not evidence of approval. Original/quarantined
projects and Production remain untouched.
