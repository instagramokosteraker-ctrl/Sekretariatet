# SI Assignment `ownerUid` Architecture Decision

- Decision date: 2026-11-11.
- Scope: meaning and use of `competitions/{competitionId}/siCardAssignments/{siNumber}.ownerUid`.
- Evidence reviewed: [OWNERUID_SEMANTICS_REVIEW.md](./OWNERUID_SEMANTICS_REVIEW.md), [ATOMIC_SI_MATCHING_DESIGN.md](./ATOMIC_SI_MATCHING_DESIGN.md), [ASSIGNMENT_BOUNDARY_HARDENING.md](./ASSIGNMENT_BOUNDARY_HARDENING.md), [FINAL_READINESS_BLOCKERS.md](./FINAL_READINESS_BLOCKERS.md), current Firestore rules, assignment writers, and V2 inventory.
- No production or application data was modified.

## Decision

**Recommendation: Adopt ownership semantics.**

Define assignment `ownerUid` as the owner UID of the competitor currently linked by the assignment. For a resolved assignment, require:

```text
assignment.ownerUid == linkedCompetitor.ownerUid
```

For unresolved assignments, the model must define a separate policy; do not infer a competitor owner where there is no linked competitor.

This is the best fit for the current system because the assignment is a canonical identity mapping to a competitor, and the current transaction validators and Firestore rules deliberately bind the assignment's owner, SI, card series, and competitor IDs to that competitor. `ownerUid` is used as an ownership/authorization consistency field in those controls, not as reliable authorship metadata. If creator attribution or last-editor auditing is required, add a separate `createdByUid` and/or audit event rather than overloading `ownerUid`.

This is an architecture recommendation based on current implementation and security boundaries. It does not retroactively prove that every historical mismatch is wrong or identify the authoritative owner for an individual record. Existing data corrections require the linked competitor owner to be independently confirmed and must use the canonical transaction boundary.

## 1. Business purpose of assignment `ownerUid`

Under this decision, `ownerUid` has one purpose: **keep the assignment's ownership scope consistent with the competitor it identifies**. It supports:

- detecting assignments associated with a different ownership scope than their linked competitor;
- validating that assignment and competitor identity are not split across owners during create, reassignment, import, bootstrap, retirement, and reactivation;
- enforcing the same ownership value in Firestore rules for client writes.

It is not the SI uniqueness key; the competition-scoped SI assignment document is the serialization point. It is not a complete audit trail of who performed a mutation. `source`, `createdAt`, and `updatedAt` provide limited operation/timing context, but do not identify the authenticated actor or build. If audit attribution is a business requirement, it needs explicit creator/editor fields or an append-only audit record.

## 2. Why ownership semantics are preferred over creator semantics

Creator semantics are supported by the current wording in design section 1.3, which calls `ownerUid` “the verified administrator who created the assignment; stable across updates.” However:

- current canonical writers usually take the value from the competitor identity, not from the authenticated actor;
- the assignment is a routing/identity record for a competitor, and all current identity match helpers treat owner as part of the linked identity;
- transaction hardening and Firestore rules require owner parity when validating the linked competitor;
- the V2 audit intentionally compares assignment and competitor owner values.

Thus the repository's implemented security contract is ownership parity, while the old design text describes creator attribution. Retaining creator semantics would require changing the current rules and transaction contract and still would not provide consistent attribution: some current paths stamp the competitor owner, some import paths stamp the same incoming owner on both records, and historical reassignment code stamped the authenticated context UID. No separate `createdByUid` currently preserves those distinctions.

## 3. If creator semantics were adopted instead

The following enforcement would be incompatible with a creator UID that may differ from the competitor owner:

- `hasActiveSIAssignmentAfter` in `firestore.rules` requires assignment owner and competitor owner to match.
- `assignmentMatchesCompetitorAfter` requires owner equality for active assignments and pre-write equality during retirement.
- `assignmentMatchesCompetitorIdentity` and `assertSIAssignmentMatchesCompetitor` compare assignment owner to the competitor-derived identity.
- The import, bootstrap, mutation, and retirement paths reject mismatched owner values through these helpers.
- Rules tests and unit tests that expect a different assignment UID to be rejected would need revision.

Create authorization would also need a coherent creator policy: require `ownerUid == request.auth.uid` for every assignment creator, including admin flows, or define the trusted server behavior. Current paths that populate from the competitor owner would not reliably identify the actor. Creator must then be immutable, including on reactivation; otherwise the field is not consistently “the creator.”

The V2 `ASSIGNMENT_OWNER_UID_MISMATCH` findings would no longer be valid as integrity failures. They would remain factual differences, but could only be judged against a separately recorded assignment creator or the creator's authorization context. The six cases in [LIVE_INTEGRITY_INVENTORY_V2.md](./LIVE_INTEGRITY_INVENTORY_V2.md) would therefore cease to be P0 solely due to parity. Other independent inventory findings (identity, SI, card series, lifecycle, orphan, duplicate) would remain valid. The existing reports do not establish which actor created each historical assignment.

## 4. If ownership semantics are adopted

The following design statement is obsolete and must be replaced:

- [ATOMIC_SI_MATCHING_DESIGN.md](./ATOMIC_SI_MATCHING_DESIGN.md), section 1.3: “the verified administrator who created the assignment; stable across updates.”

The section 1.4 index/query by `ownerUid` is not inherently obsolete, but its intent must be restated: it filters assignments by linked competitor ownership, not by creator. It must not be used as an authorship/audit query.

The creator interpretation in historical explanations is also superseded: prior writes that used `context.ownerUid` were incorrect for the chosen ownership contract if that UID differed from the linked competitor owner. The active parity mismatches identified by V2 are:

| Competition | SI | Assignment state | Required disposition |
|---|---:|---|---|
| Reflexcup#2 | 8501992 | ACTIVE | Verify competitor owner authority; then transactionally reconcile assignment owner if confirmed |
| Reflexcup#2 | 8502410 | ACTIVE | Verify competitor owner authority; then transactionally reconcile assignment owner if confirmed |
| Reflexcup#2 | 8509112 | ACTIVE | Verify competitor owner authority; then transactionally reconcile assignment owner if confirmed |
| Reflexcup#2 | 8509448 | ACTIVE | Verify competitor owner authority; then transactionally reconcile assignment owner if confirmed |
| Lång-TM | 123456 | ACTIVE | Verify competitor owner authority; then transactionally reconcile assignment owner if confirmed |
| Lång-TM | 234567 | ACTIVE | Verify competitor owner authority; then transactionally reconcile assignment owner if confirmed |

The Lång-TM retired predecessor assignments already match their respective competitor owner values according to [OWNERUID_FORENSIC_ANALYSIS.md](./OWNERUID_FORENSIC_ANALYSIS.md); they are not identified as parity mismatches in that scan. The four Reflexcup assignments are associated with the early bootstrap period. These are provenance clues, not authorization to correct data. Do not rewrite `createdAt`, `source`, or retirement history to imply a different creator.

## 5. Requirement by system concern

| Concern | Is ownerUid parity required? | Decision |
|---|---|---|
| Ownership enforcement | **Yes, under the selected ownership semantics.** | The assignment must not claim a different ownership scope from its linked competitor. Authorization still derives from verified roles/competition permissions; matching UIDs alone is not sufficient authorization. |
| Atomic SI Matching | **Not intrinsically required for SI uniqueness, but required by this ownership contract.** | Atomicity requires paired identity/lifecycle writes and validation of SI, competitor/document IDs, card series, and state. Ownership parity is an additional invariant that every paired transaction must preserve. |
| Firestore rule validation | **Yes, for client writes under this policy.** | Rules should keep assignment owner aligned with the post-write competitor (and pre-write competitor for retirement), while also checking the relevant permissions and paired mutation. Admin SDK writers remain outside client-rule enforcement. |
| Lifecycle handling | **Yes while the assignment is linked to a competitor.** | Retire/reassign preserves the owner of the same competitor; reactivation must set the owner from the reactivated linked competitor. A transfer of competitor ownership, if allowed, must update linked assignments atomically or be rejected. Creator/editor attribution belongs in separate audit fields. |

## 6. Required documentation and operational follow-up

This decision resolves the target meaning, but does not implement the migration or close readiness blockers. Before treating the policy as fully established:

1. Amend section 1.3 of `ATOMIC_SI_MATCHING_DESIGN.md` to the ownership definition and specify the unresolved-assignment case.
2. Keep the existing identity parity checks and their tests; add/update tests for owner transfer and reactivation under the selected semantics.
3. Keep the six mismatches visible as ownership-parity findings. Confirm each competitor's owner from an authoritative source before any production correction.
4. Correct confirmed mismatches only through a transaction that rereads the competitor and assignment and preserves lifecycle/history fields.
5. Re-run the complete V2 inventory and separately verify deployed rules and non-client writers.
6. If creator/editor audit is required, add explicit audit metadata in a coordinated schema change; do not repurpose assignment `ownerUid`.

**Readiness remains NO-GO** until the six active parity findings are resolved or authoritatively explained, and the other trusted-writer, deployed-rule, inventory-coverage, and concurrency/rollback blockers in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md) are closed. This decision does not modify production data or itself change readiness.
