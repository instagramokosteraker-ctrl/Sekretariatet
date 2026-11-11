# Firestore Rules Failure Analysis

## Result

**FAIL — the suite fails at the Eventor private-configuration write, before it reaches the SI-assignment tests.**

`runFirestoreRulesDirtyDozenSuite()` first expects the race administrator to create `clubSettings/default/private/eventor` successfully. That `assertSucceeds` is the first success assertion in the run and fails with `PERMISSION_DENIED` (`false for 'create' @ L8, false for 'update' @ L8`). The following read, role-invite tests, and SI-assignment tests are not reached.

The two preceding `PERMISSION_DENIED` messages for `delete` at rules line 1312 correspond to the explicit competition-delete `assertFails` checks near the start of the suite. Those denials are expected and do not cause the failure.

## Exact assertion and rule

- Failing test: the `assertSucceeds` that calls `.set(...)` on `clubSettings/default/private/eventor` in [firestore.rules.test.ts](./firestore.rules.test.ts#L165).
- Denial: the global default-deny rule in [firestore.rules](./firestore.rules#L8). No rule matches the requested path.
- Misplaced rule: the Eventor private-document block begins at [firestore.rules](./firestore.rules#L1464), inside `match /competitions/{competitionId}` and `match /courses/{courseId}` (the latter begins at line 1378). It therefore does not match `clubSettings/default/private/eventor`.
- The block's predicates refer to `settingId` and constrain it to `default`, which indicate that the intended parent path is `/clubSettings/{settingId}/private/{privateId}`.

## Classification

This is a **broken rule implementation**, not a stale test expectation. The test explicitly documents the intended behavior—Eventor credentials are admin-restricted—and the rule block contains admin-only access checks for an `eventor` private document. Its placement makes those checks ineffective for the path the application and test use. The global deny correctly rejects a request for which there is no matching allow rule.

The permission-denied output does **not** identify a failure in SI assignment creation, update, retirement, or deletion. Execution stops before those cases.

## Minimal change required

Move the existing `match /private/{privateId}` block, including its validation helper and permissions, out of the competition/course match and under `match /clubSettings/{settingId}`. Keep the existing `settingId == 'default'`, `privateId == 'eventor'`, `isAdmin()`, schema validation, and list-denial conditions. Do not weaken the global default-deny rule or change the test to expect denial.

This is a diagnosis only; no rules or test code were changed for this report. A separate later assertion may fail after this first defect is fixed. In particular, the suite has not yet established whether the final retirement batch succeeds.

## Pass/fail criteria

- **PASS:** After the rule block is placed at the intended path, `runFirestoreRulesDirtyDozenSuite()` completes with exit code 0; expected `assertFails` cases remain denied, including unauthorized access to the private Eventor document and forbidden SI-assignment mutations.
- **FAIL:** The suite exits nonzero, the administrator's Eventor write is denied, or any negative security assertion unexpectedly succeeds.

## Verification performed

The suite was run against the local Firestore Emulator at `127.0.0.1:8080` using its demo project ID, with local emulator documents cleared before the diagnostic rerun. The diagnostic confirmed the first failing success assertion. No production project, data, or rules were accessed or changed, and no deployment was performed.
