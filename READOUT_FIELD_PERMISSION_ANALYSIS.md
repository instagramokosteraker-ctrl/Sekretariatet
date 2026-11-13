# READOUT competitor update permission analysis

## Conclusion

**Test is correct, rule permissions are too broad.**

The failing write matches
`/competitions/{competitionId}/competitors/{competitorId}`'s `allow update`
rule. Its final authorization expression grants writes to
`canCreateReadoutCompetitor()`, which includes users with the READOUT role. The
rule validates the resulting document's schema and preserves
`competitorId`, `competitionId`, `ownerUid`, and `createdAt`, but does not limit
which other fields an official may change.

## Current READOUT permissions

`isValidCloudCompetitor(incoming())` permits the schema's mutable fields,
including:

- `feePaid` and `rentalReturned`
- competitor identity and registration fields such as `bib`, `fullName`,
  `club`, `classId`, `siNumber`, and `cardSeries`
- `status`, start/finish times, `readoutAtIso`, punch arrays, and optional
  `readoutReceiptId`, `isSelfRegistered`, and `billingFieldsUpdatedAt`

The immutable checks in the update rule prevent changes to the document IDs,
owner, and creation timestamp. They do not prevent a READOUT official from
changing `feePaid` or other mutable fields.

## Intended behavior

The test explicitly permits a READOUT official to update
`rentalReturned`, `billingFieldsUpdatedAt`, and `updatedAt`, and expects an
update to `feePaid` to fail. This matches
`updateCompetitorBillingFieldsInFirestore`: its client-side authorization only
allows a READOUT official's rental update and rejects fee updates. Normal
readout processing also needs to update result fields such as status, times,
and punches. Therefore the official rule branch needs field allowlists rather
than a blanket denial of all fields other than rental return.

## Minimal field-level restriction

Keep the existing admin authorization branch. Replace the broad
`canCreateReadoutCompetitor()` alternative with two scoped official-write
alternatives:

1. READOUT-only rental return: affected keys limited to
   `rentalReturned`, `billingFieldsUpdatedAt`, and `updatedAt`, and require
   `billingFieldsUpdatedAt == request.time` when that field is updated.
2. READOUT/FOREST/SPEAKER result updates: affected keys limited to `status`,
   `checkTimeSec`, `startTimeSec`, `finishTimeSec`, `runningTimeSec`,
   `readoutAtIso`, `punchCodes`, `punchTimes`, and `updatedAt`.

This preserves the intended rental-return and readout-result writes while
excluding `feePaid`, SI identity changes, and mixed rental/status mutations
from the official branches. No Rules or test files were changed for this
analysis.
