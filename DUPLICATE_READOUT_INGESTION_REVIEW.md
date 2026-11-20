# Duplicate readout ingestion review

## Decision

For a **new readout ID whose complete logical payload exactly matches an
already `PROCESSED` receipt for the same competitor**, choose **B**:

- Do not create another `PROCESSED` receipt.
- Do not reapply the result, public-result projection, or competition counters.
- Keep the new capture as its own local history row, marked
  `issueType: 'DUPLICATE_READOUT'` and `issueState: 'NONE'`.

This preserves the capture history without treating identical card contents as
a second result source. Limit this classification to an exact payload match;
matching only the SI number or only the raw data is not sufficient. A retry
with the **same** `clientReadoutId` remains the existing idempotent replay path,
not a new duplicate row.

## Trace of `submitReadoutToFirestore()`

In `src/firebase.ts`, `submitReadoutToFirestore`:

1. Normalizes the SI number, card times, and punches, then resolves the
   competitor for the readout (`:6449-6695`).
2. Uses `clientReadoutId` as the Firestore receipt document ID and constructs a
   receipt payload containing SI/card metadata, times, punches, and `rawHex`
   (`:6542-6545, 6681-6702`).
3. Starts a transaction that reads the competition and the receipt at that same
   document ID; it does not search other receipts for a payload match
   (`:6831-6834`).
4. If that ID already exists, it validates the payload and returns the stored
   outcome (`:6844-6851`). This makes a retry with the same ID idempotent.
5. If that ID does not exist, it updates the competitor/result projection and
   writes a new `PROCESSED` receipt (`:6870-6935`). It does **not** query other
   receipts for an identical payload on this normal existing-competitor path.

Consequently, a second capture with a new ID passes the existing-ID check even
when all card data match a previous receipt. It is processed again and stored
as another `PROCESSED` receipt. The observed pair has different IDs, so the
same-ID replay check does not apply.

The separate server auto-create path has logical-payload matching in
`src/server/readoutAutocreate.ts:178-196, 258-303`; that protection is limited
to that path and does not cover subsequent readouts for an already existing
competitor.

## Comparison with `DUPLICATE_READOUT`

The existing design defines `DUPLICATE_READOUT` as an informational
classification: `issueState=NONE`, blue **Redan avläst**, visible in history,
and excluded from Outstanding Issues
(`READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V5.md:132-135, 409-410`;
`READOUT_STATUS_COLOR_SPEC_V2.md:89-105`).

It also explicitly distinguishes a physical repeated read from a same-ID
retry: a repeated read gets a separate `clientReadoutId`, capture sequence,
and history row, while replaying the same ID is idempotent
(`READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V5.md:410`). This supports keeping the
second capture visible while preventing it from becoming another processed
result receipt.

In the current source, `DUPLICATE_READOUT` exists in the history type and
presentation logic (`src/services/readoutHistoryStore.ts:27`;
`src/utils/readoutStatusPresentation.ts:42, 76-81, 114-131`), but repository
search found no production classifier that assigns it during ingestion. The
presentation behavior and tests do not themselves detect duplicate payloads
or stop a Firestore write.

## Evidence from the observed receipts

The two receipts
`ro-30dd955e-e6c9-4dc9-8f91-da958c453480` and
`ro-73cea4e4-3f8b-4d2c-9241-c1e84c427dd7` have the same SI number, card series,
competitor ID, punch codes/times, finish time, and raw payload, but distinct
document IDs. Both are currently `PROCESSED`. That is precisely the case in
which a second result receipt adds no new card-result information but makes
the reassignment source count ambiguous.

## Smallest change required for B

1. In `submitReadoutToFirestore`, add a duplicate lookup to the **same
   transaction** used for result updates. For a new receipt ID, search the
   competition's processed receipts for the same SI number and candidate raw
   payload, then compare the complete logical payload (card series, station,
   check/start/finish times, punch codes/times, raw payload) and the resolved
   `competitorId`.
2. If an exact match exists, return an explicit duplicate outcome referencing
   the existing receipt and competitor. Do not update the competitor,
   `publicResults`, or `finishedCount`, and do not write another `PROCESSED`
   receipt. Keep the existing same-ID idempotent branch unchanged.
3. Propagate that outcome through `ReadoutDeliveryResult` and
   `App.tsx:handleReadoutResultFeedback`; update the new captured history row
   to `DUPLICATE_READOUT` / `NONE` while retaining its own ID, capture time,
   sequence, and linked result information.

The payload lookup must stay transactional; a preflight query outside the
transaction could race with another ingestion. The local history row then
receives the existing informational presentation without a second processed
receipt.

## Recommendation summary

**Choose B for an exact same-competitor payload duplicate.** Preserve a distinct
history row for the new capture, but do not create a second `PROCESSED`
receipt or apply the same result a second time. No code was changed for this
review.
