# Readout Capture Order Audit

Date: 2026-11-17

## Verdict

**FAIL — capture order does not currently guarantee Latest Readout correctness.**

There is no `captureSequence` in the readout payload, queue item, delivery result, or dashboard state. The dashboard does not have a dedicated readout-history list. On successful response, the app unconditionally selects the response's competitor, so the last response to arrive can replace a newer readout. There is also no response-to-history-row merge key for unknown cards or queued replay notifications.

No application code was changed. This audit is limited to Zone 1 (Latest Readout) and Zone 3 (Readout History), including the asynchronous delivery paths that feed those zones.

## Lifecycle trace

| Stage | Current implementation | Ordering consequence |
|---|---|---|
| SI card capture | `sportidentSerial.onFullCardReadout` in `src/App.tsx:1312-1314` calls `void submitFullReadoutToServer(readout)`. It does not synchronously create a UI readout record. | No captured item appears in Latest Readout at capture time. |
| `clientReadoutId` | `OfflineReadoutQueueManager.submitReadoutGuaranteed` generates `ro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` when the payload has no ID (`src/services/offlineReadoutQueue.ts:265-280`). Firestore has a similar fallback (`src/firebase.ts:6399-6402`). | The ID is generated after the serial callback has dispatched the async submit, not alongside a capture sequence. Timestamp plus six random base-36 characters is collision-resistant in ordinary use but does not guarantee uniqueness. |
| `captureSequence` | Not defined in `FullCardReadoutPayload`, `QueuedReadoutItem`, `ReadoutDeliveryResult`, or the app state. There are no `captureSequence` references under `src/`. | Capture order cannot be reconstructed or enforced from the current data. |
| Local persistence | The queue appends its item and calls `persistAll()` before starting delivery (`offlineReadoutQueue.ts:273-292`). The queue item retains its readout ID for a retry. | This preserves an ID for that queued attempt, but creates no Zone 3 history row and stores no sequence. |
| Firestore delivery | `submitReadoutToFirestore` makes a receipt document keyed by `clientReadoutId` (`firebase.ts:6532-6536`). It sets `nowIso` during processing and updates competitor result fields in a transaction (`firebase.ts:6508-6522`, `6757-6776`). | Receipt identity is useful for deduplication, but `nowIso` is not capture order and there is no sequence comparison protecting UI order or a competitor's newer result. |
| Server response | A direct submission returns a `ReadoutDeliveryResult`; unknown-card data omits `clientReadoutId`. Queue replay calls listeners with `res` only (`offlineReadoutQueue.ts:448-483`). | The app cannot consistently correlate every response, especially unknown-card/replayed responses, to a history item. |
| UI response merge | `handleReadoutResultFeedback` stores unknown-card data in one `pendingUnknownReadout` value. For a known competitor it updates the competitor and unconditionally calls `setSelectedRunnerId(syncedCompetitor.id)` (`App.tsx:1197-1218`). The same handler is used for direct responses and queue replay (`App.tsx:1222-1232`). | The response that arrives last can select an older readout. Unknown responses replace the single pending value. No history row is updated by readout ID. |
| Latest selection | `ReadoutDashboard` first uses `selectedRunnerId`; only when it does not resolve does it fall back to the competitor with the greatest `readoutAt` (`ReadoutDashboard.tsx:188-198`). | Latest display is determined by response-driven selection or processing timestamp, not physical capture order. |
| History rows | There is no `ReadoutHistory`/`readoutHistory` state or readout-history row creation/update path in the audited source. The dashboard's **Tävlingshändelser i realtid** table renders up to 16 `LiveEventItem`s (`ReadoutDashboard.tsx:994-999`); clicking a linked event selects a competitor, and unknown-card actions navigate to entry handling. | This event stream is not a one-row-per-readout history and does not reopen a readout by its receipt ID. |

`FullCardReadoutPayload` has an optional `clientReadoutId` but no capture time or sequence (`src/types/sportident.ts:292-303`). `RawCardReadoutArchive` can retain the ID after a known competitor is processed (`sportident.ts:181-189`), but not the capture sequence. `LiveEventItem` has neither field (`sportident.ts:263-289`).

## Required two-readout scenario

| Moment | Required Zone 1 | Current behavior |
|---|---|---|
| A captured (`sequence=100`, 15:00:00) | A is shown immediately; A gets a history row. | No readout-specific item is created by the capture callback. |
| B captured (`sequence=101`, 15:00:05) | B becomes Latest Readout immediately; A remains in history. | Still no capture-sequenced latest item. |
| B response arrives (15:00:06) | Update B's history row; Latest remains B. | The known response selects B's competitor. |
| A response arrives (15:00:10) | Update A's history row only; Latest remains B. | The handler selects A's competitor unconditionally. The dashboard then prefers A via `selectedRunnerId`. **A displaces B.** |

This is a concrete race: network completion order (`B`, then `A`) overrides physical capture order (`A`, then `B`).

## Required case verification

| Case | Current result | Reason |
|---|---|---|
| Offline queue replay | **FAIL** | `flushQueue` delivers queued items sequentially within that flush, but `onItemSynced` forwards only the result and runs the same unguarded feedback handler. It does not carry a capture sequence or history-row key. Direct submissions can also be in flight while a flush runs. |
| Retry after reconnect | **FAIL** | Replayed responses still call `setSelectedRunnerId` by response arrival. The saved queue ID is not a capture sequence and is not included in the generic callback envelope. |
| Duplicate receipt delivery | **FAIL** | Firestore receipt idempotency prevents duplicate processing for the same receipt ID, but the replay response is still fed to the unguarded UI handler. A duplicate response can reselect an older competitor. |
| Multiple unknown cards | **FAIL** | `pendingUnknownReadout` is a single object in `App.tsx`; each unknown response replaces it. Response order, not capture order, determines which unknown readout remains available. Unknown response data does not carry the receipt ID back to the UI. |
| Multiple MP readouts | **FAIL** | MP is returned as a competitor response. Each response updates/selects its competitor with no sequence guard. A slow earlier MP response can replace a newer MP in the inspected panel. |
| Out-of-order Firestore updates | **FAIL** | The transaction updates competitor fields without comparing a stored capture sequence. `readoutAtIso` is set from `nowIso` created during request processing, not from card capture. The dashboard can also select by that timestamp when no explicit runner is selected. |

The queue preserves a queued item's `clientReadoutId` when retrying, and Firestore uses that ID as the receipt document ID. This is useful idempotency, but it does not establish chronological order or make the ID a guaranteed unique physical-capture key. Every repeated physical read should get a fresh ID; retries/replays of that same read must reuse it.

## Exact race-condition locations

1. **No latest/history item is created on capture:** `src/App.tsx`, `onFullCardReadout` callback at lines 1312-1314.
2. **No capture sequence and probabilistic ID generation:** `src/services/offlineReadoutQueue.ts`, `submitReadoutGuaranteed` at lines 261-280. No sequence field exists in the payload/queue types.
3. **Unconditional latest selection on known response:** `src/App.tsx`, `handleReadoutResultFeedback` at lines 1197-1218, especially `setSelectedRunnerId` at line 1215.
4. **Unknown responses overwrite one another and have no response ID:** `src/App.tsx:1184-1193` and `1203-1210`; unknown result shape in `src/services/offlineReadoutQueue.ts:32-44` and `src/firebase.ts:6310-6318`.
5. **Queue replay loses delivery-item context:** `src/services/offlineReadoutQueue.ts`, `flushQueue` at lines 448-483 calls `syncedListeners` with the result only.
6. **Latest selection is tied to selected competitor/`readoutAt`:** `src/components/ReadoutDashboard.tsx`, `inspectedRunner` at lines 188-198.
7. **Competitor writes are not ordered by capture sequence:** `src/firebase.ts`, `submitReadoutToFirestore`, `nowIso`/readout creation at lines 6384-6402 and unconditional transaction update at lines 6757-6776.
8. **No Zone 3 readout rows exist:** the rendered event table at `src/components/ReadoutDashboard.tsx:994-999` is the event stream and selects by competitor ID rather than readout ID.

## Smallest implementation change required

Keep the existing workstation layout and delivery queue. Add only the capture-order data and keyed UI updates needed for Zones 1 and 3:

1. At the serial callback in `App.tsx`, synchronously create one readout record per completed physical read. Assign a collision-checked unique `clientReadoutId` and monotonically increasing `captureSequence` before starting async delivery. Persist both in the readout payload so replay preserves the original identity/order. The sequence must be restored from persisted readouts on startup (and allocated atomically if multiple tabs can read for the same competition).
2. Append the record to history and set `latestReadoutId` from capture sequence at capture time. The Latest Readout selector must choose the record with the greatest `captureSequence`; it must never derive latest from `selectedRunnerId`, `readoutAt`, or response order.
3. Carry `{ clientReadoutId, captureSequence }` through direct delivery results and queue replay notifications, including unknown-card outcomes and duplicate-receipt responses.
4. Create each history row once at capture and upsert only that row by `clientReadoutId` when a response arrives. The response handler must not set the Latest Readout pointer except when it is updating the already-current record; an older sequence can update its own history row only.
5. Keep unknown cards and MP readouts as separate history records rather than one pending object or one selected-competitor pointer.
6. For Firestore-derived history updates, associate each snapshot/result with its readout ID and sequence; update that row only. If competitor-level readout fields are also used as a latest-result source, add a transaction guard so a lower sequence cannot overwrite a higher sequence. Zone 1 itself should be sourced from the capture-ordered readout record, not the mutable competitor document.

ID and ordering semantics:

- Generate the ID exactly once per physical read; retain it unchanged for all retries/replays. Use a collision-resistant UUID and enforce uniqueness in the local journal (for example, an IndexedDB key constraint with collision detection).
- Define `captureSequence` as a strictly increasing per-competition counter in the readout workstation's capture stream. Persist the counter with the local record; seed it from the journal before use. If simultaneous reader tabs are supported, allocate the counter in a single IndexedDB read/write transaction.
- A duplicate delivery uses the original ID and sequence and upserts the same history item. A second physical read of the same SI card gets a new ID and a higher sequence.

These are ordering/state changes only. They do not require replacing the offline queue, changing the visual workstation design, or changing the Bom algorithm.

## Acceptance tests for the fix

- Given A `(sequence=100)` and then B `(sequence=101)`, Latest Readout switches to B on B capture, before either response.
- Resolve B first and A second: B remains latest; B's row reflects B's response and A's row reflects A's response.
- Replay the same queue item/receipt multiple times: one history row is updated, not duplicated, and latest does not move backwards.
- Replay unknown A and unknown B in either order: both history rows remain; latest is the greater sequence.
- Complete multiple MP readouts in reverse order: each row is updated by ID, latest remains the greatest sequence.
- Deliver out-of-order competitor/receipt snapshots: only the matching history row changes; a lower sequence cannot become Zone 1 latest.
- Reload with pending readouts: IDs and capture sequences are preserved; a later retry cannot displace a newer capture.

## Audited files

- [App.tsx](./src/App.tsx)
- [ReadoutDashboard.tsx](./src/components/ReadoutDashboard.tsx)
- [offlineReadoutQueue.ts](./src/services/offlineReadoutQueue.ts)
- [firebase.ts](./src/firebase.ts)
- [sportident.ts](./src/types/sportident.ts)
