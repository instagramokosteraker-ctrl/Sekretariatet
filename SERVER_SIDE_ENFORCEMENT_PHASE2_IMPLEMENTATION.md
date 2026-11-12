# Server-side enforcement phase 2 implementation

## Outcome

This first migration slice targeted the lowest-risk cross-document check already enforced by the repository backend: assignment parity.

### Changed in the backend

The existing transaction boundary in `src/firebase.ts` is the canonical enforcement point for assignment parity and owner consistency:

- `runAtomicSIAssignmentMutation(...)`
- `updateCompetitorInFirestore(...)`
- `deleteCompetitorFromFirestore(...)`
- `retireCompetitorInFirestore(...)`
- `saveDirectCompetitionEntryToFirestore(...)`
- `submitReadoutToFirestore(...)` auto-create path

These paths already validate that:

- assignment `competitionId`, `siNumber`, `cardSeries`, `ownerUid`, and `competitorId` match the competitor
- the SI assignment is active or valid for the current mutation
- reassignment and retirement transitions fail closed on mismatch

This is the lowest-risk migration because it is already implemented in the server-side transaction layer and is fully aligned with the repository's Atomic SI Matching design.

### Changed in Firestore Rules

The dead, unused assignment-parity helper chain was removed from `firestore.rules` to reduce Rules complexity without broadening permissions:

- removed the old assignment-parity helper functions that were no longer used by the active create/update rules
- kept the thin auth/path/basic-schema checks in place
- left the business-critical equality checks to the backend transaction boundary

This reduces the rules-layer work associated with the old assignment-pairing logic and narrows the Rules layer to policy/validation rather than cross-document integrity enforcement.

### Changed in tests

A focused parity regression test was added in `src/utils/siCardAssignments.test.ts` to assert that assignment-owner and competitor-ID drift is rejected by the server-side identity guard.

## Validation

### Build

Command run:

```bash
npm run lint
```

Result:

- PASS

### Firestore rules suite

Command run:

```bash
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'; node --import tsx --input-type=module -e "import('./firestore.rules.test.ts').then(m => m.runFirestoreRulesDirtyDozenSuite()).catch(e => { console.error(e); process.exitCode = 1; })"
```

Result:

- FAIL
- The emulator still rejects a rules write in the suite after the first server-side migration slice.
- The latest reported failing assertion is in the write-once receipt path and is in the same area as the remaining Rules-layer enforcement work:

```ts
await assertSucceeds(
  raceAdminCtx
    .firestore()
    .doc('competitions/evt_live/readoutReceipts/ro_test_1')
    .delete()
);
```

The exact failure emitted by the emulator is a `PERMISSION_DENIED` on the readout receipt path, which confirms the remaining Rules-layer blockers are not yet solved by the assignment-parity migration alone.

## Expression-limit impact

The first migration slice removed unused assignment-parity helpers from `firestore.rules`, which reduces expression count and keeps the architecture aligned with the server-side enforcement model.

However, the suite still fails. This means:

- the assignment-parity slice is successfully moved to the backend boundary
- the remaining expression-limit burden is not fully resolved yet
- additional migration slices are still required for the remaining readout/shared policy checks if the goal is a fully green rules suite

## Readiness impact

This slice is a measured improvement, not a full readiness clearance:

- reduced rule complexity on the assignment parity path
- preserved Atomic SI Matching and ownership consistency in the backend
- not sufficient to declare the rules suite green

Current status: partial progress, not ready for full cutover or deployed-rules assurance.

## Final status

- Build: PASS
- Lint: PASS
- Rules suite: FAIL
- Remaining blocker: readout receipt / remaining Rules-layer logic still exceeds the acceptable enforcement boundary for the current suite

This is a valid first migration slice, but it does not yet resolve the overall Firestore Rules expression-limit blocker.
