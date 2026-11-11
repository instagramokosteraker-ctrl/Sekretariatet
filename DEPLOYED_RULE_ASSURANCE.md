# Deployed Firestore Rule Assurance

- Assessment date: 2026-11-11.
- Method: read-only Firebase Console inspection and repository comparison.
- No rules were deployed or edited; no production data was written.

## Verdict

**FAIL — the newest/star-marked Firestore Rules release shown in the Console is semantically stale relative to the repository.** Its assignment rules allow independent assignment create/update/delete operations for admins and lack the paired competitor checks now present in [`firestore.rules`](./firestore.rules). The full material comparison is recorded in [DEPLOYED_RULE_DIFF.md](./DEPLOYED_RULE_DIFF.md). The exact release hash was not exposed in the Console view, so this is a source-level semantic comparison, not a hash attestation.

## Evidence

The Firebase Console Security page for the configured Firestore project/database listed `Yesterday • 8:23 AM` as its newest, star-marked/current rules version (2026-11-10 by the assessment date). Its source was selected and fully inspected read-only in the Console. The repository's latest `firestore.rules` commit is `90f0e9f` at `2026-11-10 21:19:26 +0100`, later that day. The full comparison is in [DEPLOYED_RULE_DIFF.md](./DEPLOYED_RULE_DIFF.md).

The inspected Console source contained these assignment rules:

- `match /siCardAssignments/{siNumber}` at Console source line 1154.
- Create checked assignment shape, path IDs, `ownerUid == request.auth.uid`, parent competition, and `isAdmin()`, but did not require a matching competitor mutation.
- Update checked assignment immutables and `isAdmin()`, but did not require a matching competitor mutation.
- Delete was allowed to admins.
- Searching the deployed editor for `hasActiveSIAssignmentAfter` and `assignmentMatchesCompetitorAfter` returned no matches.
- The competitor create/update rules shown in that release likewise lacked the repository's assignment after-state predicates.

The repository rules differ materially:

- [`hasActiveSIAssignmentAfter`](./firestore.rules#L650) and [`assignmentMatchesCompetitorAfter`](./firestore.rules#L698) validate the paired post-write identity.
- The assignment create/update rules require a corresponding competitor identity/lifecycle mutation and assignment-to-competitor parity; direct assignment deletion is denied ([`siCardAssignments` rules](./firestore.rules#L1319)).
- Competitor create/update rules require the matching active or retired assignment state ([`competitors` rules](./firestore.rules#L1602)).
- The assignment-boundary hardening source commit is `90f0e9f`; the inspected Console release timestamp precedes it by about thirteen hours.

This establishes a live client-side bypass in the active release identified by the Console's star/current marker. The Console did not provide an immutable source hash or explicit deployment-pipeline attestation during this inspection. The unauthenticated Rules API request was denied with HTTP 403, and no Firebase or `gcloud` CLI was available to retrieve a revision/hash independently. The semantic mismatch is high-confidence; an immutable release identifier/hash is still missing.

## Regression-test status

`firestore.rules.test.ts` exports `runFirestoreRulesDirtyDozenSuite()` and depends on `@firebase/rules-unit-testing`, but the repository has no dedicated rules-test script. The suite was not executed: Firebase CLI/Firestore Emulator tooling was unavailable. Build/lint results do not validate rules semantics or deployed release parity.

## Pass/fail and closure criteria

| Check | Result | Evidence / remaining work |
|---|---|---|
| Identify active Console release | Pass with identifier limitation | Star/current-marked entry inspected; exact release ID/hash not exposed. |
| Compare deployed and repository rules | **Fail** | Direct assignment create/update/delete bypasses in Console source; paired predicates are absent. |
| Verify active release from an independent deployment artifact | Incomplete | Obtain the active release ID/source or CI artifact/hash after an approved deployment. |
| Run rule regression suite | Not run | Start Firestore Emulator and explicitly invoke the exported suite plus assignment create/reassign/retire and negative bypass cases. |
| Confirm production protection | **Fail** | Do not treat repository rules as deployed enforcement until the approved rules release is published and re-attested. |

## Safe next steps

1. Treat the production rules gate as failed and keep the cutover **NO-GO**.
2. Through the approved production change process, deploy the reviewed repository rules. This assessment did not perform that production write.
3. Capture the active Console release ID, source or source hash, project/database identity, and deployment time; verify it contains the paired-write predicates and denies direct assignment deletion.
4. Run emulator positive and negative rules tests and retain the output with the deployed-release evidence.
5. Re-run the trusted-writer and complete-scope inventory after the rules change. Firestore rules do not constrain Admin SDK writers.
