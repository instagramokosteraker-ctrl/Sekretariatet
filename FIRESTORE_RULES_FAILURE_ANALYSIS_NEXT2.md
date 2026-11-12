# Firestore Rules failure analysis — after emulator cleanup

## Result

**FAIL.** The rules suite now starts from a clean Firestore Emulator database.
The role-invite and role-assignment fixtures are reseeded by the suite, and it
passes the role-claim section.

The next concrete failure is:

```ts
await assertFails(
  raceAdminCtx
    .firestore()
    .doc('competitions/evt_live/siCardAssignments/8500111')
    .update({
      state: 'RETIRED',
      assignmentVersion: 2,
      updatedAt: serverTimestamp(),
      retiredAt: serverTimestamp(),
      retirementReason: 'assignment-only-dns-test',
    })
);
```

The emulator reports: **“Expected request to fail, but it succeeded.”**
This is at `firestore.rules.test.ts:476`.

## Fixture cleanup and reseeding

Added `await testEnv.clearFirestore();` at the start of the suite's `try` block,
immediately after `initializeTestEnvironment()` and before fixture creation.

The cleanup is followed by:

- the initial `withSecurityRulesDisabled` seed of both admin profiles, the
  readout role assignment, runner records, admin invites, and the live and
  completed competitions;
- the test's role-invite creation and atomic role-claim batch;
- the later `withSecurityRulesDisabled` seed of assignment/competitor mismatch
  fixtures;
- regular test writes for the remaining cases.

The previously stale `roleAssignments/official_uid` and
`roleInvites/inv_official` documents are therefore recreated in the expected
initial state. The suite passed beyond the claim batch on this run.

## Next failing request

The request targets
`/competitions/evt_live/siCardAssignments/8500111` and updates the assignment
from `ACTIVE` to `RETIRED` without a corresponding competitor update in the
same commit. The test expects this standalone assignment mutation to be denied,
but the current `allow update` rule validates the assignment schema,
immutability, timestamp, and owner/admin authorization without requiring a
matching competitor write in the commit. The emulator therefore accepts it.

This report only identifies the next failure. No Rules changes or further test
changes were made.

## Change scope

- Modified: `firestore.rules.test.ts` (emulator cleanup only)
- Not modified: `firestore.rules`
- Rules suite: **FAIL**
- Next failing assertion: standalone SI assignment retirement at test line 476
