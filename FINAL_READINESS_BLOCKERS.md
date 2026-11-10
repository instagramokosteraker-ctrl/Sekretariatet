# Final Readiness Blockers — Competitor Ownership and SI Matching

Status: reassessed 2026-11-10. This report is the evidence record for the current cutover verdict. The canonical status and prioritized blocker list remain in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).

## Verdict

**Readiness: NO-GO.**

Repository-local assignment writers now use transaction-boundary validation; standalone assignment create/retire APIs were removed, bootstrap rereads the competitor and fails on write errors, and lifecycle/SI/card-series mutations abort when assignment work is skipped or inconsistent. Firestore rules now require a changed matching competitor and validate assignment identity, card-series, and owner parity. The rules regression suite and deployed rule version remain unverified. Production-wide ownership consistency, external/Admin SDK writer authority, concurrency behavior, and rollback behavior are also not established.

The authenticated local V2 inventory ran at `2026-11-10T21:10:54.882Z` and read all three competitions returned by Firestore (12 competitors, 16 assignments). It confirmed four historical reassignment records with same-competitor ACTIVE successors and no orphan or duplicate-SI findings. It also found six active assignment/competitor `ownerUid` parity mismatches (four in Reflexcup#2, two in Lång-TM). The earlier basic inventory's two Lång-TM lifecycle findings are superseded by the V2 successor-aware classification.

**Single highest-priority remaining blocker:** determine and document authoritative ownership for the six active ownerUid mismatches; rerun the V2 audit after any separately approved correction.

## Writer and authority inventory

“Atomic SI Matching” below means that the assignment and corresponding competitor identity/lifecycle write are validated together in the same Firestore transaction. A Firestore transaction that writes only an assignment is not an atomic competitor/assignment mutation.

| Writer / operation | Authority and location | Atomic SI Matching and ownership verification | Finding |
|---|---|---|---|
| Direct competitor entry | Authenticated client; [`saveDirectCompetitionEntryToFirestore`](./src/firebase.ts#L6269) | Yes: creates competitor, active assignment, and counters in one transaction. Reads the assignment key in the transaction; validates shape/conflicts and uses matching SI, competitor ID, and owner. Duplicate competitor query is outside the transaction. | Best-covered create path. Per-competition assignment document contention serializes competing claims to the same SI when all writers use this path. |
| IOF competitor import and snapshot seed | Authenticated client; [`saveCompetitionImportToFirestore`](./src/firebase.ts#L3088), [`syncFullSeasonToFirestore`](./src/firebase.ts#L2066), shared transaction writer `writeImportedCompetitorWithAssignment` | Yes for each competitor: the shared identity writer validates an existing assignment/competitor or creates their matching pair in one transaction. It rejects import-driven SI/card-series changes. | Assignment-aware per competitor, not all-or-nothing for the whole import/snapshot; earlier rows may commit before a later row fails. |
| Readout auto-create | Authenticated client; [`submitReadoutToFirestore`](./src/firebase.ts#L5673) | Yes: competitor, active assignment, receipt, and counts are written together. Checks runner identity and assignment absence in the transaction; duplicate-competitor query is outside it. | Paired transaction is present. It still depends on deployed rules and duplicate-check behavior; no concurrent integration evidence is recorded. |
| SI reassignment / competitor update | Authenticated client; [`updateCompetitorInFirestore`](./src/firebase.ts#L4400) | Transaction rereads competitor/current/target assignments. Reassignment and card-series-only updates validate path identity, SI, card series, and owner parity; target conflicts and duplicate-query failures throw. | Transaction-safe and fail-closed. A missing/mismatched current assignment, malformed target, or version limit aborts the competitor update. |
| Competitor deletion | Authenticated client; [`deleteCompetitorFromFirestore`](./src/firebase.ts#L4887) | Transaction rereads competitor/assignment and retires or creates a retired assignment in the same commit as competitor deletion. | Transaction-safe and fail-closed; invalid, conflicting, or version-limited retirement throws before commit. |
| Competitor retirement | Authenticated client; [`retireCompetitorInFirestore`](./src/firebase.ts#L4961) | Transaction rereads competitor/assignment and retires or creates the matching retired assignment in the same commit as the status transition. | Transaction-safe and fail-closed; invalid, conflicting, or version-limited retirement aborts both writes. |
| Missing-assignment bootstrap | Admin client, exposed in the SI inventory UI; [`generateMissingSIAssignmentsFromFirestore`](./src/firebase.ts#L943) | Re-reads competitor and assignment in one transaction; validates path IDs, SI, card series, and owner; writes the assignment and touches the competitor in that commit. Any candidate write error is logged and rethrown, stopping the scan. | Transaction-safe and fail-closed per competitor. Prior candidate commits are not rolled back if a later candidate fails; rerun is idempotent for a valid already-matched assignment. |
| Standalone assignment create/retire exports | Former `createCompetitionSICardAssignment` and `retireCompetitionSICardAssignment` APIs | Removed. The Firestore `db` instance, assignment document-reference helpers, and `runAtomicSIAssignmentMutation` are private to `src/firebase.ts`. | No callable standalone write API or direct-SDK escape hatch remains in the repository. |
| Existing-competitor readout/result/status writes | Authenticated client; readout and punch handlers in `src/firebase.ts` | Transactions update result/status fields and receipts; they do not change SI, competitor ID, competition ID, or owner. | Not identity writers when limited to those fields. They remain subject to the existing role/rules validation. |
| Express/local season mirror | `server.ts` | Express competitor CRUD, Eventor import, IOF entry mirror, competition delete, clear-demo, and reset-seed are disabled. Restore fences competitor identities and competition-set changes; cloud-hydrate fences identity fields. Readout/result mirror can update result state but no longer creates identity. | No active Express route was found writing Firestore assignments. The server has no `firebase-admin` or Google Cloud Firestore Admin SDK dependency/use in the repository. Express state is not a trusted Firestore assignment authority. |
| Firebase Console, Admin SDK, deployed services, external clients | Outside this repository’s code | Not auditable from source. Firestore client rules do not constrain Admin SDK writers. | Trusted-writer inventory is incomplete until deployment configuration and all external service credentials/code are reviewed. |

`runAtomicSIAssignmentMutation` is now private to `src/firebase.ts`. It rereads competitor and assignment state in the transaction, rejects invalid existing owner/identity/card-series parity, and throws on skipped/conflict/partial assignment outcomes so queued competitor and assignment writes are not committed. Callbacks still perform intent-specific validation before scheduling paired writes; Firestore rules provide an additional client-side fence. This does not constrain Admin SDK writers or establish that deployed rules match the repository.

## Rule-boundary findings

- The competitor and assignment rules require an actual paired competitor create/update/delete, deny direct assignment hard delete, and compare active assignment SI, competition, competitor/document ID, card series, and owner against the post-write competitor.
- Assignment retirement validates pre-write competitor identity/card-series/owner parity. An unchanged DNS/DNF competitor no longer satisfies the assignment-mutation predicate; paired status/updatedAt updates remain supported.
- Competitor card-series changes require a matching active assignment after the commit. Duplicate competitor SI queries remain outside the rules boundary.
- Rules tests now include unchanged DNS assignment-only retirement and card-series parity cases. The suite is an exported function rather than a Vitest test file; the emulator and Firebase CLI/configuration were unavailable, so execution and deployed-rule verification remain outstanding.
- Firestore rules only protect client SDK writes when the current deployed rules match the repository. Admin SDK writes bypass them.

## Historical assignment conflicts

### Persisted inventory evidence

[`SI_ASSIGNMENT_INVENTORY.md`](./SI_ASSIGNMENT_INVENTORY.md) records a scan dated 2026-11-10:

- 1 competition, 4 competitors, and 4 assignment documents.
- 0 errors, 0 warnings, and one informational “no conflicts” result.
- It also records that Phase C0 bootstrap created missing assignments for those competitors.

That is positive evidence for the narrow scan and scope, not proof that all historical ownership conflicts are absent. The report has no scan time, per-record owner/card-series comparison, or full field-level export. The scanner used for this report does not compare assignment `ownerUid` or `cardSeries` with the competitor, nor does it validate competitor `competitorId`/`competitionId` fields against document/path IDs. The report therefore cannot rule out those mismatch classes. It also covers only the one competition listed.

### Known production conflicts vs. fixture-only cases

No unresolved production conflict row or production SI number is recorded in the repository. This means **no specific historical conflict is known from the saved evidence**, not that production has zero conflicts.

The unit-test fixtures are synthetic, not historical production records. They exercise these conflict classes:

| Conflict class represented in tests | Synthetic fixture examples | Production status |
|---|---|---|
| Duplicate SI on competitor documents | `cmp_dup_1` / `cmp_dup_2` share SI 10; `cmp_duplicate_a` / `cmp_duplicate_b` share SI 12 | No production row recorded |
| Duplicate SI represented by multiple assignment documents | SI 10 with document IDs `10` and `10-copy`; SI 8500111 with `8500111` and `8500111-copy` | No production row recorded |
| One competitor with multiple active assignments | `cmp_1` mapped to SIs 8500111 and 8500112 | No production row recorded |
| Active assignment points to missing competitor / orphan | SI 50 points to `cmp_not_found`; SI 8500113 points to `cmp_missing` | No production row recorded |
| Competitor missing an assignment / invalid or absent SI | SI 20 without assignment; missing SI and invalid SI fixture records | No production row recorded |
| Wrong competitor, mismatched SI, retired/active mismatch, wrong competition, malformed assignment/document ID, confirmed duplicate | Fixtures in `siAssignmentInventory.test.ts` and `siCardAssignments.test.ts` | No production row recorded |
| Assignment-owner mismatch and assignment/competitor card-series mismatch | Rules test includes a deliberately mismatched-owner batch and expects rejection; no live inventory fixture verifies existing data. The inventory scanner does not report these parity checks. | Unknown |

The bootstrap-created four assignments are historical writes, but the saved report does not contain evidence that each was paired atomically with a competitor mutation or that owner parity was checked.

## Remaining risks

### Uniqueness

1. The authoritative document key provides at most one assignment document per SI **within a competition**; the model does not make an SI unique across different competitions. The readiness phrase “global SI uniqueness” should mean system-wide enforcement of per-competition uniqueness across all writers, not a season-wide prohibition on the same runner using a card in separate events.
2. The duplicate competitor query in the common transaction wrapper runs before the transaction. It is diagnostic/conflict detection, not a serializable uniqueness constraint. The SI assignment document transaction is the key same-competition serialization point for callers that create/update it correctly.
3. Security rules do not query for other competitor documents with the same SI; legacy duplicate competitor rows can persist or be introduced by privileged writers.
4. Repository-local assignment mutations now use paired transactions; the standalone helpers are removed and rules check actual competitor changes and identity/card-series/owner parity. These controls are not yet emulator-verified or confirmed against deployed rules, and Admin SDK writers bypass client rules.
5. The saved four-record inventory does not compare owner or card-series parity and is limited to one competition.

### Concurrency

1. Firestore transactions can retry and serialize conflicting writes to the same assignment document; this supports one-winner behavior for canonical writers targeting the same competition/SI key.
2. Duplicate scans and bootstrap candidate planning begin outside the write transaction, but mutations reread competitors and assignments in the transaction and reject changed identity/ownership. The pre-read duplicate scan remains diagnostic; assignment-document contention is the same-SI serialization point.
3. No emulator/concurrent integration test demonstrates exactly one success for two registrations, a reassignment racing with readout/import, or bootstrap racing with competitor deletion/reassignment.
4. Different writers (legacy deployed clients, Admin SDK jobs, or stale deployed rules) can bypass client transaction assumptions. No production writer registry or deployment attestation is present.

### Rollback and partial completion

1. Firestore transactions protect only writes in that one transaction. Import and snapshot operations run per competitor and may partially complete before a later row fails; there is no whole-import rollback.
2. Bootstrap runs one transaction per candidate and stops on its first failed candidate; assignments committed for earlier candidates are not rolled back. A later rerun is safe for exact matches, but whole-scan rollback is not provided.
3. Delete/retire callbacks now abort the transaction on invalid, conflicting, or version-limited assignment retirement. Production-like rollback and client-timeout behavior have not been exercised.
4. No repository evidence establishes retry/idempotency behavior after client timeout, successful server commit with lost response, rollback rehearsal, or reconciliation of partially completed import/snapshot batches.
5. Assignment diagnostic/audit messages are console output, not a durable transaction audit log; they are insufficient as rollback evidence.

## Remaining exit evidence

1. Reconcile the six V2 ownerUid mismatches with trusted provenance and the competition owner. Confirm the three returned competition documents are the complete intended set; rerun the read-only V2 audit after resolution. Preserve historical reassignment records.
2. Execute the Firestore rules regression suite, verify the deployed rules version, and enumerate all Admin SDK/deployed writer identities. Prove none can bypass the trusted transaction boundary.
3. Run emulator and production-like concurrency, retry, timeout, rollback, bootstrap-race, and partial-import recovery tests. Record results and thresholds.
4. Retain the successful build, type-check, unit-test, and rules-test evidence for this hardening change.

Until these exit items are evidenced, keep the readiness verdict **NO-GO**.

The repository-local assignment boundary changes and exported-writer inventory are recorded in [ASSIGNMENT_BOUNDARY_HARDENING.md](./ASSIGNMENT_BOUNDARY_HARDENING.md).
