# Readout receipt delete analysis

## Failing assertion

```ts
await assertSucceeds(
  raceAdminCtx.firestore()
    .doc('competitions/evt_live/readoutReceipts/ro_test_1')
    .delete()
);
```

## Exact rule path

The delete is evaluated by:

```firestore
match /competitions/{competitionId}/readoutReceipts/{receiptId} {
  allow get: if ...
  allow list: if ...
  allow create: if ...
  allow update: if false;
  allow delete: if false;
}
```

This is the exact path for `/competitions/{competitionId}/readoutReceipts/{receiptId}` in [firestore.rules](./firestore.rules).

## Which rule matched and which predicate failed

The delete path is denied by the dedicated delete rule itself:

```firestore
allow delete: if false;
```

No other predicate is evaluated because the rule is a hard deny. The emulator output confirms the effective reason:

```text
false for 'delete' @ L8, false for 'delete' @ L1297
```

The `L8` condition is the global default deny catch-all;

```firestore
match /{document=**} {
  allow read, write: if false;
}
```

and the `L1297` condition is the explicit `allow delete: if false;` on the readout receipt path.

## Why the test expected success

The failing test expectation was written as a positive delete assertion, but it does not match the repository’s security specification or the intended readout-receipt lifecycle.

The authoritative contract is documented in [security_spec.md](./security_spec.md):

- "Readout receipts and online station punches are write-once, admin-scoped, and idempotent."
- "Neither collection permits updates or deletes."

This matches the historical intent described elsewhere in the repo:

- readout receipts are immutable audit records
- they represent processed input tied to a stable client ID
- they are retained for replay and forensic analysis
- they should not be deleted by normal admin workflow

In other words, delete success was never the intended behavior for a processed readout receipt.

## Why the current rule denies the write

The current implementation intentionally enforces the write-once model:

- `allow create` is permitted for verified competition admins / readout-capable roles
- `allow update: if false;`
- `allow delete: if false;`

This makes the document effectively immutable after creation, which is exactly the desired security model for processed receipt records.

## Is the denial intended or accidental?

This denial is intended.

It is not an accidental regression. The design goal is to keep readout receipts as permanent, immutable proof of an observed readout. Deleting them would break auditability, replay safety, and the canonical identity of the processed SI event.

## Test-vs-rules verdict

PASS expectation valid? NO

The test is wrong, not the rule.

The correct behavior should be a denied delete, consistent with the repo security specification and the existing rule architecture.

## Minimal correction

The minimal fix is to change the assertion from success to failure:

```diff
-    await assertSucceeds(
-      raceAdminCtx
-        .firestore()
-        .doc('competitions/evt_live/readoutReceipts/ro_test_1')
-        .delete()
-    );
+    await assertFails(
+      raceAdminCtx
+        .firestore()
+        .doc('competitions/evt_live/readoutReceipts/ro_test_1')
+        .delete()
+    );
```

No Firestore Rules change is needed here: the delete deny is already the correct policy.

## Final conclusion

The denial is correct and intentional.

The readout receipt collection is a write-once immutable audit log, and deletion is forbidden by the rules. The test expectation was incorrect; it should be `assertFails` rather than `assertSucceeds`.
