# READOUT Field Permission Remediation

## Change

The competitor update rule now limits official writes to two narrow cases:

- READOUT rental return: affected keys must be limited to `rentalReturned`,
  `billingFieldsUpdatedAt`, and `updatedAt`. Both rental fields must change,
  and `billingFieldsUpdatedAt` must equal `request.time`.
- READOUT, FOREST, or SPEAKER readout results: affected keys must be limited
  to `status`, `checkTimeSec`, `startTimeSec`, `finishTimeSec`,
  `runningTimeSec`, `readoutAtIso`, `punchCodes`, `punchTimes`, and
  `updatedAt`. `readoutAtIso` must change, so a standalone status update is
  rejected.

The existing owner, admin, and super-admin authorization paths are unchanged.
`feePaid`, SI identity, receipt linkage, billing-only changes, rental/status
mixes, and unrelated competitor fields are not available through the official
branches. The existing competitor schema and immutable identity checks remain
in force.

## Tests

The Rules tests verify that:

- rental return succeeds;
- `feePaid`, billing-timestamp-only, rental/status mixed, status-only, and
  SI-number updates fail;
- a valid bundle of readout-result fields succeeds.

## Validation

- Build: **PASS** (`npm run build`)
- Lint/type check: **PASS** (`npm run lint`)
- Firestore Rules suite: **FAIL**

The READOUT permission assertions pass. The suite next fails at the blanket
list-scraping assertion in `firestore.rules.test.ts`: `assertFails` expected
`attackerCtx.firestore().collection('competitions').get()` to fail, but it
succeeded. The test context is authenticated and email-verified, while the
parent competitions rule currently allows list access to every verified user.
This is a separate list-access issue and was not changed as part of this
READOUT field restriction.

The emulator also reported expression-limit errors on other Rules paths during
the suite. Those are not the terminating assertion above; the suite remains
non-green and those errors require separate follow-up.
