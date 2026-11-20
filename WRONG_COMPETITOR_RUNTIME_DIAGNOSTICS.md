# Wrong-competitor runtime diagnostics

## Instrumentation

`src/server/readoutReassignment.ts`, in `reassignReadoutResult`, now emits a
server-side `console.warn` entry immediately before the ambiguity guard
(structured payload at line 420), but only when at least one branch evaluates
true.

The entry uses the label
`[readout-reassignment] Ambiguity guard diagnostics` and includes:

- `readoutId`
- `sourceCompetitorId`
- `targetCompetitorId`
- `competingSourceReceipts`: document IDs and statuses
- `competingTargetReceipts`: document IDs and statuses
- `priorReassignment`
- `branches`: booleans for `sourceReceiptCountNotOne`,
  `sourceReceiptIdMismatch`, `targetReceiptCountGreaterThanZero`, and
  `priorReassignment`

The log is server-side only. No diagnostic fields were added to the API
response. The original ambiguity `if` condition and error behavior are
unchanged.

## Runtime capture status

No live reassignment request was submitted as part of this change, because a
request could succeed and mutate competition results if the current data differs
from the earlier query. Consequently, this change does not claim to contain the
production runtime values. The actual values will be captured in the server
log the next time a request reaches the guard with one or more true branches.

## Verification

`src/server/readoutReassignment.test.ts` includes an emulator-backed case that
adds one processed target receipt, verifies the same 409 ambiguity error, and
asserts that the server log contains the receipt IDs/statuses and the exact
true branch. The test does not apply the reassignment.

- `npm run lint` passed.
- `firebase emulators:exec --project demo-passersi-readout-reassignment-tests --only firestore "npx vitest run --testTimeout 20000 src/server/readoutReassignment.test.ts"` passed: 9 tests.
- No live production reassignment was submitted; production runtime values are not yet captured.
