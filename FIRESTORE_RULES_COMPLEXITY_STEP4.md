# Firestore Rules Complexity — Step 4

## Result

**FAIL.** `runFirestoreRulesDirtyDozenSuite()` still fails at `assertSucceeds(readoutAutocreateBatch.commit())` in [firestore.rules.test.ts](./firestore.rules.test.ts#L702). The emulator reports the 1,000-expression limit at the competitor create rule ([firestore.rules](./firestore.rules#L1692)) and competition update rule ([firestore.rules](./firestore.rules#L1329)); it also reports an evaluation error at the SI assignment create rule ([firestore.rules](./firestore.rules#L1455)) without identifying a helper-specific count.

## Validator inventory

Before this change, `isValidSICardAssignment(data)` contained **50 atomic predicates** when each `isValidId(...)` invocation is counted as one helper-call predicate. These break down as:

| Category | Count |
|---|---:|
| Required/allowed key-set checks (`hasAll`, `hasOnly`) | 2 |
| Direct equality/order comparisons, including enum choices and optional-value bounds | 28 |
| Type checks | 13 |
| Optional-field presence checks | 5 |
| `isValidId` helper calls (`competitionId`, `ownerUid`) | 2 |
| **Total** | **50** |

The 28 comparison predicates include SI and version bounds, state/source enum comparisons, `competitorDocumentId == competitorId`, and optional metadata null/size checks. The two ID helper calls each expand to string, length-bound, and regex checks. This is a source predicate count, not a Firestore-emulator expression counter.

The validator does not call `exists`, `existsAfter`, `get`, or `getAfter`. All of its checks are against the incoming map.

## Duplicated checks and safe reductions

- **Competitor ID shape:** the validator checked that `competitorId` was null or a bounded string. Both create and update subsequently call parity validation, which first requires `isValidId(assignment.competitorId)`. This is stricter and rejects null, non-string, empty, oversized, or invalid-character IDs. The validator's weaker type/size check was redundant and has been removed.
- **Assignment state:** the validator accepted four states, but create and update parity accept only `ACTIVE` or `RETIRED`. The validator now checks only those two states. Its separate string-type and unsupported-state checks were redundant for both allow paths.
- **Competition ID on create:** the generic validator checked `isValidId(data.competitionId)`, while the create rule separately validates the path competition ID and requires incoming `competitionId` to equal that path value. The create path now uses `isValidSICardAssignmentForCreate`, which shares the field checks but omits the redundant incoming-ID format check. The path validation and equality check remain in the rule.
- **Competition ID on update:** retained in `isValidSICardAssignment`, because update compares incoming competition ID with the existing document, not directly with the validated path ID. Removing its format check would not be justified by the create-path invariant.
- **SI number, card series, competitor document ID, source, owner, timestamps, and optional retirement metadata:** retained. Parity and matching checks compare related values but do not replace these independent field constraints on every write path. In particular, the assignment parity comparator does not validate `competitorDocumentId`.

## Create/update split and estimated reduction

The validator is now factored into shared `isValidSICardAssignmentFields(data)`, an update-compatible `isValidSICardAssignment(data)` wrapper that keeps competition-ID validation, and `isValidSICardAssignmentForCreate(data)` for the path-validated create case. Both callers use the same common field validation; the split does not weaken update validation.

The common field predicate has **43 atomic source predicates** after removing the competitor-ID shape group, reducing the state check from five predicates to two, and moving competition-ID validity out of the shared body. The update wrapper restores its competition-ID helper check. The create rule retains its path-ID validation and incoming/path equality.

For a valid active READOUT assignment, the change removes seven source-level predicates from the create validation path. Counting the expanded `isValidId` string/length/regex checks, the estimated reduction is about **eight expression evaluations** per assignment create. This is deliberately narrow; it is not expected by itself to resolve an expression overage on another rule path. Firestore does not expose per-helper expression counts, so the exact engine reduction cannot be measured from emulator output.

## Verification

Ran `runFirestoreRulesDirtyDozenSuite()` once against the test-only emulator at `127.0.0.1:8080` using project `demo-passersi-rules-test`; it exited with code 1. The emulator still reports expression-limit failures at competitor create and competition update, plus an evaluation error at assignment create. The emulator was stopped after this run. No deployment was performed.
