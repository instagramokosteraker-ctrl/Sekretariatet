# Firestore Rules Complexity — Step 3

## Result

**FAIL.** `runFirestoreRulesDirtyDozenSuite()` still fails at `assertSucceeds(readoutAutocreateBatch.commit())` in [firestore.rules.test.ts](./firestore.rules.test.ts#L702), with the Firestore Rules 1,000-expression limit reported on the batch's competitor-create and competition-update paths. The emulator also reports an evaluation error at the SI assignment create rule ([firestore.rules](./firestore.rules#L1448)); this message does not identify a helper or explicitly attribute that rule's error to the expression limit.

## SI assignment create helper chain

The create rule at [firestore.rules](./firestore.rules#L1448) evaluates these relevant checks for the successful READOUT batch:

1. `isVerifiedUser`, `isValidId` for path IDs, `isValidSICardAssignment`, and incoming competition/SI equality checks. These are data/token checks and perform no document access.
2. `parentCompetitionExists(competitionId)` — checks the parent competition.
3. `hasCompetitorSIOrLifecycleMutationAfter(competitionId, competitorId)` — enforces that the competitor is created, deleted, or has one of the protected fields changed.
4. `assignmentCreateMatchesCompetitorAfter(competitionId, incoming())` — verifies active assignment/competitor parity from the after-state competitor, then applies either the admin path or READOUT authorization plus receipt and RunnerDb checks.

For the tested new competitor and non-admin READOUT caller, the detailed document-access calls are:

| Helper/check | `exists()` | `existsAfter()` | `get()` | `getAfter()` |
|---|---:|---:|---:|---:|
| `parentCompetitionExists` | 1 | 0 | 0 | 0 |
| `hasCompetitorSIOrLifecycleMutationAfter` create branch | 1 | 1 | 0 | 0 |
| Active assignment/competitor parity (before optimization) | 0 | 1 | 0 | 1 |
| `readoutAssignmentMatchesRunnerDb` competitor guard (before optimization) | 0 | 1 | 0 | 1 |
| Processed receipt check | 0 | 1 | 0 | 1 |
| READOUT role lookup | 1 | 0 | 1 | 0 |
| `isAdmin` lookup for this non-admin user | 1 | 0 | 0 | 0 |
| RunnerDb validation | 1 | 0 | 1 | 0 |
| **Before optimization total, executed on this batch** | **5** | **4** | **2** | **3** |
| **After optimization total, executed on this batch** | **5** | **3** | **2** | **2** |

The assignment-create authorization itself does not read the assignment document: it validates `incoming()` and uses its fields. A separate competitor-create rule calls `hasActiveSIAssignmentAfter`, which reads the assignment after-state; that is a different rule evaluation and not part of this assignment-create helper chain.

`hasCompetitorSIOrLifecycleMutationAfter`'s mutation helper also contains one syntactic `get()` and one syntactic `getAfter()`, but they are guarded by both before/after existence checks and do not execute for this create case. Those calls run for an existing competitor mutation. The helper has one executed before-state and one after-state existence check for the new competitor.

The READOUT role function checks roles in order. For this test, `READOUT` matches first, so it performs one role-assignment `exists` and one `get`; it does not continue to `FOREST` or `SPEAKER`. `isAdmin()` checks the admin profile only for this non-admin caller; a bootstrapped admin may short-circuit without that lookup.

## Duplicated work found

Before this change, the active parity helper and the READOUT helper each fetched the same competitor after-state (`existsAfter` plus `getAfter`). They also repeated assignment-vs-competitor comparisons for competition ID, SI number, card series, and owner. No assignment-document lookup was duplicated because the incoming assignment map is passed directly.

The change now loads the after-state competitor once for the active assignment-create path and passes that map to both:

- the existing active parity comparator; and
- the processed-receipt and RunnerDb identity checks.

The active parity comparison is the sole assignment-to-competitor comparison. Receipt/competitor and RunnerDb/competitor comparisons remain because they validate separate provenance/identity relationships, not duplicate assignment parity. `hasCompetitorSIOrLifecycleMutationAfter` is unchanged; paired-write enforcement remains required.

The optimized assignment-create path executes **2 fewer document-access expressions** in the tested case: one duplicate `existsAfter(competitorPath)` and one duplicate `getAfter(competitorPath)`. It also removes repeated parity field comparisons. Firestore may cache document accesses for access-call quota purposes, but this refactor removes duplicate rule expressions as well.

## Remaining expression suspects

Among the helpers used directly by the assignment create rule, the largest single validation helper by source-level predicate count is `isValidSICardAssignment(data)` ([firestore.rules](./firestore.rules#L597)). It checks required/allowed keys, field types/ranges, enum values, identity, timestamps, and optional retirement metadata. This is a source-based estimate; the emulator provides no per-helper expression count.

The assignment helper chain still includes:

- `isValidSICardAssignment`'s full schema predicate chain;
- the competitor before/after mutation predicate and assignment parity;
- `hasProcessedReadoutReceiptAfter` plus RunnerDb existence and full-name/club/card-series comparisons;
- role and parent-competition checks.

The suite's emulator output after this change explicitly reports the 1,000-expression limit on competitor create at [firestore.rules](./firestore.rules#L1685) and competition update at [firestore.rules](./firestore.rules#L1322), as well as a limit during other competitor-update cases at [firestore.rules](./firestore.rules#L1714). The assignment-create statement at line 1448 reports an evaluation error without a helper-specific count. Thus the remaining *batch-level* hotspots to pursue next are competitor create and competition update; the assignment validator is the leading source-level suspect within the SI assignment create path.

## Security impact and verification

The active assignment still must match competitor ID, competition ID, SI number, card series, and owner. READOUT creation still requires the READOUT/FOREST/SPEAKER role, matching caller owner, `source == 'READOUT'`, active state, a processed receipt, and RunnerDb full-name/club/card-series identity. The admin path still requires the existing parity checks and admin authorization. No paired-write condition or validation was removed, and no deployment was performed.

Ran `runFirestoreRulesDirtyDozenSuite()` against the test-only emulator at `127.0.0.1:8080` using project `demo-passersi-rules-test`; it exited with code 1. The emulator was stopped after the run.
