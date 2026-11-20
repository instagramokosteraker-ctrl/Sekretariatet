# Wrong-competitor live-data diagnosis

## Result

**None of the four guard branches is true in the Firestore query results
provided for this diagnosis.** Those results cannot produce the reported
ambiguity error if they are complete and came from the same competition,
database, and transaction-time state used by the failing request.

The server throws the message only when at least one of the four branches is
true in `reassignReadoutResult`
(`src/server/readoutReassignment.ts:413-421`). The supplied query values make
all four false. Therefore the exact trigger at the time of the reported failure
cannot be attributed to these documents; the error and supplied query results
are inconsistent.

## Selected receipt and competitors

| Record | Firestore document ID | Relevant fields supplied |
|---|---|---|
| Competition | `evt-1794746557864-xnwuab` | The competition for the selected readout |
| Selected readout receipt | `ro-30dd955e-e6c9-4dc9-8f91-da958c453480` | `status: PROCESSED`; `competitorId: cmp_ro_1426msb_l5zmjn`; `clientReadoutId` and `receiptId` match the document ID; SI `429898`; card series `SI-Card 5` |
| Source competitor | `cmp_ro_1426msb_l5zmjn` | Daniel Nygårds; `status: MP`; `readoutReceiptId` points to the selected receipt |
| Target competitor | `evtcmp-1794746557864-18` | Mikael Svartz; `status: REGISTERED`; `readoutAtIso` empty; no finish or punches |

These are the relevant values from the Firestore documents/query results supplied
by the user. Local Admin SDK credentials were unavailable, and the Firebase
Console collection listing returned 403, so the document data below is assessed
against the server predicate as supplied rather than independently re-queried.

## Guard inputs and evaluation

The server builds the source and target receipt arrays by querying
`readoutReceipts` for each competitor ID, then retains only receipts with
`status === 'PROCESSED'` (`src/server/readoutReassignment.ts:380-381,
404-409`). `readoutId` is
`ro-30dd955e-e6c9-4dc9-8f91-da958c453480`.

| Guard branch | Supplied data | Evaluation |
|---|---|---|
| **A. `competingSourceReceipts.length !== 1`** | One source receipt is listed: `ro-30dd955e-e6c9-4dc9-8f91-da958c453480`, `PROCESSED`. | `1 !== 1` -> **false** |
| **B. `competingSourceReceipts[0]?.id !== readoutId`** | The only listed processed source receipt document ID equals `readoutId`. | `ro-30dd955e-e6c9-4dc9-8f91-da958c453480 !== ro-30dd955e-e6c9-4dc9-8f91-da958c453480` -> **false** |
| **C. `competingTargetReceipts.length > 0`** | The supplied target entry has ID `evtcmp-1794746557864-18` and status `REGISTERED`; no `PROCESSED` target receipt is listed. | The `REGISTERED` entry is excluded by the server filter. Processed target count from the supplied results is `0`; `0 > 0` -> **false** |
| **D. `priorReassignment`** | `readoutCorrections` query count is `0`. | No matching applied correction was found; **false** |

There are no target receipt IDs to list for branch C in the supplied results.
The `REGISTERED` record is the competitor document (or, if it was returned from
the receipt query, it is not counted as processed). The receipt schema also
allows only `UNKNOWN` or `PROCESSED` statuses
(`firestore.rules:2062`).

## Exact source

- **File:** `src/server/readoutReassignment.ts`
- **Function:** `reassignReadoutResult` (starts at line 242)
- **Receipt filtering:** lines 404-412
- **Combined guard:** lines 413-417
- **Error throw:** lines 419-421

```ts
if (
  competingSourceReceipts.length !== 1 ||
  competingSourceReceipts[0]?.id !== readoutId ||
  competingTargetReceipts.length > 0 ||
  priorReassignment
) {
  throw new ReadoutReassignmentError(
    409,
    'Multiple or previously reassigned readouts make this correction ambiguous.'
  );
}
```

## Exact finding

**No listed branch evaluates to true from the supplied Firestore results.**
Consequently, no exact failing branch can be named without a transaction-time
query result that differs from the values above. This is not evidence that A,
B, C, or D triggered; it shows that the reported error does not match the
provided complete data.

If the source/target receipt lists were partial, or if the request used a
different database/event or a different snapshot, the missing transaction-time
documents would be needed to identify the actual branch. No design changes are
proposed.
