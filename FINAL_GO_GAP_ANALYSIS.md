# Final GO Gap Analysis

- Assessment date: 2026-11-11.
- Scope: non-data blockers remaining after the six ownerUid mismatches are assumed to be historical and no new mismatches are produced.
- Evidence reviewed: [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md), [OWNERUID_CORRECTION_PLAN.md](./OWNERUID_CORRECTION_PLAN.md), [FINAL_READINESS_BLOCKERS.md](./FINAL_READINESS_BLOCKERS.md), [ASSIGNMENT_BOUNDARY_HARDENING.md](./ASSIGNMENT_BOUNDARY_HARDENING.md), and repository test/configuration records.
- No production data was modified.

## Executive determination

The repository has implemented a fail-closed, per-competitor Firestore transaction boundary and paired client-rule predicates, but several claims have not been independently demonstrated against the production environment.

If the six ownerUid findings are proven historical under the adopted policy and a fresh complete inventory demonstrates no new mismatches, the following still prevent an unconditional **GO**:

1. No evidence that the Firestore rules currently deployed are the rules reviewed in the repository.
2. No complete inventory of identities and systems able to write through Admin SDKs or other privileged paths.
3. No evidence that the prior four-competition scan covers the entire intended production competition set.
4. No emulator/concurrent integration evidence for simultaneous SI claims and cross-path races.
5. No evidence for client retry, timeout, lost-response, and idempotency behavior.
6. No exercised recovery/rollback procedure for transaction aborts and intentionally partial multi-row imports/bootstrap.

These are primarily **verification and operational assurance gaps**, not proof that the current implementation is defective. Some are conditional: if the checks discover an untracked writer, stale rules, or unsafe retry/recovery behavior, that discovery becomes an implementation or architecture blocker. There is no documented objective threshold for **CONDITIONAL GO** versus **GO**; the final section proposes a gate.

Effort estimates below are approximate engineering/operations effort, excluding access approval delays, production change windows, and remediation if validation fails.

## Gap inventory

| Blocker | Current evidence | Missing evidence | Exact validation required | Estimated effort | Classification |
|---|---|---|---|---:|---|
| Deployed-rule assurance | Repository `firestore.rules` pairs assignment mutations with competitor mutations and checks SI, IDs, cardSeries, owner parity, and lifecycle. The rules regression cases cover selected owner, DNS/DNF, and card-series cases. The hardening record says the suite was not run and Firebase CLI/emulator configuration was unavailable. | The rules version actually deployed; proof it corresponds to the reviewed commit; executed positive and negative regression results against that exact ruleset. | Obtain the deployed Firebase rules release/version and project/environment identity from the authorized Firebase console or deployment system; compare its source/hash with the reviewed repository commit. Configure/use the Firestore Emulator and execute the exported `firestore.rules.test.ts` suite, including allowed paired create/reassign/retire, denied assignment-only mutation, owner mismatch, card-series mismatch, immutable owner update, and lifecycle edge cases. Save test output and release attestation. | 4–8 hours | Verification-only if versions match; operational deployment gap. Implementation blocker if deployed rules differ or tests fail. |
| Trusted-writer assurance | Repository inventory found no active Express/Admin SDK assignment writer; legacy competitor CRUD/import/delete/reset paths are disabled or redirected. Firestore rules constrain client SDK writes only. External Firebase Console, Admin SDK jobs, deployed services, and credentials are explicitly outside repository visibility. | Complete principals/service-account list, Admin SDK use and IAM grants, deployed scheduled jobs/functions/scripts, console write controls, and proof each writer routes through the validated boundary or is prohibited. | Inventory Firebase project IAM, service accounts and key usage, Cloud Functions/Run/jobs, CI deployment identities, operational scripts, and console access. For each principal record purpose, allowed collection scope, code/repository, and whether it can write competitors/assignments. Review audit logs where available; remove or constrain unnecessary write authority. Attest no unreviewed writer can mutate these collections. | 1–2 days | Operational assurance; architectural/security boundary if privileged writers bypass the canonical path. |
| Inventory coverage assurance | Authenticated V2 scan read four competition documents and reported 14 competitors/20 assignments at `2026-11-10T21:52:24.668Z`; no non-owner parity findings were reported. A newer Terräng-KM sample reportedly had no owner mismatches. | Evidence that the competition query returned every in-scope production competition, that pagination/query filters did not omit documents, and that data did not materially change after the scan. | Define the exact production project and scope. Independently count/list all competition document IDs (including pagination and archived/completed competitions if in scope); reconcile with inventory report IDs and expected set. Re-run the read-only V2 audit over that exact set, record scan time, counts, query failures, and per-competition totals, then compare before/after. | 2–4 hours | Verification-only / operational scope assurance. |
| Concurrency validation | Firestore transactions on the per-competition SI assignment document provide the intended serialization point for canonical writers. Existing transactions reread competitor and assignment state. No emulator or production-like evidence proves exactly one winner or tests cross-path races. | Reproducible contention results across the canonical create, import, readout, reassignment, retirement, and bootstrap paths; evidence that retry callbacks do not produce partial or stale identities. | In an isolated Firestore Emulator project, run repeated barriers that concurrently claim the same competition/SI through direct create vs direct create, create vs import, create vs readout, and reassignment vs readout/import. Race bootstrap against delete/retire/reassign. Assert exactly one active owner per SI, matching competitor/assignment identity and owner/cardSeries, valid lifecycle history, and no partial writes. Repeat enough times to exercise retries; record counts and failures. | 1–2 days | Verification-only if tests pass; implementation/architecture blocker if a bypass or race produces invalid state. |
| Retry validation | Firestore transactions retry on conflicts; the repository uses transactions for paired writes. Existing documentation acknowledges duplicate pre-scans occur outside transactions and does not provide recorded timeout/lost-response evidence. | Demonstrated idempotency and client behavior for transaction retry, transient failure, timeout, and server-commit/client-lost-response scenarios across all assignment-writing operations. | Use emulator fault injection or a controlled test wrapper to force transaction conflict retries, transient errors, request timeout, and a committed transaction with the response dropped. Retry the same client operation/request ID. Verify duplicate SI is not created, reassignment does not retire twice or create duplicate successors, receipts/counters remain consistent, and failures surface clearly rather than becoming success-shaped fallbacks. Record each operation's expected retry/idempotency contract. | 1–2 days | Verification-only if contracts hold; architectural/implementation work if stable idempotency keys or recovery state must be added. |
| Rollback/recovery validation | A failed Firestore transaction discards that transaction's queued writes. Delete/retire callbacks throw on invalid outcomes. Import and bootstrap are explicitly atomic per competitor, not as a whole; prior successful rows remain committed. Diagnostic logs are console output, not a durable audit record. | Tested rollback of each single transaction; tested and documented recovery for partial imports/bootstrap; operator-visible reconciliation and durable evidence after timeout/partial completion. Whole-batch rollback is not implemented and is not guaranteed. | Inject failures before commit and during later rows. Verify failed single-competitor transactions leave competitor, assignment, receipt, and counters unchanged. For multi-row imports/bootstrap, fail after known committed rows, rerun safely, and verify idempotent convergence with an explicit row-level outcome report. Exercise timeout after commit and reconcile by rereading canonical documents. Decide and document whether partial success is accepted; if all-or-nothing is required, design a staged/batched mechanism rather than claiming current rollback. | 1–3 days | Verification-only for transaction rollback; operational recovery gap for documented partial success; architectural if business requires all-or-nothing multi-row rollback. |

## Dependencies and efficient order

1. **Confirm scope and deployment identity**: obtain project ID/environment and deployed rules revision. This prevents running tests against the wrong project or accepting a repository-only result.
2. **Close deployed-rule and trusted-writer assurance**: verify current policy enforcement and enumerate privileged write authorities.
3. **Run emulator transaction/rules tests**: include concurrency and fault-injection cases in the same isolated environment.
4. **Agree on partial-operation semantics**: imports/bootstrap are per competitor by design; require safe resume and reporting unless the business explicitly requires all-or-nothing behavior.
5. **Run the complete read-only production inventory last**: confirm exact scope, scan timestamp and clean results after all writer/rule changes.

The estimates are not additive in full: rules, concurrency, retry, and rollback tests can share an emulator harness, reducing the combined implementation/validation effort if the current tests can be executed without production changes.

## What blocks CONDITIONAL GO?

If the six mismatches are accepted as historical artifacts and evidence demonstrates no new mismatches, the remaining blockers are not additional known data defects. They are the lack of evidence that the production enforcement and operational behavior match the code's assumptions:

- deployed rules have not been attested or regression-tested;
- privileged/out-of-repository writer authority is unknown;
- scan completeness is unconfirmed;
- concurrency, retries, and recovery have not been exercised.

That means **NO-GO today is caused by unclosed evidence and control-assurance gates**, not by a demonstrated failure in the current repository-local transaction code. However, the repository does not define **CONDITIONAL GO** criteria. A defensible conditional posture could be considered only after:

1. deployed rules are proven to match the reviewed policy and the rules suite passes;
2. all privileged writers are inventoried and either constrained to the canonical path or disabled;
3. a complete-scope read-only scan reports no unexplained identity/assignment conflicts (and records the six historical ownerUid cases as accepted under an explicit, evidence-backed disposition if they remain uncorrected);
4. emulator concurrency, retry, and transaction rollback tests pass, with partial import/bootstrap recovery explicitly accepted and documented.

Until those gates are satisfied, the existing **NO-GO** remains appropriate. A failed gate that reveals an active writer defect, unsafe race, or unrecoverable partial operation requires code or architecture remediation—not merely a conditional label.

## Limitations

- This assessment uses repository documents and code history; it did not inspect the live Firebase project, deployed rules, IAM, production logs, or external infrastructure.
- “No new mismatches” is an assumption in the requested scenario, not an independently established production fact.
- A build or lint pass cannot establish deployed-rule parity, trusted-writer completeness, production scan coverage, or distributed transaction behavior.
- No code, rules, production data, or canonical readiness verdict was changed by this analysis.
