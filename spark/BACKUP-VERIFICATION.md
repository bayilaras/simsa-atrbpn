# Local Spark backup rehearsal verification — 2026-09-07

Scope: synthetic local emulator data only. New work on
`codex/firebase-spark-backup-drill`, based on PR 8 merge
`5d84fa1c7c4c99ce8f0425ac8fbc59c465d15c83`. PR 8's earlier CI/review does not
approve this new tool. No live Firebase, Production alias, billing, account
enrollment, real metadata, or legacy migration changed in this verification.

## Completed checks

| Check | Result |
| --- | --- |
| Node backup codec tests | 16 passed |
| Node emulator adapter tests with controlled HTTP fakes | 17 passed |
| Private file/launcher/Windows environment tests | 3 passed |
| Existing synthetic seed tests | 3 passed |
| Existing Spark config/UI/domain tests | 45 passed |
| Actual Firestore Rules/repository emulator suite | 105 passed |
| Spark TypeScript check and emulator build | Passed |
| Root focused legacy regression tests | 109 passed |
| Working-tree whitespace check | Passed |

Runtime: Windows, Node 24.20.0, Java 21, installed Firebase CLI 15.29.0.
No runtime/development dependencies changed. The existing Vite bundle-size
warning remains; it is not described as fixed. No new browser UI feature was
introduced or asserted live-tested.

## Actual encrypted backup and separate-process restore

The first completed drill finished at 2026-09-07T13:34:20Z, exit 0. Its local
private report directory is `simsa-spark-drill-8RfUd0` under the operator's
Windows temporary directory; no key bytes or plaintext snapshot are reproduced
in this repository.

- Source `demo-simsa-spark-backup`; destination `demo-simsa-spark-restore`.
- Both required empty; Auth/Firestore/hub fixed to loopback.
- **281 documents:** 55 profiles, 2 units, 56 classifications, 2 locations,
  56 records, 110 history snapshots. One record has **55 versions**, exercising
  real history pagination beyond both UI 25 and adapter page size 50.
- **55 Auth metadata records**, exercising real account pagination; synthetic
  Google provider binding and custom claims survived the round trip.
- Random-key AES-256-GCM archive authenticated before restoration. Wrong key,
  changed ciphertext, and truncation produced zero restoration network requests.
- Windows private-root ACL was read back and verified **before** writing a key.
  Ciphertext and the 32-byte key were written exclusively to separate folders.
- A separate Node process restored only the archive into the empty destination.
  All destination accounts were disabled. Exact comparison of every supported
  field and complete history passed, including the documented identity changes.
- Expected and actual normalized restored snapshot SHA256 were both
  `237cc7bdf349cbf468f522e792d35b2b2a8ff6eeea8a627034f28dab75101035`.
- Ciphertext SHA256:
  `92bb22bbc5bd4309d784c7558669085f07f3cd2b5939dabc06153d6bdd32ff34`.
- Emulator shutdown completed normally. In-memory source/target data is not
  retained after shutdown; ciphertext/key/report files remain local.

The final completed drill finished at **2026-09-07T13:37:51.611Z**, exit 0,
with private local report directory `simsa-spark-drill-BMQTxr`. It repeated the
281-document / 55-account round trip and additionally attempted a second real
restore into the populated destination:

- The second restore failed with `TARGET_NOT_EMPTY`, without overwriting data.
- A complete comparison after that refusal still matched the expected restored
  snapshot. Expected and actual normalized SHA256 were both
  `3cda7585a10afacccfe8b1c480bd3c9cc624756ccba57b7137277366072c4e5b`.
- Ciphertext SHA256:
  `573b44dd9c03c7b76b8030832a0a35b7ce7c6554f885b3407a5a57c3fe37cc8a`.
- All 55 restored accounts remained disabled. `productionReady` remained false.
- After shutdown, no listener remained on emulator ports 8088, 9098, 4408,
  4500, or 9150.

## Defects found and corrected while testing

- Firebase CLI-generated config/hub/address variables initially caused the
  fail-closed adapter to reject its own launcher before any data writes. Only
  exact known synthetic values are now permitted; generated cloud-shaped URLs
  are never used for transport. Real credentials/alternate hosts remain denied.
- Windows PowerShell 5 inherited an incompatible module search path from its
  parent. ACL verification initially failed **before key or fixture writes**.
  System-only child environment and module paths fixed the verification without
  weakening the ACL requirements.
- Independent review caught duplicate Google provider identities that should
  fail preflight, missing partial-restore diagnostic fields, and overly broad
  claims about retaining in-memory state after shutdown. These were corrected.

Reviews here are independent agent implementation reviews, not human PR approval
or a penetration test. Cloud CI for this new branch and exact-head human review
remain separate release requirements.

## Deliberate limitations

See [BACKUP-DRILL.md](BACKUP-DRILL.md). This is **not** a live backup/restore,
password recovery, physical source-outage test, off-site custody proof, or
atomic Firestore/Auth snapshot. Real accounts remain out of scope. The tool
does not read or export project password-hash parameters. Google project quota
and the clean-Preview provisioning gate remain unresolved.
