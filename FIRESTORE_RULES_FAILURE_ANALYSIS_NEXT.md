# Firestore Rules failure analysis — next assertion

## Result

**FAIL** — `runFirestoreRulesDirtyDozenSuite()` exited with `PERMISSION_DENIED`.

The readout-receipt delete assertion is already corrected to `assertFails` in
`firestore.rules.test.ts`. The requested test-only correction is present; no
changes were made to `firestore.rules`.

## Next failing assertion

The next success expectation indicated by the emulator diagnostics is:

```ts
await assertSucceeds(claimBatch.commit());
```

This is the role-claim batch in `firestore.rules.test.ts`, which creates
`roleAssignments/official_uid` and updates `roleInvites/inv_official` in one
commit.

The emulator reports evaluation errors in the role-invite create/update rules
(the `roleInvites` match, `allow create` / `allow update`). The test source
order and diagnostics identify the role-claim batch as the likely failing
operation. The run did not reach the later readout-receipt assertions.

## Scope and follow-up

This is a separate role-invite / role-assignment claim-path failure, not a
readout-receipt delete failure. No Rules or additional test changes were made,
since this request was limited to correcting the receipt-delete expectation
and identifying the next failure.

The emulator output did not include a test-file stack location, so the exact
assertion attribution is based on the reported Rules locations and test
execution order. A focused follow-up should investigate the atomic role-claim
batch before continuing to the receipt assertions.
