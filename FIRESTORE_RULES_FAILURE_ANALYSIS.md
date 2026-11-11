# Firestore Rules Failure Analysis

## Latest result

**FAIL — the Eventor private-configuration assertion now passes, but the suite fails later on the readout auto-create batch.**

The suite reached `assertSucceeds(readoutAutocreateBatch.commit())` in [firestore.rules.test.ts](./firestore.rules.test.ts#L702). That assertion expects a readout-authorized batch creating the competitor, matching SI assignment, receipt, and competition count update to succeed. The emulator denied the batch and reported that evaluation exceeded the 1,000-expression limit in the competitor and competition update rules. No further failure analysis was performed in this run.

## Eventor rule relocation

The original first failure was the admin `assertSucceeds` write to `clubSettings/default/private/eventor` in [firestore.rules.test.ts](./firestore.rules.test.ts#L166). The Eventor rule was nested under `/competitions/{competitionId}/courses/{courseId}`, so it did not match that path; the global default-deny rule denied the write.

The current [firestore.rules](./firestore.rules) diff moves the existing `/private/{privateId}` block beneath `/clubSettings/{settingId}`. The validator and all access conditions are unchanged: only the `default` setting and `eventor` document are allowed, access requires `isAdmin()`, list access remains denied, and writes retain the existing schema validation. The move is minimally scoped and does not broaden permissions.

The suite's execution proceeded past the Eventor assertions to the readout batch failure described above. The suite as a whole therefore remains **FAIL**.

## Verification

- Ran `runFirestoreRulesDirtyDozenSuite()` against the Firestore Emulator using project `demo-passersi-rules-test`.
- No production project or data was accessed; no deployment was performed.
