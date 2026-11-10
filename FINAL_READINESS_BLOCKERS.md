# Final Readiness Blockers — Competitor Ownership and SI Matching

Status: reassessed 2026-11-10. This report is the evidence record for the current cutover verdict. The canonical status and prioritized blocker list remain in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).

## Verdict

**Readiness: NO-GO.**

Most first-party create/import/readout/snapshot writes pair competitor and assignment writes in Firestore transactions. That is not yet a complete trusted boundary: the repository still exposes assignment-only mutation helpers, the assignment bootstrap does not validate the competitor in its write transaction, delete/retire callers do not consistently fail closed when assignment retirement is skipped, and Firestore rules admit some assignment-only mutations for already DNS/DNF competitors. Production-wide ownership consistency, deployed-rule state, concurrency behavior, and rollback behavior are not established.

**Single highest-priority remaining blocker:** close every non-atomic and fail-open assignment mutation path behind a single trusted, fail-closed transaction boundary, and tighten rules so assignment writes require an actual matching competitor mutation. Until this is done and verified, uniqueness cannot be relied on across all writers.

## Writer and authority inventory

“Atomic SI Matching” below means that the assignment and corresponding competitor identity/lifecycle write are validated together in the same Firestore transaction. A Firestore transaction that writes only an assignment is not an atomic competitor/assignment mutation.

| Writer / operation | Authority and location | Atomic SI Matching and ownership verification | Finding |
|---|---|---|---|
| Direct competitor entry | Authenticated client; [`saveDirectCompetitionEntryToFirestore`](./src/firebase.ts#L6274) | Yes: creates competitor, active assignment, and counters in one transaction. Reads the assignment key in the transaction; validates shape/conflicts and uses matching SI, competitor ID, and owner. Duplicate competitor query is outside the transaction. | Best-covered create path. Per-competition assignment document contention serializes competing claims to the same SI when all writers use this path. |
| IOF competitor import and snapshot seed | Authenticated client; [`saveCompetitionImportToFirestore`](./src/firebase.ts#L3157), [`syncFullSeasonToFirestore`](./src/firebase.ts#L2135), shared transaction writer `writeImportedCompetitorWithAssignment` | Yes for each competitor: the shared identity writer validates an existing assignment/competitor or creates their matching pair in one transaction. It rejects import-driven SI/card-series changes. | Assignment-aware per competitor, not all-or-nothing for the whole import/snapshot; earlier rows may commit before a later row fails. |
| Readout auto-create | Authenticated client; [`submitReadoutToFirestore`](./src/firebase.ts#L5689) | Yes: competitor, active assignment, receipt, and counts are written together. Checks runner identity and assignment absence in the transaction; duplicate-competitor query is outside it. | Paired transaction is present. It still depends on deployed rules and duplicate-check behavior; no concurrent integration evidence is recorded. |
| SI reassignment / competitor update | Authenticated client; [`updateCompetitorInFirestore`](./src/firebase.ts#L4456) | SI changes use `runAtomicSIAssignmentMutation`, read current/target assignment docs, retire/reactivate/create assignment and update competitor in one transaction; target conflicts and duplicate-query failures throw. | Card-series-only updates are also accepted by this helper but do not update/validate the assignment’s `cardSeries`. The Firestore rule does not compare assignment and competitor card series. Current UI call sites found do not submit SI/card-series patches, but the exported helper and rules retain this capability. |
| Competitor deletion | Authenticated client; [`deleteCompetitorFromFirestore`](./src/firebase.ts#L4898) | Runs a transaction and attempts assignment retirement with competitor deletion. | It does not abort when `retireSIAssignmentInTransaction` returns `SKIPPED_INVALID_DATA`, `SKIPPED_CONFLICT`, or `SKIPPED_VERSION_LIMIT`; it proceeds to delete the competitor. Current rules should deny deletion without a matching retired assignment, but the application path is not fail-closed and depends on deployed rules. |
| Competitor retirement | Authenticated client; [`retireCompetitorInFirestore`](./src/firebase.ts#L4971) | Runs a transaction and attempts assignment retirement with the status transition. | It does not require the assignment outcome to be `RETIRED` or `ALREADY_RETIRED` before updating competitor status. A failed/missing assignment can therefore leave a DNS/DNF competitor with its prior active assignment. |
| Missing-assignment bootstrap | Admin client, exposed in the SI inventory UI; [`generateMissingSIAssignmentsFromFirestore`](./src/firebase.ts#L890), [`SIAssignmentInventoryView.tsx`](./src/components/SIAssignmentInventoryView.tsx#L49) | Uses a transaction, but writes only the assignment. Competitor and assignment inventories and duplicate grouping are read before each write; the transaction re-reads only the assignment document, not the competitor or its owner/identity. Assignment owner is set to the current admin. | Not Atomic SI Matching. It can act on stale competitor data and does not prove competitor-owner parity in its own transaction. Current rules block many ordinary standalone creates, but allow the lifecycle predicate to pass for an already DNS/DNF competitor; deployed rules are unverified. |
| Standalone assignment create/retire exports | Authenticated client; [`createCompetitionSICardAssignment`](./src/firebase.ts#L1036), [`retireCompetitionSICardAssignment`](./src/firebase.ts#L1101) | Direct `setDoc`/`updateDoc`, outside a transaction with the competitor. Retirement reads before writing. | No current in-repository call sites were found, but these exported write APIs remain available. Rules may permit some standalone changes for DNS/DNF competitors; remove or route them through the canonical transaction before cutover. |
| Existing-competitor readout/result/status writes | Authenticated client; readout and punch handlers in `src/firebase.ts` | Transactions update result/status fields and receipts; they do not change SI, competitor ID, competition ID, or owner. | Not identity writers when limited to those fields. They remain subject to the existing role/rules validation. |
| Express/local season mirror | `server.ts` | Express competitor CRUD, Eventor import, IOF entry mirror, competition delete, clear-demo, and reset-seed are disabled. Restore fences competitor identities and competition-set changes; cloud-hydrate fences identity fields. Readout/result mirror can update result state but no longer creates identity. | No active Express route was found writing Firestore assignments. The server has no `firebase-admin` or Google Cloud Firestore Admin SDK dependency/use in the repository. Express state is not a trusted Firestore assignment authority. |
| Firebase Console, Admin SDK, deployed services, external clients | Outside this repository’s code | Not auditable from source. Firestore client rules do not constrain Admin SDK writers. | Trusted-writer inventory is incomplete until deployment configuration and all external service credentials/code are reviewed. |

`runAtomicSIAssignmentMutation` is a transaction wrapper with a caller-provided write callback. Its mutation-diagnostic helpers and validation hooks are observability, not enforcement. The wrapper logs `enforcementActive: false`/`writesContinue: true`; correctness therefore depends on each callback and on Firestore rules. It is not, by itself, a central trusted-write service.

## Rule-boundary findings

- The competitor and assignment rules validate identity fields and require paired post-write states for common paths; direct assignment hard delete is denied.
- `hasCompetitorSIOrLifecycleMutationAfter` also returns true when the linked competitor’s post-write status is already `DNS` or `DNF`; it does not require that the competitor was changed in the same commit in those branches. An assignment-only create/update can therefore satisfy this part of the rule for some existing records.
- `assignmentMatchesCompetitorAfter` checks active assignment SI, competition, competitor/document ID, and owner against the competitor, but does not check `cardSeries`. Rules do not scan the competitor collection to enforce absence of another competitor with the same SI.
- Rules tests cover ordinary paired create/reassign/retire flows and several malformed/mismatched cases. No test covers the DNS/DNF unchanged-competitor predicate, card-series parity, historical owner mismatch, or concurrent competing transactions. The emulator suite was not run for this assessment.
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
4. Bootstrap and exported standalone assignment helpers are not consistently paired with an actual competitor mutation; rules have a DNS/DNF exception and no deployed-rule verification is available.
5. The saved four-record inventory does not compare owner or card-series parity and is limited to one competition.

### Concurrency

1. Firestore transactions can retry and serialize conflicting writes to the same assignment document; this supports one-winner behavior for canonical writers targeting the same competition/SI key.
2. Duplicate scans and bootstrap candidate plans are read outside the write transaction. Bootstrap does not reread the competitor document, its SI, or its owner inside the write transaction.
3. No emulator/concurrent integration test demonstrates exactly one success for two registrations, a reassignment racing with readout/import, or stale bootstrap against competitor deletion/reassignment.
4. Different writers (legacy deployed clients, Admin SDK jobs, or stale deployed rules) can bypass client transaction assumptions. No production writer registry or deployment attestation is present.

### Rollback and partial completion

1. Firestore transactions protect only writes in that one transaction. Import and snapshot operations run per competitor and may partially complete before a later row fails; there is no whole-import rollback.
2. Delete/retire callbacks can continue after a skipped assignment retirement. The transaction may be rejected by current rules on competitor delete, but the retire-status path can still leave an active assignment if the assignment mutation was skipped.
3. The standalone retirement helper performs a read followed by a separate write, so concurrent mutation can invalidate its decision.
4. No repository evidence establishes retry/idempotency behavior after client timeout, successful server commit with lost response, rollback rehearsal, or reconciliation of partially completed import/snapshot batches.
5. Assignment diagnostic/audit messages are console output, not a durable transaction audit log; they are insufficient as rollback evidence.

## Required exit evidence

1. Remove/disable standalone assignment write helpers and replace bootstrap with a transaction that rereads and validates the competitor and assignment, verifies owner/ID/SI/card-series parity, and commits only an allowed lifecycle pair.
2. Make delete/retire callbacks throw before any competitor write unless assignment state is confirmed as retired or already retired. Apply equivalent fail-closed checks to every SI/card-series mutation.
3. Tighten the rule predicate so an actual competitor create/update/delete is required in the commit; enforce assignment/competitor card-series parity and test unchanged DNS/DNF records explicitly.
4. Run and retain a comprehensive live inventory for every competition with owner, card-series, document-ID, SI, active/retired, and orphan consistency checks. Reconcile all reported conflicts; rerun and retain a clean report.
5. Verify the deployed Firestore rules version and enumerate all Admin SDK/deployed writer identities. Prove none can bypass the trusted transaction boundary.
6. Run emulator and production-like concurrency, retry, timeout, rollback, and partial-import recovery tests. Record results and thresholds.

Until these exit items are evidenced, keep the readiness verdict **NO-GO**.
