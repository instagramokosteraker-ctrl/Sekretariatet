# Multiple processed receipts analysis

## Conclusion

The two receipts contain the **same complete SI-card payload**, but are
separate Firestore documents with different receipt IDs and server creation
times about 55 minutes apart. The best-supported explanation is **B: the same
card contents were captured or submitted again under a new readout ID**, not a
normal retry of the original request.

The persisted competitor link identifies
`ro-30dd955e-e6c9-4dc9-8f91-da958c453480` as its linked/canonical receipt:
`competitors/cmp_ro_1426msb_l5zmjn.readoutReceiptId` points to it, and its
`createdAt` matches that receipt's `createdAt`. The later receipt,
`ro-73cea4e4-3f8b-4d2c-9241-c1e84c427dd7`, appears to have refreshed the
competitor result later: its creation time aligns with the competitor's
`readoutAtIso`. This leaves a stale-looking link, but both receipts have
identical result data, so either yields the same result values.

The Firestore receipt documents do **not** contain `capturedAt`; their
`createdAt` values record receipt creation, not verified physical card-read
times. Therefore the documents cannot prove whether the later submission was a
second physical insertion or a replay with a newly generated ID.

## Documents inspected

Database:

`projects/ai-studio-applet-webapp-72c01/databases/ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`

Competition:

`competitions/evt-1794746557864-xnwuab`

Receipts:

- `competitions/evt-1794746557864-xnwuab/readoutReceipts/ro-30dd955e-e6c9-4dc9-8f91-da958c453480`
- `competitions/evt-1794746557864-xnwuab/readoutReceipts/ro-73cea4e4-3f8b-4d2c-9241-c1e84c427dd7`

Both have `clientReadoutId` and `receiptId` equal to their respective document
IDs.

## Field comparison

| Field | `ro-30dd955e-e6c9-4dc9-8f91-da958c453480` | `ro-73cea4e4-3f8b-4d2c-9241-c1e84c427dd7` |
|---|---|---|
| `siNumber` | `429898` | `429898` |
| `cardSeries` | `SI-Card 5` | `SI-Card 5` |
| `punchCodes` | `[157, 154, 138, 141, 159, 148, 15]` | `[157, 154, 138, 141, 159, 148, 15]` |
| `punchTimes` | `[23257, 23301, 24066, 24291, 24661, 24823, 43306]` | `[23257, 23301, 24066, 24291, 24661, 24823, 43306]` |
| `startTimeSec` | `23194` | `23194` |
| `finishTimeSec` | `68050` | `68050` |
| `stationCode` | `15` | `15` |
| `rawHex` | Identical | Identical |
| `competitorId` | `cmp_ro_1426msb_l5zmjn` | `cmp_ro_1426msb_l5zmjn` |
| Receipt `status` | `PROCESSED` | `PROCESSED` |
| `capturedAt` | Not present | Not present |
| `createdAt` | Nov. 17, 2026, 8:55:15 PM UTC+1 | Nov. 17, 2026, 9:50:18 PM UTC+1 |

The linked competitor document
`competitions/evt-1794746557864-xnwuab/competitors/cmp_ro_1426msb_l5zmjn`
has `status: MP`, `readoutReceiptId:
ro-30dd955e-e6c9-4dc9-8f91-da958c453480`, and
`readoutAtIso: 2026-11-17T20:50:17.055Z` (9:50:17 PM UTC+1). Its
`createdAt` is 8:55:15 PM UTC+1, the same time as the older receipt.

## Classification

- **A. Same physical readout duplicated:** The payload is duplicated exactly.
  The distinct IDs and separated creation times do not show that the same
  request was simply written twice.
- **B. Same card read twice:** **Best-supported.** There are two independent
  receipt IDs, about 55 minutes apart, carrying byte-for-byte identical card
  data for the same SI number and competitor. A second capture/submission of
  the unchanged card contents fits the evidence. The absence of `capturedAt`
  means physical rereading cannot be proven from Firestore alone.
- **C. Replay/retry artifact:** Not supported as an ordinary transport retry.
  The client creates an ID for each captured readout
  (`src/services/readoutHistoryStore.ts:189, 236-249`), while the offline queue
  retains the original ID when retrying. The two IDs differ. An intentional
  replay assigned a fresh ID cannot be excluded.
- **D. Legitimate multiple readouts:** No evidence of a distinct second result;
  both records encode the exact same card result. A legitimate second physical
  read remains possible, but it does not represent different result data.

## Why both became `PROCESSED`

The normal existing-competitor path is `submitReadoutToFirestore` in
`src/firebase.ts:6449`. Its transaction checks for an existing receipt at the
same document ID (`:6834-6850`); if that ID is new, it updates the competitor
and writes a new `PROCESSED` receipt (`:6906-6935`). It does not search for an
already processed receipt with the same SI number and payload on this path.
Thus a new capture ID for the same card contents can create a second processed
document.

The separate server auto-create path has logical-payload duplicate detection
(`src/server/readoutAutocreate.ts:178-196, 258-303`). That is not equivalent to
deduplicating every subsequent read for a competitor that already exists.

## Canonical receipt assessment

For the competitor's **explicit receipt association**, use
`ro-30dd955e-e6c9-4dc9-8f91-da958c453480`: it is the value of
`readoutReceiptId`, and it was created at the same time as the competitor.

For the **latest result update**, `ro-73cea4e4-3f8b-4d2c-9241-c1e84c427dd7` is
the stronger temporal match: its `createdAt` is one second after the
competitor's `readoutAtIso`. The normal update path writes `readoutAtIso` but
does not replace `readoutReceiptId` (`src/firebase.ts:6906-6912`), explaining
why those two indicators point to different receipts. Since the payloads are
identical, there is no result-value difference between them; the distinction
is their receipt identity and which event the metadata associates them with.

This second processed receipt is the source-count ambiguity: the server counts
all `PROCESSED` receipts with this `competitorId`, so it sees two rather than
one. No Firestore data was changed for this analysis.
