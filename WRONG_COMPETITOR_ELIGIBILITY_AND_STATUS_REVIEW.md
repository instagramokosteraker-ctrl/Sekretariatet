# Wrong-competitor eligibility and status review

## Conclusion

The reported rejection is explained by a mismatch between the local timeline
projection and the authoritative Firestore readout receipt when an
`UNKNOWN_CARD` readout is resolved through direct entry.

The UI changes that history record to `PROCESSED`/`SYNCED` and associates the
new competitor, but the direct-entry persistence flow does not promote the
corresponding Firestore receipt. The receipt created when the card was first
read therefore remains `UNKNOWN` with an empty `competitorId`. The UI's
reassignment predicate does not check either the receipt or the original
competitor ID, so it still offers **Fel löpare**. The server correctly rejects
the receipt as not eligible.

The displayed `Fel löpare` issue can also persist after the failed attempt:
`applyReadoutResultReassignment` writes `WRONG_COMPETITOR`/`OPEN` to local
history before sending the request. A server rejection does not roll that
write back, so the timeline subsequently shows the issue and orange row.

This is primarily a receipt-lifecycle consistency bug (D), which manifests as
a UI eligibility bug (A). The request uses the timeline row's readout ID to
look up the corresponding receipt, so the inspected source does not indicate a
row-to-receipt ID mismatch (C) or an incorrect lookup (B).

## Server-side guard and receipt identity

The API route in `server.ts` passes `req.params.readoutId` to
`reassignReadoutResult`. The App builds that route using
`record.clientReadoutId`. The server reads:

```text
competitions/{competitionId}/readoutReceipts/{readoutId}
```

In this flow, `readoutId` is the timeline record's
`clientReadoutId`; it is also used as the receipt's document ID, `receiptId`,
and `clientReadoutId`.

In `src/server/readoutReassignment.ts`, the guard that emits
“Readout receipt is not a processed result.” requires all of the following:

- receipt `receiptId` and `clientReadoutId` equal `readoutId`;
- receipt `competitionId` equals the requested competition;
- receipt `status` is exactly `PROCESSED`;
- the receipt's original `competitorId` is a valid ID; and
- the resolved current competitor ID is a valid ID.

The error groups these checks together; it does not report which predicate
failed. The literal receipt ID for the operator's incident is not present in
the supplied report. It is the selected row's `clientReadoutId`, and can be
confirmed from the failing request URL or the Firestore document path.

For the specific `UNKNOWN_CARD` → direct-entry lifecycle found in the code,
the stored receipt status is deterministically `UNKNOWN`: the initial
unknown-card write creates the receipt with `status: 'UNKNOWN'` and
`competitorId: ''`. The direct-entry flow does not update that document.
Consequently, that receipt also fails the valid-original-competitor check.

If the reported row was not resolved through this flow, the exact production
receipt value cannot be proven from source alone. The server's combined error
does not distinguish status, identity, or competitor-field failures, so that
case requires checking the document at the path above.

## Why the UI offers reassignment

`isEligibleWrongCompetitorReadout` in
`src/services/readoutHistoryStore.ts` checks only that the local record has:

- `readoutState === 'PROCESSED'`;
- a non-null `competitorId`; and
- a reassignable result status (`OK`, `MP`, or `PRELIMINARY_FIN`).

It does not check `originalCompetitorId`, a server receipt state, or whether
the corresponding receipt is valid.

The direct-entry handler in `src/App.tsx` sets the local history record to
`PROCESSED` and `SYNCED`, and fills in its current competitor and result after
the competitor save succeeds. It does not update the receipt or set the
original-competitor fields. `saveDirectCompetitionEntryToFirestore` persists
the competitor/assignment; its API request does not include the pending
readout ID, and the function does not write a readout receipt.

The row's **Fel löpare** button and the expanded reassignment form both use the
same local eligibility helper. The confirmation path repeats that local check
before posting, so neither stage can detect the stale or ineligible
Firestore receipt. Before the request, `getWrongCompetitorIssueUpdateForConfirmation`
marks the local issue open. The server-error path leaves that issue update in
place, which explains the observed `OK · Fel löpare · Synkad` row after the
rejection.

`deliveryState: 'SYNCED'` in this path only reflects the direct-entry save.
It is not proof that the readout receipt was promoted or synchronized.

## Status presentation

Current presentation is assembled in `src/utils/readoutStatusPresentation.ts`
and `src/components/ReadoutHistoryRow.tsx`:

- `getReadoutStatusPresentation` prioritizes an open issue over result status,
  assigning the entire row the orange `action` surface even when the result is
  `OK`.
- `getReadoutStatusText` combines result and issue into one string, producing
  `OK · Fel löpare`.
- `OPEN` has no separate issue-state label, so the row does not explicitly say
  the issue requires action.
- Delivery is rendered on a second line as plain text (`Synkad`), rather than
  as a distinct status indicator.

Thus, result, issue, and delivery are all present, but not visually independent;
the background reflects the issue, not the result.

### Recommended model

Render three independent indicators:

1. **Result** — e.g. `OK`, `MP`, with the row's base color derived from this.
2. **Issue** — e.g. `Fel löpare · Åtgärd krävs`, using an issue-specific badge
   for open/in-progress state and a muted/resolved badge otherwise.
3. **Delivery** — e.g. `Synkad`, `Väntar på synk`, or `Sparfel`, with its own
   delivery color.

Do not concatenate the labels or let the issue badge determine the row's base
result color.

## Smallest safe fix

The durable fix is to make the direct-entry flow update the readout receipt
when it attaches a previously unknown readout to the newly created competitor.
Do this in the server-side direct-entry transaction: verify the existing
receipt belongs to the same competition and readout payload, then promote it
to `PROCESSED` and set valid original/current competitor IDs. Only mark local
history `PROCESSED`/`SYNCED` after that receipt update succeeds. If the
receipt cannot be safely matched, leave the readout ineligible and surface the
receipt failure rather than a success-shaped local state.

As a defensive UI gate, require a valid original competitor ID in
`isEligibleWrongCompetitorReadout`; the direct-entry flow must populate that
field only when the receipt has been successfully associated. The server
guard remains authoritative.

Also defer the local `WRONG_COMPETITOR`/`OPEN` update until the reassignment
request succeeds, or explicitly roll it back when the request fails. A failed
attempt must not leave the row looking as though an issue was successfully
opened.

Separately, improve the server error/diagnostics so a rejected receipt reports
which predicate failed (without exposing sensitive payload data). That is
useful for future production diagnosis, but is not a substitute for fixing the
local/server state mismatch.

## Files and functions involved

- `server.ts` — `POST .../readouts/:readoutId/reassignment` route.
- `src/server/readoutReassignment.ts` — receipt lookup and processed-result
  guard in `reassignReadoutResult`.
- `src/firebase.ts` — unknown receipt creation in `submitReadoutToFirestore`;
  direct-entry persistence in `saveDirectCompetitionEntryToFirestore`.
- `src/App.tsx` — `handleCreateDirectEntry` promotes the local history record;
  `applyReadoutResultReassignment` posts the selected row ID.
- `src/services/readoutHistoryStore.ts` — `isEligibleWrongCompetitorReadout`.
- `src/components/ReadoutHistoryRow.tsx` — row action visibility and status
  presentation.
- `src/utils/readoutStatusPresentation.ts` — row tone, combined status text,
  issue summary, and delivery label.
- `src/components/ReadoutDashboard.tsx` — expanded reassignment action/form.

This is a root-cause review only; no application code was changed.
