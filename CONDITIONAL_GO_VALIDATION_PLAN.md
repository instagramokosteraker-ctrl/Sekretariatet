# Conditional GO Validation Plan

- Assessment date: 2026-11-11.
- Scope: deployed rules, trusted writers, production inventory coverage, concurrency, retries, and rollback/recovery.
- Evidence reviewed: [FINAL_GO_GAP_ANALYSIS.md](./FINAL_GO_GAP_ANALYSIS.md), [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md), and [FINAL_READINESS_BLOCKERS.md](./FINAL_READINESS_BLOCKERS.md).
- No code changes or production writes were made for this plan.

## Proposed CONDITIONAL GO gate

The repository does not currently define a formal CONDITIONAL GO standard. For this plan, a conditional decision would mean the system is allowed to continue limited, monitored operation while explicitly accepted residual risks remain; it is **not** equivalent to declaring full cutover safe.

Before considering CONDITIONAL GO:

1. The six ownerUid differences must be formally dispositioned as historical under the adopted ownership policy, with an approved rationale and no evidence of new mismatches. This plan does not authorize or perform corrections.
2. Deployed rules must be verified to match reviewed source, and the rules regression suite must pass.
3. Every principal with write authority to competitors or SI assignments must be identified and either constrained to the canonical path or explicitly disabled.
4. A complete-scope read-only inventory must complete successfully, with no unexplained identity, SI, card-series, lifecycle, orphan, duplicate, or new owner-parity findings.
5. Emulator validation must pass the minimum concurrency, retry, and transaction rollback criteria below.
6. Accepted partial import/bootstrap behavior and the monitoring/response owner must be documented.

Any failed test that reveals a current bypass, incorrect assignment, partial single-transaction write, or unexplained mismatch is a remediation blocker, not a basis for a conditional waiver. **GO** would require all production rollout controls and residual risks to be closed under the canonical readiness policy.

## Validation work packages

| Rank | Activity | Exact procedure | Required tooling and access | Pass / fail criteria | Effort | Dependencies |
|---:|---|---|---|---|---:|---|
| 1 | Deployed Firestore rules | Identify Firebase project/environment and obtain the deployed Firestore Rules release/revision and effective time from Firebase Console or deployment pipeline. Retrieve the exact deployed rules source (or verifiable source artifact/hash) and compare with the reviewed repository `firestore.rules`. Execute the repository's exported `runFirestoreRulesDirtyDozenSuite()` and assignment-specific positive/negative cases against the Firestore Emulator. | Authorized Firebase Console/project access; deployment history/artifact; Firebase CLI and Firestore Emulator; `@firebase/rules-unit-testing`; Node/TypeScript runner for the exported suite. The repo currently has no dedicated rules-test npm script and notes the suite was not run. | **Pass:** exact deployed rules are attributable to reviewed source; all expected valid paired mutations succeed; assignment-only, owner/SI/cardSeries/ID mismatch, invalid retirement, and unauthorized writes fail; no unexpected allow/deny. Save revision, test output, and date. **Fail:** deployed source cannot be identified, differs without review, emulator tests fail, or production rules are stale. | 0.5–1 day | Project identity and authorized read access; emulator available. |
| 2 | Trusted writer inventory | Inventory IAM principals, service accounts, key usage, Firebase Console roles, Cloud Functions/Run/jobs, CI identities, external scripts and client applications. For each principal with Firestore write capability, record owner, purpose, collections, code/repository, and whether writes use the canonical transaction. Review available audit logs for writes to `competitions/*/competitors/*` and `siCardAssignments/*`. Disable/restrict unnecessary write authorities or document and test each approved writer. | Firebase/IAM read-only access; Cloud Audit Logs; Cloud Functions/Run/job inventory; CI/deployment configuration; service account/key inventory; repository search; accountable system owner. No production writes are required to inventory. | **Pass:** every privileged and client writer is named; all privileged writers are either constrained to an approved canonical implementation or have no write permission; no unexplained assignment/competitor write source appears in available logs; residual log-retention gaps are recorded with compensating controls. **Fail:** unknown principal/service, unrestricted Admin SDK writer, unexplained log activity, or no accountable owner. | 1–2 days | Project identity; access to IAM, deployed services, and CI metadata. |
| 3 | Complete inventory coverage | Define in-scope project, environment, and competition lifecycle states. Independently enumerate/count all competition document IDs using pagination and reconcile against the scan input/output. Run the V2 read-only inventory across the exact set, recording query failures and per-competition totals. Compare snapshot time/counts with the expected competition register and repeat if writes occur during scanning. | Existing authenticated `SIAssignmentInventory` support; authorized read-only Firestore account; project/environment identification; read-only competition register or documented scope; report storage with sensitive UIDs access-controlled. | **Pass:** every in-scope competition ID is represented exactly once; no query/pagination/read failures; competitor/assignment totals reconcile to source queries; zero unexplained structural/integrity findings and zero new ownerUid mismatches. The six historical cases may remain only with explicit accepted disposition. **Fail:** missing competition, inaccessible collection, incomplete pagination, unexplained counts/findings, or stale scan. | 0.25–0.5 day | Scope definition and read-only production access; trusted-writer/rule changes should be complete before final scan. |
| 4 | Concurrency behavior | In an isolated Firestore Emulator project, coordinate simultaneous writes with barriers. Exercise direct create vs direct create, create vs import, create vs readout, reassignment vs readout/import, and bootstrap vs retire/delete/reassign. Run each scenario at least 100 times with fresh competition/SI fixtures. Inspect final competitor, assignment, receipt/counter, and lifecycle state. | Firestore Emulator; Firebase CLI; rules-unit-testing or emulator client harness; deterministic barrier/fault harness; test fixtures. No production write or real competitor data. | **Pass:** every same-SI race has exactly one accepted active owner; all committed competitor-assignment pairs match IDs, SI, cardSeries, owner, and state; losing/conflicting requests fail explicitly; no dangling assignment, duplicate active owner, or partial write. All 100 repetitions per scenario meet invariants. **Fail:** any invalid committed state, ambiguous success, or unhandled race. | 1–2 days | Deployed-rule source comparison; emulator bootstrapped; test credentials/fixtures. |
| 5 | Retry and timeout behavior | Force transaction contention/retries and transient failures. Simulate timeout before commit and response loss after a confirmed emulator commit, then repeat the exact logical operation/request ID for create, reassignment, import row, readout, retirement, and bootstrap. Re-read canonical records after each attempt; validate receipt and count projections where applicable. | Firestore Emulator; retry/fault-injection wrapper or test proxy; deterministic request IDs for readout; structured test logs; client API test harness. | **Pass:** retries do not duplicate SI ownership, retire twice, create multiple successors, double-count competitors/finishers, or create duplicate receipts; post-commit response loss is resolved by reread/idempotent retry; pre-commit errors remain explicit and leave no partial writes. Document behavior per API. **Fail:** repeated requests create duplicates, report false success, leave ambiguous state, or cannot determine commit outcome. | 1–2 days | Concurrency harness; operation-level idempotency expectations; emulator. |
| 6 | Rollback and recovery | Inject failure before commit in each single-competitor transaction; assert no paired or projected writes committed. For import/bootstrap, deliberately fail after a known subset of rows commits, capture row outcomes, rerun safely, and verify convergence. Simulate client timeout after commit and recover by rereading canonical documents. Decide whether per-row partial success is acceptable; do not imply whole-batch atomicity. | Firestore Emulator; failure injection; import/bootstrap test fixtures; row-level result capture; V2 inventory; documented operator runbook. | **Pass:** failed individual transactions leave competitor, assignment, receipt/counters unchanged; committed rows remain valid; rerun is idempotent and converges without duplicate identities; partial progress is observable and recoverable; no unexplained state remains after reconciliation. **Fail:** partial single transaction, irreconcilable row state, silent failure, or business requirement for all-or-nothing behavior not met. | 1–3 days | Retry harness; explicit acceptance of per-competitor atomicity; transaction test coverage. |

Effort estimates are engineering time and exclude access approvals, deployment windows, or remediation after failed validation. Work packages 4–6 can share the emulator harness. Estimated combined validation effort is approximately **3–6 engineering days** if current code passes; failures may add implementation and revalidation effort.

## Dependencies and sequencing

1. **Declare scope and project identity.** Establish the exact Firebase project, production environment, competition lifecycle scope, and responsible approver. This is a prerequisite for both deployed-rule verification and the inventory.
2. **Verify deployed rules and enumerate writers in parallel.** Both depend on project identity and authorized read access. If either finds a bypass or stale policy, stop and remediate before acceptance testing.
3. **Prepare an isolated emulator test harness.** Run rules tests first, then concurrency, retries, and failure/recovery tests in the same project.
4. **Agree on partial completion semantics.** Current import/bootstrap operations are atomic per competitor, not as a whole batch. Conditional acceptance requires a documented decision that row-level partial progress is acceptable and safely resumable.
5. **Run final complete-scope inventory after controls are verified.** It is the final data-state check, not a substitute for writer assurance.
6. **Record gate decision.** Attach rule revision, writer register, test results, scan report, accepted risks, expiry/review date, and an owner for monitoring.

## Shortest path from current NO-GO to CONDITIONAL GO

Assuming the six findings are accepted as historical artifacts under the ownership policy and no new mismatches are produced:

1. **One short scope/deployment evidence session:** confirm the Firebase project and expected competition set; obtain the deployed rules revision/source. (Prerequisite; about 0.5 day including access.)
2. **Close the two highest-risk assurance gaps:** verify deployed rules against source and enumerate all privileged writers. Restrict or disable every unreviewed writer. (About 1–2 days; this is the critical path.)
3. **Run isolated emulator evidence:** rules regression, then 100 repetitions of each critical same-SI race and targeted retry/rollback fault cases. (About 1–3 days, shared harness.)
4. **Accept documented per-row import/bootstrap recovery:** prove partial failures are visible and idempotently resumable. If all-or-nothing is required, CONDITIONAL GO is not available until that architecture is changed.
5. **Run a final read-only V2 inventory over the explicitly reconciled full competition set.** Confirm no new/unexplained finding and attach the historical exception disposition. (About 0.25–0.5 day.)
6. **Approve a time-bounded conditional decision** with monitoring/rollback owner, residual-risk register, expiry date, and criteria to return to NO-GO.

**Estimated shortest path:** approximately **3–6 engineering days** after required cloud access is available, assuming all validations pass and no active defect is discovered. The highest-risk critical path is rules/writer assurance followed by emulator tests. Production writes are not part of this plan.

## Ranked remaining activities

Scores: risk reduction and readiness impact use **High / Medium / Low**; effort is relative. Ranking prioritizes risk reduction and the ability to make a defensible readiness decision, not simply low effort.

| Rank | Activity | Risk reduction | Effort | Readiness impact | Why this rank |
|---:|---|---|---|---|---|
| 1 | Trusted-writer inventory and restriction | High | High (1–2 days) | High | An Admin SDK or external writer can bypass all client rules and transactions. Until authorities are known, passing client tests is insufficient. |
| 2 | Deployed-rule assurance and rules regression | High | Medium (0.5–1 day) | High | Establishes whether production is protected by the code being assessed; can expose direct-write or owner/lifecycle gaps. |
| 3 | Concurrency validation | High | High (1–2 days) | High | Directly tests the atomic uniqueness guarantee across competing canonical flows; an observed race would invalidate cutover. |
| 4 | Retry and timeout validation | Medium–High | High (1–2 days) | High | Ambiguous client outcomes can cause duplicates or inconsistent projections despite transaction atomicity. |
| 5 | Rollback and recovery validation | Medium–High | Medium–High (1–3 days) | High | Confirms failed operations are atomic and accepted partial batch work can be reconciled safely. |
| 6 | Complete inventory coverage | Medium | Low (0.25–0.5 day) | High | Cheap and necessary to ensure no competition was omitted; it is a snapshot, not proof of writer safety. Run after policy/writers are verified. |

## Explicit caveats

- The six ownerUid records are not automatically waived by this plan. A documented, evidence-backed historical disposition is required; any assumption of “no new mismatches” must be verified by the final scan and subsequent monitoring.
- No production writes, rules deployments, IAM changes, data corrections, or code changes are included.
- Emulator evidence supports implementation behavior but does not replace deployed-rule attestation, trusted-writer inventory, or a full production read-only scan.
- If investigation identifies an unreviewed privileged writer, stale deployed rules, failed race/retry/recovery case, or unexplained inventory finding, stop the conditional-go process and return to NO-GO pending remediation.
