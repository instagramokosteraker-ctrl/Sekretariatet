# Firestore Rules Complexity Priority

## Scope and limitations

This is a static estimate from the current `firestore.rules`, with the last known failing batch described in [firestore.rules.test.ts](./firestore.rules.test.ts#L647). The emulator reports that competitor create and competition update exceed the 1,000-expression ceiling, but it does not report the expression total, remaining budget, or a per-helper breakdown. Therefore, an exact remaining budget cannot be measured from available output.

For comparison, a **source predicate** here is a leaf condition in a helper (`is int`, equality, range bound, key-set check, etc.); `&&`/`||` connectors are not separate predicates. The direct count treats a nested helper call as one predicate. The expanded estimate substitutes its body and is intended to show relative size, not Firebase's precise expression-meter behavior. Access counts are listed separately.

## Ranked top 10 helpers

Ranked by estimated nested-helper-expanded predicate count. These counts describe the entire helper definition; the “failure-path contribution” column indicates whether it runs on either of the two known failing writes.

| Rank | Helper | Direct source predicates | Expanded estimate | Direct document accesses | Relative contribution to the known failures |
|---:|---|---:|---:|---|---|
| 1 | `isValidCloudCompetition(data)` ([firestore.rules](./firestore.rules#L247)) | ~86 | ~86 | None | **Very high** on competition update; called once for every update evaluation. |
| 2 | `isValidCloudCompetitor(data)` ([firestore.rules](./firestore.rules#L441)) | ~71 | ~86 | None | **Very high** on competitor create; full schema validation runs. |
| 3 | `isValidClubSettings(data)` ([firestore.rules](./firestore.rules#L190)) | ~47 | ~63 | None | None on either failing path; nested logo/color/optional-ID helpers expand its cost. |
| 4 | `isValidReadoutReceipt(data)` ([firestore.rules](./firestore.rules#L1917)) | ~39 | ~54 | None | Separate receipt-create rule in the same batch, not called by competition update; competitor creation checks receipt provenance separately. |
| 5 | `isValidSICardAssignment(data)` / `isValidSICardAssignmentFields(data)` ([firestore.rules](./firestore.rules#L597), [firestore.rules](./firestore.rules#L606)) | ~43 shared; ~44 for update wrapper | ~46 shared; ~50 for update wrapper | None | Separate assignment-create evaluation in the batch; not directly called by competitor create or competition update. |
| 6 | `isValidStationPunch(data)` ([firestore.rules](./firestore.rules#L2170)) | ~34 | ~49 | None | None on either failing path. |
| 7 | `isValidCloudClass(data)` ([firestore.rules](./firestore.rules#L387)) | ~34 | ~46 | None | None on either failing path. |
| 8 | `isValidCloudStation(data)` ([firestore.rules](./firestore.rules#L2027)) | ~36 | ~45 | None | None on either failing path. |
| 9 | `isValidCloudRunnerDbEntry(data)` ([firestore.rules](./firestore.rules#L547)) | ~33 | ~39 | None | Not called by the readout identity path; that path compares selected RunnerDb fields instead. |
| 10 | `isValidAdminInvite(data)` ([firestore.rules](./firestore.rules#L106)) | ~27 | ~30 | None | None on either failing path. |

The expanded estimate adds the bodies of helpers such as `isValidId`, `isValidOptionalId`, `isValidLogoDataUrlField`, and `isValidHexColorField`. For example, `isValidCloudCompetitor` has about 71 direct predicates plus five `isValidId` calls whose bodies add roughly 15 predicates. `isValidCloudCompetition` has about 86 direct predicates and does not rely on nested validation helpers for its main field checks. These are close in expanded size.

Other sizable validators just outside this top 10 include `isValidRoleInvite` (~29 expanded), `isValidCloudCourse` (~29), and `isValidRoleAssignment` (~28). They do not execute in the two failing rule paths.

## Important path helpers outside the top 10

These are smaller by source predicate count, but matter because they execute inside competitor creation or the related batch writes.

| Helper | Estimated direct / expanded predicates | Accesses in its active READOUT path | Relative contribution |
|---|---:|---|---|
| `readoutCompetitorIdentityMatchesRunnerDbData` ([firestore.rules](./firestore.rules#L866)) | ~14 direct / ~17 expanded, including receipt and RunnerDb comparators | Inclusive chain: 1 `existsAfter` + 1 `getAfter` for receipt, 1 `exists` + 1 `get` for RunnerDb | Medium-high on competitor create; verifies receipt provenance and runner identity. |
| `hasActiveSIAssignmentForCompetitorAfter` ([firestore.rules](./firestore.rules#L695)) | ~8 inclusive, plus path and access guards | 1 `existsAfter` + 1 `getAfter` for assignment | Medium on competitor create; the competitor map is `incoming()` so this path does not read it after-state again. |
| `activeSIAssignmentMatchesCompetitorCreate` ([firestore.rules](./firestore.rules#L715)) | 7 field predicates | None | Low-medium; validates active state and assignment-to-competitor identity, ownership, SI, and card-series parity. |
| `canCreateReadoutCompetitor` ([firestore.rules](./firestore.rules#L824)) | 3 role-helper calls; roughly 8 checks when READOUT matches first, up to 3 role checks otherwise | READOUT success: 1 `exists` + 1 `get` for role assignment; at most 3 syntactic role checks | Medium; gates readout writes. Competition update has two syntactic call sites, but only one runs for the successful counter branch. |
| `hasProcessedReadoutReceiptAfter` ([firestore.rules](./firestore.rules#L838)) | ~8 direct / ~11 expanded with ID validation | 1 `existsAfter` + 1 `getAfter` for receipt | Medium as part of readout identity validation. |
| `processedReadoutReceiptMatchesCompetitor` ([firestore.rules](./firestore.rules#L830)) | 5 comparisons | None | Low; checks receipt status, competitor, SI, card series, and owner. |
| `runnerDbMatchesReadoutCompetitor` ([firestore.rules](./firestore.rules#L849)) | 5 comparisons | None | Low-medium; compares name, club (including `Klubblös` mapping), and card series. |
| `hasActiveSIAssignmentAfter` ([firestore.rules](./firestore.rules#L678)) | ~11 matcher checks plus existence guards | Active update path: 2 `existsAfter` + 2 `getAfter` (assignment and competitor) | Relevant to competitor updates, not the current competitor-create path, which uses the incoming-map variant. |
| `hasCompetitorSIOrLifecycleMutationAfter` and `competitorSIOrLifecycleMutationExistsAfter` ([firestore.rules](./firestore.rules#L744), [firestore.rules](./firestore.rules#L751)) | Low, roughly 8–12 depending on branch | New competitor: 1 `exists` + 1 `existsAfter`, no `get`/`getAfter`; existing change branch adds 1 `get` + 1 `getAfter` | Required by assignment writes; not the largest expression component of the two failing rules. |

On the successful READOUT competitor-create evaluation, the current static access inventory from [FIRESTORE_RULES_COMPLEXITY_STEP5.md](./FIRESTORE_RULES_COMPLEXITY_STEP5.md) is 5 `exists`, 2 `existsAfter`, 4 `get`, and 2 `getAfter`. On the successful competition counter update, [FIRESTORE_RULES_COMPLEXITY_STEP6.md](./FIRESTORE_RULES_COMPLEXITY_STEP6.md) records 4 `exists`, 0 `existsAfter`, 1 `get`, and 0 `getAfter`. Repeated calls to the same document path may be cached for access-call limits; the counts above are expression-level call sites along the evaluated branch.

## Relative budget assessment

- The competition update's principal cost is the single large `isValidCloudCompetition` validator, followed by its authorization/counter branches. For the READOUT update in the batch, admin allowlists and the second counter branch short-circuit.
- The competitor create's principal cost is the similarly large `isValidCloudCompetitor` validator **plus** assignment parity and receipt/RunnerDb checks. Its readout branch executes those checks on this batch.
- Other high-count validators are not contributors to these two rule evaluations, even if they rank highly across the whole file.
- The batch also evaluates the receipt and assignment writes separately. Their schema validation counts contribute to their own rule evaluations; they are not added to the competitor-create or competition-update helper totals.

## Next single-helper priority

If choosing strictly by source predicate count, **`isValidCloudCompetition(data)` is the next helper to profile/optimize**, at about 86 direct predicates. `isValidCloudCompetitor(data)` is effectively tied after nested `isValidId` expansion, at roughly 86 expanded predicates, and it remains the more expensive *path* overall because it is followed by assignment and readout identity validation.

That ranking identifies where another optimization could have the largest potential effect; it does not establish that any schema predicate is redundant or safe to remove. The emulator supplies no measured helper-level budget, so a change should first be justified by exact equivalence to checks already enforced in the same update path. No rule change or suite run was made for this inventory.
