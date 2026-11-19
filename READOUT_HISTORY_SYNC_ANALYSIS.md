# Readout History Sync Analysis

**Date:** 2026-11-18

## Conclusion

**Readout History is intentionally A: workstation-local history.** It is durable across reloads on the same browser profile, but the history records themselves are not synchronized to Firestore or loaded from Firestore on another client.

Therefore, two devices showing different history rows for the same competition is **expected and intended**. Competition results remain shared through Firestore; the local history is not a shared competition-wide event log.

## Source of truth

For the displayed history, the source of truth is the client’s `ReadoutHistoryStore`:

- The store opens IndexedDB database `PasserSI_ReadoutHistoryDB`, object store `readouts`, keyed by `clientReadoutId`.
- At physical capture, `App.tsx` creates the record, assigns its ID, sequence and capture time, then persists it locally before starting delivery.
- On initialization, `ReadoutHistoryStore` loads records using IndexedDB `getAll()`. The app filters those records by the selected `eventId` and derives Latest Readout and history ordering from the loaded local records.
- `captureSequence` is advanced from the records already known to that store. It is not allocated by a competition-wide service.

Relevant implementation: [readoutHistoryStore.ts](./src/services/readoutHistoryStore.ts) and [App.tsx](./src/App.tsx).

## Local-only storage

The history store uses browser IndexedDB. IndexedDB is isolated by browser/device profile and origin; it is not shared between separate devices.

The offline delivery queue is also local and separate from retained history:

- `localStorage`: `passersi_offline_readout_queue_v1`
- IndexedDB: `PasserSI_ForestQueueDB`, object store `pending_readouts`

The queue preserves pending deliveries and retry data. It is not a cross-device history feed, and successful delivery removes the queued item while the readout-history record remains in that device’s history.

## Firestore paths and what they contain

There is **no Firestore collection currently used as the source for the displayed Readout History**. The app does not load or subscribe to the readout receipts collection to build history rows.

Firestore does store readout-related data for delivery and competition results:

1. **Idempotency receipts:**  
   `competitions/{competitionId}/readoutReceipts/{clientReadoutId}`

   The Firestore readout transaction writes a receipt for a processed or unknown readout. The receipt contains readout payload elements such as SI number, card series, station, times, punch codes/times, raw hex, processing status and competitor ID, along with server `createdAt`. It does **not** contain the history record’s `captureSequence`, client `capturedAt`, issue state, or original/current match snapshots. The Firestore rules allow a list query only to admins; other permitted roles can get an individual receipt by ID. The workstation currently does neither a receipt query nor a receipt listener.

   References: [firebase.ts](./src/firebase.ts), [firestore.rules](./firestore.rules), and [firebase-blueprint.json](./firebase-blueprint.json).

2. **Competition result data:**  
   The readout processing path updates shared competitor result fields and the public result projection. Those documents represent current competition/result state, not one retained history row for every physical read. A later read can update the same competitor document; it cannot by itself reconstruct every earlier readout.

The existence of a Firestore receipt should not be confused with synchronization of the complete Readout History.

## Why two devices can show different rows

Each device creates and persists its own history records in its own IndexedDB. The device that physically captured a card has that record locally; another device does not import it when it opens the competition. Firestore delivery can update shared competitor results and create a receipt, but the other client does not turn those into history rows.

The local sequence counter is also rebuilt from each device’s local history. Two devices can therefore assign the same `captureSequence` to different readouts. That is safe for each device’s local ordering but is not a competition-wide ordering scheme.

## Can a newly opened client reconstruct the same history?

- **Same device and browser profile:** Yes, it can reload the history records already persisted in that profile’s IndexedDB.
- **Different device or empty browser profile:** No. It receives no history-row dataset from Firestore. It may load current competitor/result data and could potentially access individual receipts if it knows their IDs and has permission, but that is not sufficient or implemented as a history reconstruction path.

## Is this expected?

**Yes.** This is both the current implementation and the intended product behavior: each workstation shows its own retained history, while shared competition results are synchronized separately through Firestore.

The implementation plan’s “history for the active competition” wording can be read as competition-wide, but it does not require replication of the complete history record. The Phase 1 implementation identifies IndexedDB as the history persistence layer. The product decision now clarifies that the local behavior is intentional.

## Recommendation

Keep **A: workstation-local history**. Retain the current IndexedDB persistence and local offline recovery; do not add Firestore history replication. Continue synchronizing competition result data through Firestore independently of the local readout log.

Keep the distinction explicit in future UX and documentation: different workstations are not expected to show identical history rows. The per-workstation `captureSequence` is appropriate for local ordering and must not be interpreted as a competition-wide sequence.
