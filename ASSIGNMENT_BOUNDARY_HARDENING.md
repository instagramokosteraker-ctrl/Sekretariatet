# Assignment Boundary Hardening

Status: implemented in the repository on 2026-11-10. This report records the local code and rules changes; it does not attest production data or deployed rules.

## Outcome

Every repository-local SI assignment mutation now occurs in a Firestore transaction that reads the corresponding competitor document in that transaction. The mutation path validates competition/document identity, SI number, card series, and `ownerUid` parity before writing. Assignment conflicts, invalid data, version limits, and write failures abort the transaction instead of allowing a competitor-only or assignment-only result.

The standalone `createCompetitionSICardAssignment` and `retireCompetitionSICardAssignment` exports were removed. The Firestore `db` instance, assignment document-reference helpers, and `runAtomicSIAssignmentMutation` are private to [src/firebase.ts](./src/firebase.ts), closing the in-repository direct-SDK escape hatch.

## Exported writer inventory

“Fail-closed” means an invalid or unsuccessful assignment operation throws before the Firestore transaction commits. For batch-style operations, transaction scope is stated separately.

| Exported function / path | Assignment operation | Classification | Transaction checks and failure behavior |
|---|---|---|---|
| `generateMissingSIAssignmentsFromFirestore` | Bootstrap missing active assignments | Transaction-safe; fail-closed per competitor | Each candidate transaction rereads competitor and assignment. It validates path IDs, SI, card series, and owner from the competitor document; writes assignment plus competitor `updatedAt` together. A failed candidate is logged and rethrown, stopping the scan. Earlier candidate commits are not rolled back. |
| `saveDirectCompetitionEntryToFirestore` | Create competitor and active assignment | Transaction-safe; fail-closed | Reads competitor and assignment within the atomic mutation transaction. Validates the intended competitor identity and writes matching SI/card series/owner in the same commit. Duplicate-query errors and assignment conflicts throw. |
| `saveCompetitionImportToFirestore` | Import create or same-identity update | Transaction-safe per competitor; fail-closed | Uses private `writeImportedCompetitorWithAssignment`. Its transaction rereads competitor and assignment. Creates validate assignment-to-new-competitor parity; updates validate stored path identity, SI, card series, and owner and reject import identity changes. A row failure aborts that row transaction; earlier imported rows are not rolled back. |
| `syncFullSeasonToFirestore` | Snapshot seed of missing competitors | Transaction-safe per competitor; fail-closed | Uses the same private import writer for each seed. Existing identity mutation/deletion is blocked. Each seed transaction pairs competitor and assignment; a later seed failure does not roll back earlier seeds. |
| `submitReadoutToFirestore` (auto-create branch) | Create competitor and active assignment | Transaction-safe; fail-closed | The atomic transaction checks the competitor path, assignment absence, runner identity, duplicate candidates, and receipt state, then writes competitor, assignment, receipt, and counters together. Conflict receipts are explicitly `UNKNOWN` and do not create an assignment or competitor. |
| `updateCompetitorInFirestore` | Reassign SI or change card series | Transaction-safe; fail-closed | Reassignment rereads competitor and old/target assignments. It validates current parity and the target state, updates old/target assignment and competitor together, and aborts on conflicts, malformed records, duplicate-check failure, or version limits. A card-series-only change updates the assignment in the same transaction. |
| `deleteCompetitorFromFirestore` | Retire assignment and delete competitor | Transaction-safe; fail-closed | Rereads competitor and assignment. Retirement validates matching SI, card series, owner, and IDs; malformed/conflicting/version-limited outcomes throw before the competitor delete can commit. |
| `retireCompetitorInFirestore` | Retire assignment and competitor status | Transaction-safe; fail-closed | Rereads competitor and assignment. Assignment retirement and competitor status update share a transaction; invalid, conflicting, or version-limited retirement throws and aborts both. |

### Removed or non-mutating exports

| Function/API | Status |
|---|---|
| `createCompetitionSICardAssignment` | Removed; no standalone assignment creation API remains. |
| `retireCompetitionSICardAssignment` | Removed; no standalone assignment retirement API remains. |
| `db`, `getCompetitionSICardAssignmentRef` / `getCompetitionSICardAssignmentsCollection` | No longer exported; private implementation capability/helpers only. |
| `runAtomicSIAssignmentMutation` | No longer exported; private transaction boundary. |
| `ensureCompetitionSICardAssignmentSchema` | Does not mutate an assignment. It writes schema metadata under `_schema/siCardAssignments`. |
| Assignment lookup, inventory scan, validation, and preview exports | Read-only with respect to `siCardAssignments`. |

## Shared enforcement

- The private transaction wrapper rereads competition, competitor, and relevant assignment documents. Existing competitor records must match their path IDs and contain valid SI, card series, and owner fields. An existing current assignment must match those fields and be in an allowed lifecycle state.
- `assignmentMatchesCompetitorIdentity` compares competition, SI number, competitor and assignment-document IDs, card series, and owner UID.
- All skipped/conflict/partial assignment outcomes are rejected in the transaction callback. Firestore therefore discards assignment writes and any competitor writes already queued in that callback.
- Retirement either writes a matching retired assignment or confirms it is already retired; it throws for malformed data, ownership conflicts, or version exhaustion.
- Firestore rules now require a competitor create/delete or an actual relevant update in the same commit, including for DNS/DNF records. Active assignment state must match competitor SI, card series, owner, and IDs. Retirement checks pre-write parity. Card-series-only competitor changes require a matching assignment after the commit.
- The duplicate competitor query remains outside the transaction and is not the uniqueness serialization mechanism. The per-competition assignment document is the serialization point for canonical same-SI claims.

## Validation and remaining limitations

- `npm run build`: passed.
- `npm run lint`: passed.
- `npx vitest run src/utils/siCardAssignments.test.ts`: passed, including SI, competitor, card-series, and owner parity cases.
- The Firestore rules suite was not executed: `firestore.rules.test.ts` exports a custom suite rather than registering Vitest tests, and Firebase emulator CLI/configuration is unavailable in this workspace. The added DNS/DNF and card-series rules cases therefore still require emulator execution.
- The bootstrap and imports are atomic per competitor, not as a whole multi-row operation. Previously committed rows remain if a later row fails.
- Production inventory, deployed-rule version, external/Admin SDK writers, concurrent production-like races, and timeout/rollback behavior remain unverified. These keep readiness at **NO-GO**.

## Next blocker

Produce and retain a comprehensive live inventory across every competition, checking competitor and assignment path IDs, SI, card series, owner UID, lifecycle state, duplicates, and orphans. Reconcile all mismatches before cutover.

See the canonical blocker order in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md) and the evidence assessment in [FINAL_READINESS_BLOCKERS.md](./FINAL_READINESS_BLOCKERS.md).
