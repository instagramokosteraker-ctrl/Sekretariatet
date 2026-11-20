# Wrong-competitor reassignment failure analysis

## Conclusion

The displayed message is thrown by the server-side transaction in
`reassignReadoutResult`. It means at least one term in the ambiguity guard was
true:

1. The source competitor does not have exactly one processed receipt, or its
   sole processed receipt's document ID is not this `readoutId`.
2. The target competitor has at least one processed readout receipt.
3. An applied correction audit already exists for this readout.

The current workspace contains the application source and a screenshot-visible
live UI state, but not the corresponding Firestore receipt or correction
documents. Therefore the exact true term, and any actual receipt counts,
competitor document IDs, operation ID, or audit entries, cannot be established
from the available evidence. The report does not guess among those alternatives.

## Selected readout visible in the live UI

The currently open correction panel identifies the selected item as follows:

| Field | Observed value |
|---|---|
| Competition | Provlöpning - O-ringen 2027 E1 (UI label truncated) |
| Competition ID | `evt-1794746557864-xnwuab` (from the visible URL) |
| Readout label | Avläsning nr 2 |
| SI number / card | `429898` / SI-Card 5 |
| Captured at | `2026-11-17 21:50:16` |
| Original/current competitor shown | Daniel Nygårds |
| Result status shown | `MP` |
| Proposed target shown | Mikael Svartz |
| Reason shown | Sprang med fel bricka |
| `readoutId` | Not rendered in the visible UI; actual ID unavailable |
| Source `competitorId` | Not rendered; actual ID unavailable |
| Target `competitorId` | Not rendered; actual ID unavailable |

These are UI labels, not substitutes for the Firestore document IDs.

## Requested record fields

| Requested value | Finding |
|---|---|
| `readoutId` | Unknown from available evidence. The request uses `record.clientReadoutId` as the route's `:readoutId` (`src/App.tsx:1285`). |
| `competitorId` | The UI shows Daniel Nygårds as the original/current match, but the canonical ID is not displayed. The server takes this ID from the selected receipt's `competitorId` (`src/server/readoutReassignment.ts:348-350`). |
| Receipt count | The selected receipt exists and is processed: otherwise this exact error would not be reached. The count of processed receipts for the source and target competitors is not exposed by the UI and was not available locally. Those are the two counts used by the guard. |
| `correctionOperationId` | Unknown. A request operation ID is generated/reused in browser local storage (`src/App.tsx:1278-1282`); the history record's `correctionOperationId` is only updated after a successful response (`src/App.tsx:1333`). This failed request does not reveal either stored value. |
| Reassignment audit records | Not available in the workspace evidence. The server reads audits from `competitions/{competitionId}/readoutCorrections` filtered by `readoutId` (`src/server/readoutReassignment.ts:213-237`). No live audit query result was available to this analysis. |

Because execution reached the reported guard, the following earlier checks
also passed for the request that produced this message: the competition and
authorized actor existed; the operation ID did not resolve to a replay or a
different-payload conflict; the selected receipt existed and matched its
readout ID, competition ID, `PROCESSED` status, and a valid source competitor
ID; the target differed from the source; both competitor documents existed;
the source result status was eligible; and the source had no manual finish
time. The visible `MP` source status is currently an eligible status.

## Exact source and failing condition

- **File:** `src/server/readoutReassignment.ts`
- **Function:** `reassignReadoutResult`
- **Function starts:** line 242
- **Receipt/audit queries:** lines 367-382
- **Processed-receipt filters and prior-audit test:** lines 404-412
- **Failing `if` condition:** lines 413-417
- **Thrown message:** line 421

The exact condition is:

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

`competingSourceReceipts` counts receipts whose `status` is `PROCESSED` and
whose `competitorId` equals the source competitor (`:404-406`).
`competingTargetReceipts` similarly counts processed receipts for the target
(`:407-409`). `priorReassignment` is true if any correction document for this
readout has `result.status === 'APPLIED'` (`:410-412`).

Given that the selected receipt itself was validated as `PROCESSED` and its
`competitorId` became the source ID before these queries, a consistent
Firestore query should include that receipt in `competingSourceReceipts`.
Thus a source-count failure would mean more than one processed source receipt;
the zero-receipt and sole-wrong-ID cases are inconsistent with the validated
selected receipt. This does **not** rule out a processed target receipt or a
prior applied audit. Those zero/mismatched-ID cases remain explicit guard
clauses and could indicate inconsistent data/query results if observed.

## Check order leading to this message

The checks before this guard are in `src/server/readoutReassignment.ts`:

1. **Request validation** (`:251-267`): valid competition/readout/user IDs;
   object request; valid operation ID and target ID; trimmed reason length
   between 3 and 500.
2. **Transaction and actor authorization** (`:282-317`): competition must
   exist; actor must be a super admin, owning race admin, or authorized
   readout/forest official.
3. **Operation idempotency** (`:320-343`): an existing operation with the
   same request returns `REPLAYED`; reuse with a different payload throws a
   different error. Reaching the reported message means this branch did not
   return or throw.
4. **Selected receipt validation** (`:344-360`): receipt must exist, identify
   this readout and competition, have `PROCESSED` status, and contain a valid
   source competitor ID. The target must differ from the source.
5. **Source/target document checks** (`:367-401`): both competitors must exist;
   source status must be reassignment-eligible; source must not have a manual
   finish time.
6. **Ambiguity guard** (`:404-421`): the combined condition above. This is the
   source of the displayed message.

The API route is
`POST /api/firestore/competitions/:competitionId/readouts/:readoutId/reassignment`
in `server.ts:4503-4536`. `ReadoutDashboard.handleApplyResultReassignment`
surfaces the thrown API message in the UI (`src/components/ReadoutDashboard.tsx:650-686`).

## A-D classification

| Choice | Can the available evidence confirm it? | Corresponding server test |
|---|---|---|
| **A. Multiple receipts** | **Possible, not confirmed.** | More than one processed source receipt, or at least one processed target receipt. |
| **B. Existing reassignment** | **Possible, not confirmed.** | At least one correction document for this `readoutId` has `result.status === 'APPLIED'`. |
| **C. Multiple matching readouts** | **Possible, not confirmed.** This overlaps A when the source has multiple processed receipts; the code counts receipt documents by source `competitorId`, not by a separate "matching readout" concept. | `competingSourceReceipts.length > 1`. |
| **D. Other** | **Possible only as an inconsistent/missing source query result; not supported by the observed request path.** | Zero processed source receipts or one processed source receipt whose document ID differs from `readoutId`. The validated selected receipt should make both impossible in a consistent transaction. |

**Specific trigger: undetermined from available evidence.** The server code
uses an OR, so even knowing one branch was true would not establish that it was
the only true branch. To identify the exact trigger, inspect the selected
competition's `readoutReceipts` for the source and target competitor IDs and
`readoutCorrections` filtered by the selected `readoutId`, recording document
IDs, statuses, and `result.status`. The guard has four clauses: source count
not equal to one, sole source receipt ID mismatch, any processed target receipt,
or any applied audit.

## No code changes

This is a root-cause analysis only. No application code was changed.
