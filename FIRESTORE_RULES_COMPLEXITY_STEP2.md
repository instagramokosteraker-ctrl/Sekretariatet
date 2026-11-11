# Firestore Rules Complexity — Step 2

## Result

`hasCompetitorSIOrLifecycleMutationAfter` was traced and its repeated existence checks were cached without changing its truth conditions. The suite remains **FAIL** at `assertSucceeds(readoutAutocreateBatch.commit())` in [firestore.rules.test.ts](./firestore.rules.test.ts#L702), still due to the 1,000-expression limit.

## Exact access-call inventory

In the original helper body, all calls use the same `competitorPath`:

| Call | Original static occurrences | Current static occurrences | Original runtime max on existing-document update | Current runtime max |
|---|---:|---:|---:|---:|
| `exists(competitorPath)` | 3 | 1 | 3 | 1 |
| `existsAfter(competitorPath)` | 3 | 1 | 2 | 1 |
| `get(competitorPath)` | 1 | 1 | 1 | 1 |
| `getAfter(competitorPath)` | 1 | 1 | 1 | 1 |

The three `exists` and three `existsAfter` occurrences are alternative branches of an OR, not all evaluated on every write. For the readout batch's new competitor, the first branch succeeds after just **one `exists` and one `existsAfter`**; neither `get` nor `getAfter` runs. The `get` and `getAfter` calls run only when the competitor exists both before and after the batch, to check whether the changed keys include `siNumber`, `cardSeries`, `status`, or `updatedAt`.

Other state outcomes in the original helper:

- Existing competitor deleted: 2 `exists`, 1 `existsAfter`, no `get`/`getAfter`.
- Existing competitor still present: 3 `exists`, 2 `existsAfter`, then 1 `get` and 1 `getAfter`.
- Competitor absent both before and after: 3 `exists`, 1 `existsAfter`, no `get`/`getAfter`.

## Overlap with other validation

- `assignmentMatchesCompetitorAfter` validates the competitor's **after-state** against the assignment: SI number, competitor/document identity, competition ID, card series, and owner for an active assignment. It does not establish that the competitor was created, deleted, or had one of the protected fields changed.
- `isValidCloudCompetitor` and `isValidSICardAssignment` validate incoming document schemas and field constraints. Neither compares the competitor's before/after state.
- `isValidReadoutReceipt` validates receipt shape and values. It does not enforce that an assignment mutation is paired with a competitor mutation.
- `hasActiveSIAssignmentAfter` enforces the reverse edge for a competitor create/update: an active assignment must match the competitor after the write. It does not replace the assignment rule's requirement that its own mutation be paired with a relevant competitor mutation.

Therefore, there is no duplicate predicate that can safely be removed from `hasCompetitorSIOrLifecycleMutationAfter`. The existence-state predicates enforce the paired-write boundary; the assignment parity and schema validators enforce different properties. The helper also intentionally allows `updatedAt` alone as a relevant competitor mutation, exactly as before.

## Minimal change implemented

The helper now evaluates `exists` and `existsAfter` once each into local bindings, then uses those values for its create, delete, and changed-existing-document cases. The `isValidId(competitorId)` guard remains ahead of both lookups. The diff-based check is still behind `competitorExistsBefore && competitorExistsAfter`, and its exact affected-key allowlist is unchanged. Thus:

- a new competitor still satisfies the guard only when absent before and present after;
- deletion still satisfies it only when present before and absent after;
- an existing competitor still satisfies it only when present on both sides and one of `siNumber`, `cardSeries`, `status`, or `updatedAt` changed.

Paired-write enforcement is unchanged. This reduces repeated lookups for update/delete/no-op cases, but not for the readout batch's create case, which already short-circuited after one before/after existence check.

## Verification and next hotspot

Ran `runFirestoreRulesDirtyDozenSuite()` against the test-only Firestore Emulator at `127.0.0.1:8080` using project `demo-passersi-rules-test`. It exited with code 1. The emulator still reports the expression ceiling on the batch's:

- SI assignment `allow create` at current [firestore.rules](./firestore.rules#L1427);
- competitor `allow create` at current [firestore.rules](./firestore.rules#L1671);
- competition `allow update` at current [firestore.rules](./firestore.rules#L1301).

The next likely hotspot is the SI assignment create path's **two separate active-competitor after-state comparisons**: `assignmentMatchesCompetitorAfter` fetches the competitor for parity, then `readoutAssignmentMatchesRunnerDb` fetches it again for receipt/RunnerDb and assignment checks. These are separate from the before/after mutation check above. The emulator identifies the rule statement, not an individual helper, so this is a source-traced candidate, not an emulator-attributed per-helper count.

The suite also logged a 1,000-expression denial at the competitor update rule during other suite writes; it is not one of the four writes in `readoutAutocreateBatch`. No production deployment was performed, and the emulator was stopped after the run.
