# Deployed Firestore Rules Remediation Plan

- Assessment date: 2026-11-11.
- Scope: replace the stale production Firestore rules with reviewed repository rules, then prove the intended paired-write behavior.
- Plan only: no production rules or data changes were made.
- Sources: [DEPLOYED_RULE_DIFF.md](./DEPLOYED_RULE_DIFF.md), [DEPLOYED_RULE_ASSURANCE.md](./DEPLOYED_RULE_ASSURANCE.md), [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md), repository `firestore.rules`, commit `90f0e9f`.

## Current and target versions

The current active release is the star-marked Firebase Console version shown as `Yesterday • 8:23 AM` on 2026-11-11, for project `ai-studio-applet-webapp-72c01` and database `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`. Its immutable release ID/hash was not exposed in the inspected Console view. Its source is materially older than commit `90f0e9f`.

The target is the reviewed repository [firestore.rules](./firestore.rules) at `90f0e9f`. The worktree file is byte-identical to that commit's blob (`ec58bae9f5d83b7b1b9cea3ba5efeeccb2bd365e`). Confirm the target commit and blob again immediately before deployment; do not deploy an unreviewed working-tree version.

## Deployed-only bypasses and risk

| Deployed-only gap | Risk | Affected data | Affected write paths | Readiness impact |
|---|---|---|---|---|
| Assignment creation does not require a matching competitor mutation or compare the resulting assignment/competitor identity. | **Critical** — standalone client writes can introduce false, orphaned, or conflicting ownership records. | `competitions/{competitionId}/siCardAssignments/{siNumber}` and linked competitor docs. | Any verified admin client able to address Firestore directly, not just application UI flows. | Breaks production-wide Atomic SI Matching enforcement; deployed-rule gate fails. |
| Assignment updates lack paired-write and post-state checks. Owner is immutable in the old rule, but SI, card-series, lifecycle, and identity parity are not jointly enforced. | **Critical** — an assignment can diverge from its competitor while its document remains. | Assignment SI ownership, card series, state, and associated competitor identity. | Direct admin client assignment updates. | Invalidates the assumption that all assignment changes cross the hardened boundary. |
| Assignment deletion is allowed to admins. | **Critical** — can remove the only ownership/lifecycle record while leaving the competitor intact. | Assignment history and competitor-to-SI linkage. | Direct admin client delete. | Enables destructive bypass; repository explicitly denies assignment deletion. |
| Competitor creation does not require a matching active assignment; deployed readout-specific receipt/RunnerDb validations are absent. | **High** — competitor identities can exist without an active SI ownership record; canonical readout creation may also be rejected due schema mismatch. | Competitor records, SI assignments, readout receipts, and counters. | Direct admin competitor create and readout client write. | Rules are not equivalent to the behavior expected by current transaction writers; rules gate fails. |
| Competitor updates do not require a matching active target assignment or retirement of the old SI. | **Critical** — SI reassignment can leave stale ownership, double ownership, or a competitor with no corresponding assignment. | Competitor SI/cardSeries and old/new SI assignment records. | Direct admin competitor update. | Specifically bypasses the intended reassignment lifecycle; cutover remains NO-GO. |
| Competitor deletion does not require assignment retirement. | **High** — can strand an active assignment after the competitor is deleted. | Competitor document and active SI assignment. | Direct admin competitor delete. | Can create orphan assignments and defeats the lifecycle invariant. |
| Optional `readoutReceiptId` validation is absent and the readout-specific competition count branch is absent. | **High for readout correctness** — rules do not enforce receipt/counter coupling and may deny the current auto-create payload. | Competitor receipt pointer, `readoutReceipts`, competitor and finish counters. | Readout auto-create and associated count updates. | Current rules no longer assure the shipped readout transaction; must pass a readout rules regression before acceptance. |
| Paired-write, retirement, and readout helper predicates are absent. | **High** — deployed rules lack reusable post-commit checks for SI, competitor IDs, cardSeries, owner parity, and retirement transitions. | All assignment/competitor identity and lifecycle fields. | Any client SDK mutation evaluated against these rules. | Captures the enforcement gaps above; no application-only test can substitute for closing the rules boundary. |

The ownership finding is specifically an **assignment-to-competitor parity bypass**. The inspected old rules still bind assignment creation to the caller's UID and require ownerUid to remain immutable on update; the evidence does not establish that a client can directly rewrite a competitor's immutable ownerUid. Admin SDK/IAM writers are a separate trust boundary and remain outside Firestore Rules.

## Deployment prerequisites

Do not publish until all are true:

1. **Authority and scope:** an authorized production change owner approves the target Firebase project and exact database. Confirm whether the Firebase Console release applies to the named database above and whether the existing rules-release flow is database-specific.
2. **Target integrity:** cleanly identify the approved commit and confirm `git rev-parse 90f0e9f:firestore.rules` matches the reviewed target blob. Preserve the deployment artifact and its SHA-256 digest.
3. **Baseline capture:** export/save the complete current active rules source, active release identifier (if available), displayed timestamp, project/database identity, and a digest. The earlier assessment reconstructed the current source for comparison but did not obtain an immutable release hash; capture this before any change.
4. **Rules tests:** start an isolated Firestore Emulator with the target source; explicitly run `runFirestoreRulesDirtyDozenSuite()` and the required paired-write positive/negative cases in this plan. Resolve test failures before production deployment. Ensure test fixtures use no production identities or records.
5. **Application compatibility:** verify the current deployed app writes only the target rules' supported shapes and expected fields. Specifically exercise direct entry, import seed, readout auto-create/receipt/counters, reassignment, retirement, and status/result updates in the emulator.
6. **Operational readiness:** agree a low-traffic deployment window, operator/approver, monitoring period, communication channel, and stop/rollback authority. Do not combine this rules deployment with unrelated app/data changes.
7. **Recovery decision:** review the previous active release source in advance and approve the rollback consequences below. A rollback to the known stale release restores the bypasses; it is emergency availability recovery, not an acceptable steady state.

## Exact deployment sequence

1. Freeze unrelated rule edits and record the deployment ticket/change approval.
2. Re-identify the active Console release immediately before change; save its displayed timestamp and source. If active source has changed since this assessment, repeat the semantic diff and revise this plan.
3. Produce the immutable target artifact from commit `90f0e9f`; record its source hash and test result. Confirm the target includes:
   - assignment create/update predicates `hasCompetitorSIOrLifecycleMutationAfter` and `assignmentMatchesCompetitorAfter`;
   - `allow delete: if false` for `siCardAssignments`;
   - `hasActiveSIAssignmentAfter` on competitor create and relevant update;
   - `hasRetiredSIAssignmentAfter` for old-SI retirement during SI reassignment and competitor deletion;
   - the readout receipt and RunnerDb checks and readout count-transition rules.
4. Publish **only** the Firestore rules for the confirmed project/database using the approved deployment route (Firebase Console Rules editor or the repository's authorized Firebase CLI pipeline). Review the selected project/database and the exact source in the final confirmation screen. Do not change data, IAM, or application code.
5. Record the Console release timestamp/identifier, operator, target commit, source digest, and publication result. Do not treat “publish succeeded” alone as proof of the active source.
6. Verify the new release is the active/star-marked release; retrieve the active source again and compare it with the approved artifact (prefer a byte/hash comparison; if export APIs are unavailable, inspect the complete source and verify the critical predicates and full semantic diff).
7. Execute post-deployment checks below. Keep the feature/readiness gate closed until every check passes. Any unexpected rule denial/allow or source mismatch is a failed deployment gate.

## Verification proving the paired-write invariants

Run the full matrix in an isolated emulator using the exact target artifact and deterministic fixtures. Seed existing competition/admin/competitor/assignment records with Security Rules disabled; perform test operations with authenticated client contexts. Assertions below are `assertFails`/`assertSucceeds` tests; do not perform these test writes against production.

| Invariant | Required negative test | Required positive control |
|---|---|---|
| Assignment create requires a paired competitor mutation | As an authorized admin, create an otherwise valid `ACTIVE` assignment alone; assert failure. Also attempt to create an assignment paired with a competitor whose SI, cardSeries, competitorId/document ID, competitionId, or ownerUid differs; assert failure. | In one batch/transaction, create a matching competitor and active assignment with the same competition, SI, competitor IDs, cardSeries, and owner; assert success. |
| Assignment update requires a paired competitor mutation | Update an existing assignment alone (including a mutable lifecycle/identity field); assert failure. Pair an update with an unchanged or wrong competitor post-state; assert failure. | Perform a valid paired lifecycle/identity mutation accepted by the design and rule predicates; assert success. Do not treat a same-document assignment patch as sufficient. |
| Assignment delete is blocked | Delete an existing assignment as an authorized admin; assert failure, regardless of competitor mutation in the request. | No positive delete case exists; verify the assignment remains after the rejected attempt. Retirement is an update, not deletion. |
| SI reassignment requires retirement of old SI | Update competitor SI only; assert failure. Create/activate new SI assignment without retiring old assignment and updating the competitor; assert failure. Retire old assignment without a matching active target assignment and competitor SI update; assert failure. | In one transaction/batch: transition the old assignment to `RETIRED`, create the new SI assignment as `ACTIVE`, and update the same competitor to the new SI/cardSeries. Assert success and verify both assignment documents and competitor post-state. |
| Ownership/parity cannot be bypassed | Attempt a paired assignment/competitor write with mismatched ownerUid or IDs; assert failure. Attempt to change competitor ownerUid directly; assert failure under immutable-owner rule. | Matching owner and identity values across the valid paired write succeed, subject to the role-specific rule path. |

Also run the full exported suite, including readout receipt/counter cases, and preserve machine-readable test output. Capture test source hash, emulator version, test command, date, and result.

For production, verify the newly active release source/digest is exactly the tested artifact. Use Firebase Rules Playground or equivalent **simulation-only** checks for direct assignment create/update/delete, competitor SI-only update, and other negative cases; simulations must not write production data. Actual paired transaction success is proven in the emulator, and is attributable to production only after active-source identity with the tested artifact is verified. If the Console cannot provide sufficient source identity for that link, record production verification as incomplete rather than pass.

## Rollback and recovery strategy

- **Before publication:** abort with no production impact if any prerequisite/test fails.
- **After publication, no unexpected behavior:** keep the new release active, monitor expected permission-denied and application error rates, and preserve the release artifact/attestation.
- **After publication, source mismatch or security regression:** immediately stop and keep high-risk competitor identity operations disabled where an existing application control can do so. Prefer a forward-fix of the target rules and re-deploy after emulator tests.
- **If application availability requires rollback:** only with the named change owner's approval, re-publish the exact pre-change rules source as an emergency rollback. This restores the known assignment create/update/delete and SI-reassignment bypasses; keep readiness NO-GO, maintain compensating restrictions on identity mutation, alert the owner, and schedule a corrected forward deployment. Reverify which release is active after rollback.
- Rules rollback does not roll back documents already written. If any test or production activity unexpectedly mutated data, stop further changes, preserve logs, and use the separately approved data-reconciliation process; do not attempt automatic cleanup as part of rule rollback.

## Post-deployment acceptance / readiness

Deployment assurance passes only when:

1. The active release is identified and its source/hash matches the reviewed target artifact.
2. The emulator matrix demonstrates standalone assignment create/update fail, direct delete fail, SI-only reassignment fail, missing-old-retirement fail, and valid paired create/reassignment/retirement succeed.
3. Readout, import, direct-entry, and result/status rules tests pass for their supported roles.
4. Production simulation checks deny the specified direct-write bypass attempts and no unplanned data writes were made.

Even if repository rules are deployed and all these checks pass, readiness remains **NO-GO** until other canonical blockers close. The next single highest-priority blocker becomes **trusted-writer assurance**: inventory effective IAM, service-account keys/impersonation, deployed external/Admin SDK jobs, CI identities, and audit-log activity, and constrain every privileged writer. Firestore Rules cannot protect against Admin SDK or other privileged writers. The six `ownerUid` parity findings, complete competition scope, and concurrency/retry/recovery validation also remain open.

