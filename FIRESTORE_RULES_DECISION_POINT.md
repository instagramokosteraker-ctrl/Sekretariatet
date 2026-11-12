# Firestore Rules Decision Point

## Decision summary

**Recommendation: Prototype competition-counter split.**

Further validator optimization is realistic only as a small cleanup, not as a likely standalone resolution of the 1,000-expression failure. Under a conservative, semantics-preserving estimate, the two validators have about **11 removable source-predicate equivalents combined** on the reported paths. The actual Rules expression meter may count these differently, and the emulator does not report the amount by which either path exceeds its limit.

The counter split is worth prototyping because it removes the entire competition-update rule evaluation from the readout-creation request while leaving the security-critical competitor/assignment/receipt writes atomic. This is diagnostic and may reduce request-wide evaluation work; it is **not guaranteed to fix the failure** if the competition update independently exceeds the limit.

No rules were changed and the suite was not rerun.

## Maximum remaining validator savings

Counts below are source-level estimates, not measured Firestore expression-meter units. The count method and validator breakdowns are in [FIRESTORE_RULES_NEXT_TARGET.md](./FIRESTORE_RULES_NEXT_TARGET.md) and [FIRESTORE_RULES_COMPLEXITY_PRIORITY.md](./FIRESTORE_RULES_COMPLEXITY_PRIORITY.md).

| Validator and failing path | Conservative, proven overlap | Conditional opportunity | Required constraints that remain |
|---|---:|---|---|
| `isValidCloudCompetitor(incoming())` on create | About **10** expanded predicate equivalents: two `isValidId` field checks (`competitorId`, `competitionId`) duplicate the validated path IDs plus incoming/path equality (8 leaves); `createdAt`/`updatedAt` timestamp checks are implied by create's equality to `request.time` (2). | Up to ~4 more leaves for `readoutReceiptId` if validation is specialized by authorization branch; the provenance path checks the ID again. Must retain equivalent validation for admin/super-admin paths that do not require receipt provenance. | Strict key set; class ID; owner UID format; numeric/text bounds; status enum; lifecycle values; punch-list shape; assignment parity; receipt provenance; RunnerDb identity. |
| `isValidCloudCompetition(incoming())` on update | About **1** predicate: `updatedAt is timestamp` is implied by `incoming().updatedAt == request.time`. | Counter ordering and range checks partially overlap with the READOUT exact-increment branch only under assumptions about the existing document. They are not safe to remove globally; admin and super-admin branches have broader update behavior. | Full schema and counter bounds, status/fee compatibility, immutable fields, and all fields editable through the other update branches. |
| **Combined conservative upper estimate** | **About 11 source-predicate equivalents** | Branch-specific factoring could save a few more, but requires preserving every role branch and existing-document behavior. | No schema, ownership, assignment, receipt, SI, or card-series checks can be dropped on the current evidence. |

### Why the other apparent overlaps are not safe removals

- **Competitor SI number/card series versus assignment checks:** the assignment may be pre-existing, so this batch's assignment validator is not guaranteed to run. The competitor must remain independently well-formed.
- **Competitor name/club/card series versus RunnerDb:** only the READOUT branch checks RunnerDb identity; administrator branches do not.
- **Competitor owner UID versus authenticated UID:** equality to `request.auth.uid` does not prove that the UID satisfies this ruleset's exact identifier-character policy.
- **Competition ID on update:** the update rule compares incoming ID to the existing document, not directly to the validated path ID. Existing documents are not independently validated by that comparison.
- **Competition count/status checks:** the READOUT transition only covers one authorization branch. It does not replace schema validation for the other update branches, and the current rules do not prove every stored resource satisfies the schema.
- **Changed-key allowlists:** these constrain which fields changed; they do not prove required fields exist or that unchanged fields in the incoming document satisfy the schema.

The ~11 estimate is deliberately conservative and does not include assumptions that all existing Firestore documents were written under the current rules. It is also small relative to two validators that each represent roughly 86 expanded source predicates, before the surrounding allow-rule conditions and helper chains.

## A. Is additional validator optimization likely sufficient?

**Assessment: B — additional validator optimization is unlikely to be sufficient by itself.**

This is not a measured mathematical proof: the emulator has not exposed per-path expression totals or the actual overage. But the maximum defensible reduction identified so far is small, both rule statements are still reported as over the limit after several earlier optimizations, and most remaining validator predicates are unique schema/integrity constraints. Removing those merely to reduce count would weaken behavior or rely on undocumented invariants about legacy data.

The exact remaining validator savings could still be worth taking later if a measured evaluation shows the overage is only a few expressions. With no such measurement, spending another iteration for roughly 11 source-level checks is a lower-value next step than testing whether the batch-wide evaluation is the main contributor.

## B. Prototype: move only the competition counter update

### Proposed boundary

Keep these three writes in one atomic commit:

1. competitor create;
2. SI assignment create;
3. processed receipt create.

Then issue the competition counter update as a separate subsequent write.

The first three are coupled by current after-state and paired-write rules: competitor creation requires the matching active assignment and receipt; assignment creation requires its paired competitor mutation. The parent counter update has no direct rule-level reference to this particular competitor and is the only write that can be removed from the batch without breaking those current checks. See [FIRESTORE_RULES_ARCHITECTURE_ASSESSMENT.md](./FIRESTORE_RULES_ARCHITECTURE_ASSESSMENT.md) and [firestore.rules.test.ts](./firestore.rules.test.ts#L647).

### Expected expression-budget reduction

- The original request would no longer evaluate the competition document's `allow update` path.
- That removed path includes `isValidCloudCompetition` (about **86 source predicates**) plus common identity guards and the successful READOUT counter branch. The exact Rules expression-meter reduction is unknown and must not be inferred from this source count.
- If the 1,000-expression error is caused by aggregate work in the four-write request, the split may reduce that request materially.
- If competition update independently exceeds the limit, its separate request will still fail. Likewise, a failure in competitor/assignment/receipt creation after the split means the competitor-side request remains over budget.

This makes the split useful as a diagnostic prototype, not a guaranteed production fix.

### Consistency and workflow risks

- **Atomicity changes:** the competitor, assignment, and receipt can commit while the counter update fails or is delayed.
- **Stale counts:** `competitorCount`/`finishedCount` can temporarily lag a successfully created competitor.
- **Retry/idempotency:** retrying a count increment after an ambiguous client/network failure could count twice unless the workflow tracks completion or uses an idempotent server-side mechanism. The current rule allows a valid counter transition independently; it does not bind it to a unique competitor creation.
- **Readout UX:** readout creation can succeed before the displayed competition totals update. The client must treat these as separate outcomes rather than report the whole operation as a single atomic success.
- **Security and Atomic SI Matching:** keeping the three coupled writes together preserves the existing competitor/assignment pairing, receipt provenance, SI/card-series parity, and owner checks. Splitting only the counter does not weaken those guarantees. No Rules authorization change is required merely to issue the already-authorized counter update separately, although application-level atomicity is reduced.

If strict counter consistency is required, a trusted server-side update with retry/idempotency handling is safer than relying on a best-effort second client write. A transaction that still evaluates all four writes as one request may not reduce the expression budget.

### Implementation effort

**Low-to-medium.** The mechanical client change is small: commit the three-write readout batch, then perform the existing counter update. Robust handling is medium effort because success, retry, duplicate submission, and partial completion need explicit treatment and focused tests. The prototype should first establish whether the three-write request succeeds and whether the isolated counter update succeeds; no such tests were run for this assessment.

## Final recommendation

**Prototype competition-counter split.**

Keep competitor, assignment, and receipt creation atomic. Move only the parent counter update in the prototype. This is the highest-value next decision point because safe validator-only savings appear limited, while the split tests the unresolved request-wide architecture hypothesis without weakening Atomic SI Matching. Treat any passing result as evidence about budget distribution, not proof that the counter split is the right long-term consistency model.
