# Readiness Execution Plan

- Prepared: 2026-11-11.
- Goal: shortest evidence-based path from current **NO-GO** to a defensible **CONDITIONAL GO** decision.
- Scope: deployed Firestore rules, trusted writers, full inventory, concurrency, retry, and recovery/rollback assurance.
- This is an execution plan, not authorization to deploy rules or change IAM. Do not write or repair production competitor/assignment data as part of these validations.

## Executive sequence

The known deployed rules bypass is the highest immediate risk. First establish project/change authority and a usable isolated emulator. Then test and deploy the reviewed rules. Start the trusted-writer inventory in parallel once project scope and access are confirmed. Once production enforcement and writers are controlled, run the final V2 inventory. Complete concurrency, retry, and recovery tests on the same isolated emulator harness. Keep the readiness decision NO-GO if any required gate fails or lacks evidence.

Assuming access is promptly available and tests pass, expected effort is about **3–6 engineering days**, excluding approval wait, production change windows, and remediation/retest. Emulator setup may add time if the supported runtime is not already available.

## Prioritized checklist

Priority definitions:

- **P0 — Must complete before acceptance testing:** resolve the known production client bypass and establish the project, change authority, and tested rule artifact.
- **P1 — Next blockers:** complete writer inventory and the post-control, full-scope production V2 scan.
- **P2 — Required validation-only gates:** exercise concurrency, retries, and recovery in an isolated emulator.
- **P3 — Optional assurance strengthening:** additional stress duration, monitoring, and evidence-retention improvements. P3 does not replace any P0–P2 gate.

The six listed blockers are all required by the proposed CONDITIONAL GO gate in [CONDITIONAL_GO_VALIDATION_PLAN.md](./CONDITIONAL_GO_VALIDATION_PLAN.md). P3 is supplemental, not a waiver for an unclosed blocker.

### P0 — Establish scope, authority, and test environment

- [ ] Confirm the target Firebase project `ai-studio-applet-webapp-72c01`, Firestore database `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`, production environment, and accountable rules change owner.
- [ ] Obtain read access to deployed rules releases/source and approval authority for a rules-only change. Record the deployment ticket, approver, operator, rollback authority, and maintenance/monitoring window.
- [ ] Prepare an isolated Firestore Emulator environment using a Firebase CLI-supported Node LTS runtime and supported JDK. Keep test project ID separate from production; no production documents or credentials in fixtures.
- [ ] Confirm the rules suite can be invoked. The repository exports `runFirestoreRulesDirtyDozenSuite()` from `firestore.rules.test.ts`, but has no Firebase config or dedicated npm script. Use an ephemeral/test-only configuration or approved harness; do not commit tooling changes unless separately approved.
- [ ] Identify the exact source commit and approved `firestore.rules` artifact. The prior documented target is commit `90f0e9f`; re-check commit/blob and compute a deployment artifact digest immediately before testing/deployment.

**Duration:** 0.5–1 day engineering effort; access and approval wait excluded.  
**Access:** Firebase project/database read access; authorized change owner and publisher; repository commit/artifact access.  
**Tooling:** Supported Node LTS, Firebase CLI, Firestore Emulator, supported JDK, `@firebase/rules-unit-testing`, test runner, source hashing.  
**Pass:** scope and responsible approver recorded; separate emulator starts; reviewed target source is immutable and attributable to an approved commit; emulator test command is reproducible.  
**Fail:** project/database identity is uncertain, no authorized change owner, production access is being used for tests, target source is mutable/unreviewed, or emulator prerequisites cannot be established.  
**Dependencies:** None. This gate enables all subsequent work.

### P0 — 1. Deployed Firestore Rule Assurance

- [ ] Before publication, retrieve and preserve the complete currently active rules source, release identifier if available, displayed timestamp, project/database identity, and digest. Repeat the source-level semantic diff if the release differs from the previously inspected one.
- [ ] Run `runFirestoreRulesDirtyDozenSuite()` and the required paired-write matrix against the exact target artifact in the isolated emulator.
- [ ] Include positive paired create/reassignment/retirement and readout/import/direct-entry cases; negative standalone assignment create/update, direct assignment delete, SI-only reassignment, missing old-SI retirement, mismatched owner/IDs/SI/cardSeries, invalid lifecycle, and unauthorized-role cases.
- [ ] Review the full results and preserve command, source digest, emulator/CLI versions, timestamp, and machine-readable output. Stop before production publication on any unexpected allow or deny.
- [ ] With production change approval, publish only the reviewed rules to the confirmed project/database. Capture operator, approver, timestamp, release/revision, and artifact digest.
- [ ] Re-read the active production source and verify it is the tested artifact. Run simulation-only production checks for the negative bypass cases; do not submit data writes through the production client or Rules Playground.
- [ ] Monitor permission-denied/application errors during the agreed window. If source identity or behavior is wrong, stop high-risk identity operations where an existing control allows; use the approved emergency rollback only with change-owner approval. A rollback to the known stale rules restores bypasses and leaves readiness NO-GO.

**Duration:** 0.5–1 day engineering effort, plus approved deployment window.  
**Access:** Firebase Rules source/release read access; authorized production publisher and approver; emulator test permissions.  
**Tooling:** Firebase CLI/Firestore Emulator, rules-unit-testing runner, source diff/hash tooling, deployment pipeline or Console, simulation-only rule tester, release/monitoring record.  
**Pass:** full emulator suite and required positive/negative matrix pass; deployed active release is identified and exactly attributable to the tested artifact; production simulations deny all specified bypasses; no unplanned data writes.  
**Fail:** stale/different source remains active, any required case fails, active source cannot be attested, an unexpected production allow/deny occurs, or publication/rollback authority is unclear.  
**Dependencies:** P0 scope/authority and emulator setup. Trusted-writer discovery may proceed in parallel once project identity and read access are confirmed; do not run acceptance tests against production before this gate passes.

### P1 — 2. Trusted Writer Assurance

- [ ] Create a principal/writer register covering human users and groups, project and inherited IAM, service accounts and keys, impersonation, Firebase Console roles, Cloud Functions, Cloud Run services/jobs, Scheduler/Tasks, CI/CD identities, external scripts/automation, and client applications.
- [ ] For each principal, record owner, purpose, credential type, effective roles, reachable collections, code/repository/runtime, whether it can bypass Firestore Rules through Admin SDK, and whether writes use the canonical transaction boundary.
- [ ] Review Cloud Audit Logs for competitor and `siCardAssignments` writes over the available retention period. Attribute actors and source where possible; record retention gaps and whether the logs are Data Access logs.
- [ ] Confirm there is no unreviewed external Admin SDK writer. For each authorized privileged writer, verify its implementation is reviewed and constrained to the canonical mutation boundary. Remove or restrict unnecessary authority only through a separately approved IAM change; never make a permission change as part of read-only discovery.
- [ ] Assign a responsible owner and evidence source to every remaining principal. Resolve unknown identities before acceptance.

**Duration:** 1–2 days engineering/operations effort; access approvals excluded.  
**Access:** Read-only project, organization/folder IAM and service-account views; Cloud Audit Logs; Firebase Console roles; Functions/Run/Scheduler/Tasks inventories; CI metadata and accountable system owners. Separate approval is required for IAM changes.  
**Tooling:** Cloud/Firebase consoles or approved read-only CLI/API exports, audit-log query/export, repository writer inventory, access-controlled principal register.  
**Pass:** every client and privileged writer is named; each privileged writer is approved and constrained to the canonical path or has no write permission; logs show no unexplained writes within available retention; limitations are explicitly compensated and approved.  
**Fail:** unknown principal or runtime, unrestricted Admin SDK access, unexplained writes, missing accountable owner, or material audit-log gap without compensating control.  
**Dependencies:** Project identity and read access (P0). Begin in parallel with rules testing/deployment; finish before final inventory.

### P1 — 3. Full Inventory Coverage

- [ ] Define the in-scope production project/database and competition lifecycle states, including archived/completed competitions. Obtain an independent expected competition ID set/register.
- [ ] Enumerate all competition document IDs from the confirmed database using complete pagination; reconcile that set to the authorized read-only V2 scan's input and output.
- [ ] Run the repository V2 inventory using a V2-capable client/build against production with a read-only role. The production web UI previously exposed only the legacy summary; do not substitute that report for V2 owner/parity coverage.
- [ ] Confirm each competition is scanned exactly once and that competitor/assignment reads succeeded. Record timestamp, IDs, per-competition totals, query errors, and V2 findings. Keep raw owner UIDs in access-controlled evidence only.
- [ ] Reconcile the six previously reported ownerUid mismatches and the two Terräng-KM retired/REGISTERED flags against lifecycle-aware V2 output and authoritative disposition. Do not assume the previous six are historical or corrected without evidence.
- [ ] Repeat or reconcile the scan if writes occur during the scan window. Obtain competition-owner disposition for every non-informational issue.

**Duration:** 2–4 hours engineering effort, plus access/setup.  
**Access:** Read-only Firestore access to competitions, competitor subcollections, and SI assignment subcollections; read-only expected competition register; authorized role to run the V2 scan.  
**Tooling:** Current V2 inventory implementation/report formatter, read-only client/build, paginated collection enumeration, access-controlled report storage.  
**Pass:** expected and scanned competition ID sets match exactly; no query/pagination failures; totals reconcile; no unexplained structural, SI, owner, card-series, identity, lifecycle, orphan, or duplicate findings; the six historical exceptions, if retained, have explicit evidence-backed approval; Terräng-KM flags are dispositioned.  
**Fail:** omitted competition, incomplete V2 scan, unexplained finding, unexplained count discrepancy, or use of the legacy report as V2 proof.  
**Dependencies:** Project/scope declaration (P0); perform after deployed rules and trusted-writer controls pass to obtain the final data-state snapshot.

### P2 — 4. Concurrency Validation

- [ ] On the isolated emulator, implement deterministic barriers and fresh fixtures for concurrent same-SI direct creates, create-vs-import, create-vs-readout, reassignment-vs-readout/import, and bootstrap-vs-retire/delete/reassign.
- [ ] Exercise concurrent competitor updates and duplicate assignment attempts, including two independent callers contending for the same competition/SI.
- [ ] Run at least 100 repetitions per race scenario. Capture accepted/rejected outcomes and transaction retry/error details.
- [ ] Check the final competitor, assignment, receipt/counter, and lifecycle state after every repetition.

**Duration:** 1–2 days; shares setup/harness with retry and recovery tests.  
**Access:** No production write access required. Access to repository/test fixtures and isolated emulator only.  
**Tooling:** Firestore Emulator, rules-unit-testing/client test harness, deterministic barrier/fault harness, structured test output.  
**Pass:** each same-SI race has exactly one accepted active owner; all committed pairs match owner, SI, cardSeries, and IDs; lifecycle is valid; failures are explicit; no dangling assignment, duplicate active owner, or partial paired write occurs in all repetitions.  
**Fail:** any invalid committed state, ambiguous success, unhandled race, or test run against production.  
**Dependencies:** P0 emulator setup and successful deployed-rule test artifact. Run before interpreting retry/recovery results.

### P2 — 5. Retry Validation

- [ ] Reuse the isolated harness to force transaction conflicts/retries and transient failures.
- [ ] For direct create, reassignment, import row, readout, retirement, and bootstrap, simulate timeout before commit and response loss after a confirmed emulator commit; retry the identical logical operation/request ID where supported.
- [ ] Re-read canonical competitor/assignment/receipt/counter records after every attempt. Document which operations are naturally idempotent and which require client reread or an idempotency key.

**Duration:** 1–2 days; shared harness.  
**Access:** No production write access required.  
**Tooling:** Firestore Emulator, conflict/fault injection wrapper or test proxy, deterministic fixtures/request IDs, structured logs and assertions.  
**Pass:** retries do not duplicate active SI ownership, retirements/successors, receipts, or counters; post-commit response loss is resolved by reread/idempotent retry; pre-commit failures remain visible and leave no partial transaction writes.  
**Fail:** duplicate side effects, success-shaped fallback, ambiguous committed state, silent failure, or behavior cannot be determined.  
**Dependencies:** P2 concurrency harness; execution should follow the basic race tests so failures can be isolated.

### P2 — 6. Recovery / Rollback Validation

- [ ] Force aborts before commit in each paired transaction; confirm no competitor, assignment, receipt, or counter subset commits.
- [ ] For import and bootstrap, deliberately fail after a known subset of per-competitor transactions succeeds. Verify the operation reports partial progress and the failed row is unchanged.
- [ ] Rerun the same logical import/bootstrap; confirm it converges safely without duplicate identities or invalid lifecycle transitions.
- [ ] Simulate a committed transaction with a lost response and apply the documented reread/recovery procedure.
- [ ] Run V2 inventory against emulator fixtures after every recovery scenario and compare exact expected findings and totals.
- [ ] Document and obtain business-owner acceptance of per-competitor (not whole-batch) atomicity, operator recovery steps, response owner, and escalation/rollback authority.

**Duration:** 1–3 days; shared harness.  
**Access:** No production data write access. A business/operations owner must approve partial-progress semantics and runbook ownership.  
**Tooling:** Firestore Emulator, failure injection, import/bootstrap fixtures, V2 inventory, structured results, recovery/runbook record.  
**Pass:** aborted single transactions leave no partial writes; successful rows remain internally consistent; failed rows are unchanged and identified; reruns are idempotent and converge; post-recovery inventory matches expected state exactly; partial-batch behavior is accepted and owned.  
**Fail:** partial single transaction, silent/unknown progress, irreconcilable row, duplicated effect on rerun, mismatch after recovery, or business requirement for whole-batch atomicity not met.  
**Dependencies:** Concurrency and retry harness; explicit agreement on per-row atomicity. The rules deployment rollback plan is separate: rollback to the stale source restores known bypasses and must leave readiness NO-GO.

### P3 — Optional assurance strengthening

- [ ] Run extended stress beyond the 100-repetition minimum and across supported client/runtime versions.
- [ ] Add a time-bounded post-change monitoring period with named alert responder and an expiry/review date for any accepted residual risk.
- [ ] Preserve signed/source-controlled test artifacts and periodic IAM/audit-log re-attestation.

**Duration:** 0.5–2 additional days, depending on stress duration and monitoring window.  
**Access:** Emulator/test infrastructure and read-only production monitoring; production mutation not required.  
**Tooling:** Stress harness, monitoring dashboards/alerts, controlled evidence repository.  
**Pass:** extended tests remain within the P2 invariants and monitoring/response ownership is active.  
**Fail:** any invariant violation or unowned alert.  
**Dependencies:** All P0–P2 gates. These steps improve assurance but cannot waive a failed required gate.

## Critical path and execution order

1. **Today:** open/confirm the rules change work item with the authorized Firebase project owner; request the current active source/release export and approval for a rules-only change to the named project/database. Also request read access for trusted-writer inventory. Do not publish yet.
2. Confirm project/scope and bring up the isolated, supported emulator environment (P0).
3. Run rules regressions; only after pass, publish and attest the reviewed rules artifact (P0).
4. In parallel after scope is confirmed, inventory IAM/services/CI/audit logs and resolve unreviewed writer authority (P1).
5. Once rules and writers pass, run the complete V2 production inventory (P1).
6. On the shared emulator harness, run concurrency, then retry, then recovery tests (P2). Agree partial batch semantics before recovery acceptance.
7. Assemble evidence and submit the CONDITIONAL GO gate to the accountable owner. Any failed gate or unexplained data finding means NO-GO and remediation before reassessment.

## Conditional GO decision checklist

- [ ] Deployed rules exactly match the tested, reviewed artifact and all positive/negative rules tests pass.
- [ ] Every client and privileged writer is identified; no unreviewed path can alter competitor or assignment identity.
- [ ] Full-scope V2 inventory matches the independent competition set and all findings are dispositioned.
- [ ] Concurrency, retry, and recovery criteria pass in an isolated emulator.
- [ ] Six previously observed ownerUid mismatches have an explicit evidence-backed disposition under the adopted policy; no new unexplained mismatch remains.
- [ ] Partial import/bootstrap semantics, monitoring owner, residual risks, and review/expiry date are documented.

**Current state:** none of the above should be presumed complete from the source reports alone. The most recent closure assessments remain FAIL/INCOMPLETE; readiness remains **NO-GO** until evidence is collected.
