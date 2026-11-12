# Role-claim batch analysis

## Conclusion

The role claim is designed to succeed when run against a fresh fixture containing
an active invitation and no existing role assignment. An isolated emulator
reproduction of those two writes passed.

The failure attributed to `assertSucceeds(claimBatch.commit())` is consistent
with stale Firestore Emulator data, not a bad security rule. Inspection of the
same emulator project used by the suite found:

- `roleAssignments/official_uid` already exists.
- `roleInvites/inv_official` is already claimed (`active: false`,
  `claimedUid: 'official_uid'`).

The suite initializes its test environment and seeds fixtures, but does not
clear Firestore first. Consequently, its initial `roleInvite.set(...)` may
operate on an old, claimed invite rather than create a new active invite. In
that state, the test's earliest failing success expectation is likely the
`roleInvite.set(...)` assertion, before `claimBatch.commit()`. If execution
does reach the batch with the stale assignment still present, that batch is
also correctly denied.

**PASS expectation valid? YES** — for the intended fresh-state claim. The test
fixture must guarantee that state on every run.

## Exact batch writes

`claimBatch` in `firestore.rules.test.ts` contains two writes:

1. `set roleAssignments/official_uid` with:
   - `uid: 'official_uid'`
   - `inviteId: 'inv_official'`
   - `email: 'official@klubb.se'`
   - `role: 'START'`
   - `createdByUid: 'race_admin_1'`
   - server timestamps for `createdAt` and `updatedAt`
2. `update roleInvites/inv_official` with:
   - `active: false`
   - `claimedUid: 'official_uid'`
   - server timestamp for `updatedAt`

The authenticated caller is `official_uid`, with verified email
`official@klubb.se`.

## Matching Rules and predicates

### `roleAssignments/{userId}` create

The fresh-state `set` matches `allow create` when `userId == request.auth.uid`.
The create rule checks:

- verified authentication and a valid matching user ID
- `isValidRoleAssignment(incoming())`, including the allow-listed shape and
  official role
- payload UID/email match the authenticated user
- both timestamps equal `request.time`
- the invite exists after the batch
- the after-state invite email, role, creator, inactive state, and
  `claimedUid` match the assignment and caller

For the test payload and a fresh invite, these conditions are satisfied.

### `roleInvites/{inviteId}` update

The update matches the self-claim branch when:

- the invitation exists and passes `isValidRoleInvite`
- immutable invitation fields remain equal
- `updatedAt == request.time`
- the prior invitation is active and its email matches the caller
- the new invitation is inactive and `claimedUid` is the caller
- only `active`, `claimedUid`, and `updatedAt` change
- the role assignment exists after the batch and has the invited role

Those conditions are also satisfied for the intended fresh-state batch. The
admin-only branch is not needed for this self-claim.

## Why stale state is denied

The same fixed document paths are reused on every test invocation, and the test
does not call `testEnv.clearFirestore()` before seeding.

With the observed stale documents:

- The initial invite `.set(...)` is an update, not a create. It attempts to
  reactivate a previously claimed invite and remove `claimedUid`. The admin
  update branch does not permit that field change, while the self-claim branch
  requires the existing invite to be active and the incoming invite to become
  inactive. Neither branch authorizes that write.
- If the batch is attempted while `roleAssignments/official_uid` already
  exists, its `set` is evaluated as an update. The assignment update rule
  requires `isAdmin()`, which `official_uid` is not. The invite's existing
  claimed/inactive state also does not satisfy the self-claim branch.

These are intentional denials: a claimed role assignment must not be overwritten
by an ordinary official, and a claimed invitation must not be reactivated or
reused.

## Historical intent and expected security model

The documented flow issues an official role through an email invitation, then
lets the verified recipient claim it using the same account. The Rules
cross-check both documents after the batch so neither an assignment nor an
invite claim can be written independently. The backend's
`claimOfficialRoleInvite(...)` follows the same atomic two-write flow.

The intended security model is therefore:

- only a verified invitee whose email matches may claim the invite
- the assignment and invite transition must commit together
- existing assignments and already-claimed invitations cannot be overwritten
  or reused by a non-admin

The current Rules implement that model. No Rules fix is indicated.

## Minimal test correction

Ensure an empty emulator database before creating the test fixtures. The
smallest general fix is to clear the test project's Firestore immediately after
initializing the test environment and before seeding any documents:

```ts
await testEnv.clearFirestore();
```

This makes the role invite a create, the role assignment absent before the
claim, and the suite deterministic across repeated emulator runs. No change to
the role-claim assertion or `firestore.rules` is required.

## Validation performed

- Read the test, Rules, and backend claim implementation.
- Ran an isolated emulator reproduction of the two-write batch with a fresh
  active invite and no assignment: **PASS**.
- Read the existing documents in the suite's emulator project without changing
  them: both role documents were already present in the claimed state.
- Did not rerun the full Rules suite or modify `firestore.rules` or
  `firestore.rules.test.ts`.
