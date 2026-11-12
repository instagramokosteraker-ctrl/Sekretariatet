# Firestore Rules Architecture Assessment

## Assessment

**Confidence: MEDIUM — significant rule simplification is still required; the four-write batch likely adds pressure, but available evidence does not establish that batching alone is the cause.**

The readout operation is one four-write Firestore batch and therefore one request. Firestore documents a maximum of 1,000 rule expressions per request, as well as a 20-document-access-call limit for a multi-operation request (with a 10-call limit per operation; cached access calls may not count). See the [Firestore quotas: Security Rules](https://firebase.google.com/docs/firestore/quotas#security_rules) documentation.

The batch has four substantial rule evaluations, so the batch structure can contribute to the request-wide expression budget. However, the last connected emulator run reported expression-limit failures specifically at competitor create and competition update. It did not provide a batch-wide expression total, identify how much each operation consumed, or show whether either operation succeeds alone. Consequently:

- It is **not established** that the batch architecture by itself is incompatible with the limit.
- Splitting one write may reduce request-wide work, but would not fix a rule evaluation that independently exceeds the limit.
- More small helper/read-reuse optimizations alone are unlikely to be a reliable fix: several have already been applied, and the two reported paths still contain large schema validators and substantial authorization logic.
- The evidence supports a combination of request-wide pressure and expensive individual paths. A rule simplification or a carefully chosen split is likely needed; the split alone is not guaranteed to resolve the reported failures.

No rules were changed and the emulator suite was not rerun for this assessment.

## The four writes and their rule dependencies

The test batch is defined in [firestore.rules.test.ts](./firestore.rules.test.ts#L647).

| Write | Rule work in this batch | Must it stay in the same commit? |
|---|---|---|
| Competitor create | Full `isValidCloudCompetitor` validation; checks an active assignment through after-state; checks READOUT role, receipt provenance, and RunnerDb identity. See [firestore.rules](./firestore.rules#L1729). | **Yes, with the assignment and receipt.** Competitor create requires the matching assignment and processed receipt to exist in the commit's after-state. |
| SI assignment create | Assignment schema validation; verifies the competitor's relevant mutation and assignment/competitor parity; READOUT path also validates readout identity. See [firestore.rules](./firestore.rules#L1492). | **Yes, with the competitor.** The assignment rule requires the paired competitor mutation and matching after-state. |
| Receipt create | Receipt schema, path/owner/competition/time checks, parent lifecycle, and role authorization. See [firestore.rules](./firestore.rules#L1991). | **Yes, with competitor creation under the current rules.** The competitor rule requires receipt provenance in after-state. |
| Competition counter update | Full competition schema validation, then role, lifecycle, exact count-transition, and affected-key checks. See [firestore.rules](./firestore.rules#L1366). | **Not structurally required by the other three current rule paths.** The update rule does not bind the count increment to this specific competitor document. |

The first three writes form the security-critical atomic unit. Splitting the assignment or receipt from competitor creation would make the required `getAfter`/paired-write checks fail or require a change to those guarantees. The competition counter update is the only write that can be separated without breaking those explicit cross-document checks.

## What the evidence says about the budget

1. `isValidCloudCompetitor` and `isValidCloudCompetition` are the largest identified validators, at roughly 86 nested-helper-expanded source predicates each. These are source estimates, **not** Firestore's expression-meter counts. The estimates and their limitations are documented in [FIRESTORE_RULES_COMPLEXITY_PRIORITY.md](./FIRESTORE_RULES_COMPLEXITY_PRIORITY.md).
2. The competitor path also evaluates assignment parity and receipt/RunnerDb provenance. The assignment rule independently validates the paired assignment write. The parent update performs its own full competition validation and counter checks.
3. Prior access inventories counted 13 syntactic document-access calls in the successful competitor-create branch and 5 in the successful competition-update branch. Calls may be cached, and these counts are separate from expression counts. They do not prove that the batch exceeds the 20-call limit; the observed failure is the expression limit.
4. The emulator has identified both competitor create and competition update as failing paths, but it does not report per-write expression totals. Static source predicate counts cannot establish whether the aggregate batch is over budget, either operation independently is over budget, or both are true.

Therefore, it would be unsafe to conclude either that a smaller batch is sufficient or that the three-write readout unit is inherently impossible under Rules. The current evidence does show that just removing another repeated lookup is unlikely to be a dependable fix.

## Smallest architecture change to consider

If pursuing the batch-wide-budget hypothesis, the smallest behavioral change is:

1. Keep competitor, assignment, and receipt creation in one atomic batch.
2. Move only the competition counter update to a separate subsequent write.

This removes the parent competition update evaluation from the readout-creation request while preserving the three-way after-state and paired-write guarantees. It changes atomicity: the competitor and receipt could commit while the counter update fails or is delayed, temporarily leaving counts stale. The current rules already authorize the counter transition independently of a specific competitor create, but the client workflow would no longer make both changes all-or-nothing. If strict count consistency is required, a trusted server-side counter update or a separately designed reconciliation approach would be needed.

This split is a **diagnostic/architecture option, not a demonstrated fix**. If the competition update still exceeds the limit on its own, splitting it will not solve that failure. Likewise, if competitor create alone exceeds the limit, the create path needs rule simplification without dropping schema, ownership, assignment-parity, receipt-provenance, or RunnerDb checks.

## Recommendation

Treat the current four-write batch as a likely contributor, not the proven sole cause. Preserve the competitor/assignment/receipt atomic unit. The only safe minimal split candidate is the counter update, with the atomicity trade-off above. Because the emulator has already attributed failures to competitor create and competition update individually, prioritize significant, semantics-preserving simplification of those two rule paths as well; do not assume further micro-optimizations or the counter split alone will make the suite pass.

No deployment was performed.
