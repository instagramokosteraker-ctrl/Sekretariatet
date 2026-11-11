# Firestore Rules Complexity Remediation

## Outcome

**FAIL — the dirty-dozen rules suite still fails at `assertSucceeds(readoutAutocreateBatch.commit())`** in [firestore.rules.test.ts](./firestore.rules.test.ts#L702). The emulator continues to report the 1,000-expression limit. This change reduces repeated document reads but is not sufficient to make the batch pass.

## Change made

In [firestore.rules](./firestore.rules):

- `hasActiveSIAssignmentAfter` now fetches each guarded after-state assignment and competitor once and passes their maps to a data-only comparator.
- `assignmentMatchesCompetitorAfter` now compares a single fetched competitor snapshot for each applicable before/after state while retaining all active and retired parity conditions.
- `hasProcessedReadoutReceiptAfter` now fetches the post-write receipt once and compares its status, competitor ID, SI number, card series, and owner against the competitor.
- The readout identity check now fetches the competitor once and the RunnerDb entry once, then compares full name, club (including the existing `Klubblös` exception), and card series from those maps.
- The assignment readout check performs its READOUT-role check once and uses the same competitor map for RunnerDb identity and assignment SI/card-series/owner parity.
- `hasCompetitorSIOrLifecycleMutationAfter` now caches the before/after existence results once each, while retaining the same create, delete, and protected-field-diff outcomes.

The relevant-competitor-mutation condition remains required by the assignment write rules; no paired-write predicate was removed.

## Preserved guarantees

No schema validator or authorization predicate was removed. The refactor retains:

- competitor/assignment paired-mutation enforcement;
- active and retired assignment/competitor parity;
- processed-receipt provenance and receipt owner validation;
- RunnerDb full-name, club, and card-series matching;
- competitor, assignment, and receipt `ownerUid` checks;
- SI number and card-series checks.

The readout role check remains on each allow-rule path. No deployment was performed.

## Remaining expression-limit hotspots

The emulator reports the expression ceiling on the batch's rule statements:

- `/competitions/{competitionId}/siCardAssignments/{siNumber}` — `allow create` at current [firestore.rules](./firestore.rules#L1427). The remaining source-level candidates are assignment schema validation, assignment/competitor parity, and readout checks.
- `/competitions/{competitionId}/competitors/{competitorId}` — `allow create` at current [firestore.rules](./firestore.rules#L1671). The remaining chain includes full competitor schema validation, active assignment parity, and readout receipt/RunnerDb validation.
- `/competitions/{competitionId}` — `allow update` at current [firestore.rules](./firestore.rules#L1301). The incoming competition schema validation and role-specific update branches remain substantial.

The emulator identifies the rule statements, not individual helper expression counts. These helper-level candidates are therefore source-traced, not independently measured. The suite still fails after the follow-up existence caching; see [FIRESTORE_RULES_COMPLEXITY_STEP2.md](./FIRESTORE_RULES_COMPLEXITY_STEP2.md) for the call counts and the next source-traced hotspot. The create case in `hasCompetitorSIOrLifecycleMutationAfter` takes only one `exists` and one `existsAfter`, so further work should focus on the remaining rule paths rather than weakening that paired-write guard.

## Verification

Ran `runFirestoreRulesDirtyDozenSuite()` against the Firestore Emulator using project `demo-passersi-rules-test` and `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`. The run exited with code 1 and reported `PERMISSION_DENIED` with the 1,000-expression limit on the rule paths above. The emulator was stopped afterward.
