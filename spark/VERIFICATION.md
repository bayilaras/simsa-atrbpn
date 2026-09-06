# Spark implementation verification — 2026-09-06

## Scope and release decision

This is a separate metadata/physical-archive pilot, not a completed migration of
the legacy application. Its application data is Firestore-only and identity is
Firebase Authentication. No billing, live Firebase project, database migration,
Production alias or existing backend was changed during this verification.

Base: PR 7 merge `c1442ca932f8053b2b7be1b83bf93d3f9af045b1`.
Branch: `codex/firebase-spark-edition`. A new exact-head human review and required
checks are required; PR 7 approval is not approval of this new implementation.

**Local pilot verified; not released for real archive data or online use.**
Use the release gates in [README.md](README.md) before any live provisioning or
promotion. Full Firestore backup/independent restore tooling is not implemented;
CSV export is only the visible page, not a backup.

## Local evidence

Environment: Windows, Node 24.20.0, portable Temurin Java 21, Firebase CLI
15.29.0, Firebase SDK 12.18.0, Firestore emulator 1.22.0. Only the demo project
`demo-simsa-spark` was used; Auth/Firestore/hub listen on loopback ports
9098/8088/4408. No service-account or application-default credentials were used.

| Check | Result |
| --- | --- |
| Fresh dependency installation and lockfile consistency dry run | Passed |
| TypeScript `npm run typecheck` | Passed |
| `npm test`: seed helper tests | 3 passed |
| `npm test`: config, Hosting, domain and UI tests | 45 passed |
| Firestore Rules against the real local emulator | 96 passed |
| Repository transactions/pagination against the real local emulator | 9 passed |
| Combined `npm run test:emulator` launcher lifecycle | 105 passed, exit 0; emulator ports closed afterward |
| Controlled launcher-only SIGTERM interruption | Firebase CLI cleaned up; exit 143; all five emulator ports closed |
| `npm run build:emulator` | Passed; output isolated in `dist-emulator` |
| Production build without explicit live web config | Rejected as intended |
| Root legacy focused `npm test` suites | 109 passed |
| Browser runtime dependency audit (`--omit=dev`) | 0 reported vulnerabilities |
| Complete Spark dependency audit | 13 moderate, 0 high, 0 critical |
| Whitespace check | Passed |

The moderate advisories are in development/CLI tooling; they have not been
described as fixed. CI blocks high/critical Spark dependency advisories. Vite
also reports a bundle-size warning (about 790 kB minified / 240 kB gzip), not a
build failure. No full legacy backend matrix or remote CI result is inferred
from the focused local tests.

## Browser walkthrough

Playwright CLI drove Chrome at `http://127.0.0.1:5188/` against local Firebase
emulators, using only public synthetic fixture accounts:

1. Operator login loaded its own unit and active catalogues.
2. Created `DEMO-2026-001` as draft; server-confirmed version 1 appeared.
3. Edited its title and made it active; server-confirmed version 2 appeared.
4. Archived it with a reason; version 3 appeared with edit/archive controls
   removed. No document was hard-deleted.
5. Opened history and observed versions 3, 2 and 1, the original/new titles,
   actor UID, timestamps and archive reason.
6. Exact-reference search returned that record. The downloaded CSV was read
   back and contained the matching version-3 metadata.
7. Logout returned to login. Viewer login and full page reload retained only
   read access; no add-record control appeared.
8. Desktop and 390-pixel mobile screenshots were visually inspected. The
   responsive table scrolls horizontally. Firebase's local emulator warning
   remains intentionally visible.

An initial missing-favicon 404 was fixed with a local SVG icon. The final
browser console check reported 0 errors and 0 warnings (Firebase/React local
development notices are informational). Browser and local servers were stopped
after the walkthrough; no online URL was created.

Local browser evidence is under `output/playwright/spark/` (gitignored), including
`operator-desktop.png` and `viewer-mobile.png`. This is local evidence only:
Google popup login, email delivery, real Firestore indexes, Hosting CSP and
App Check enforcement still require a live isolated pilot.

## Corrections caught by testing and independent code review

- Concurrent transaction losers now produce a version-conflict message when a
  permitted server reread proves stale state; genuine same-version permission
  failures stay denied. No write retry or Rules relaxation was added.
- Catalogue pagination reads beyond 50 entries and explicitly rejects overflow
  beyond the pilot limit of 1,000, without silently truncating.
- Domain and Rules timestamp/calendar/canonical-string validations agree.
- UI discards stale responses after user/unit/access changes and clears metadata
  on access failure. Its configuration-error gate does not begin authentication.
- Seed no longer relies on a custom credential unsupported by Admin Firestore
  14. Fixed-loopback REST creates only allowlisted synthetic documents and
  preserves existing fixtures. Seed was run successfully twice.
- Hosting CSP includes documented reCAPTCHA connection/frame sources. A static
  regression test checks these sources; live CSP compatibility remains unproven.
- Emulator and live build folders are separated. Emulator CLI config does not
  use cached Firebase login; inherited Node/Java injection variables are removed.

Normal launcher cleanup and a controlled in-process SIGTERM forwarding drill
passed. Native Windows console Ctrl+C and forced OS termination are separate
untested boundaries; no broad process-kill fallback was introduced.

Peer reviews here were independent agent code reviews, not the required human
GitHub approval and not a full penetration-test or Production certification.
