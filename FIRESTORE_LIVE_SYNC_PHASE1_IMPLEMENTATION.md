# Firestore Live Sync Phase 1 — Implementation Result

## Summary

Phase 1 now synchronizes active-competition competitor records and actual
radio/prewarning punches through competition-scoped Firestore listeners. The
existing WebSocket endpoint was not changed; `state:sync` remains in place for
fields that Phase 1 does not cover and as the current radio-split source for
roles that cannot read raw station-punch documents.

No live-ranking projections, effective statuses, or Bom values are written to
Firestore. Bom calculation and SI matching/write paths were not modified.

## Files changed

- `src/App.tsx`
  - Subscribes to active-competition competitor documents and merges them into
    app state.
  - Subscribes to radio/prewarning punches for Admin, Readout, and Forest
    roles; detaches/rebinds subscriptions with competition and role changes.
  - Preserves Firestore competitor data over later WebSocket snapshots after
    the listener's initial snapshot. For roles without the punch listener,
    WebSocket radio splits remain a fallback without replacing Firestore
    competitor fields.
  - Supplies live competition emergency settings to readout validation.
- `src/firebase.ts`
  - Replaces the rental-return-only subscription with a full competitor
    subscription.
  - Adds a `stationPunches` query filtered to `RADIO` and `PREWARNING`.
  - Extends the existing competition metadata listener with emergency fields.
  - Reuses the same competitor mapper for live subscription and one-shot
    competitor loading.
- `src/utils/firestoreLiveResults.ts` (new)
  - Maps Firestore competitor fields and attaches actual radio punches only
    when both competitor ID and SI number match.
- `src/utils/firestoreLiveResults.test.ts` (new)
  - Covers status/time/readout mapping, SI identity matching, radio versus
    prewarning classification, duplicate passage handling, and validation
    preservation.
- `firestore.rules`
  - Allows Admin, Readout, and Forest roles to list station-punch documents.
    Start, Speaker, and unauthenticated users remain denied.
- `firestore.rules.test.ts`
  - Adds role authorization assertions for station-punch listing.
- `FIRESTORE_LIVE_SYNC_IMPLEMENTATION_PLAN.md`
  - Marks Phase 1 implemented and updates the current-state inventory.

## Listeners and synchronized data

| Firestore path | Query/listener | Data synchronized |
|---|---|---|
| `competitions/{competitionId}/competitors` | Snapshot of the selected competition's competitor collection | Stored status; allocated, check, start, finish, and manual-finish times; identity/display fields; SI readout punches; readout timestamp; and inputs used to recalculate validation. Existing local-only borrowed-card data is retained when absent from the document. |
| `competitions/{competitionId}/stationPunches` | Snapshot filtered by `stationFunction in ['RADIO', 'PREWARNING']`; Admin, Readout, and Forest roles only | Actual radio/prewarning punch times. Punches are attached only when both `competitorId` and `siNumber` match. |
| `competitions/{competitionId}` | Existing competition document listener | Competition metadata plus `brokenControls` and `controlTimeOffsets` for readout validation. |

Ordinary SI controls continue to come only from validated card readout data.
The listener does not calculate projections, mutate validation, change Bom, or
write derived statuses/ranking. Existing ranking and projection behavior
remains client-derived.

## Preserved behavior and write paths

- Atomic SI matching and its existing Firestore write path are unchanged.
- Readout validation is recalculated from stored SI punches, finish/start
  inputs, class/course data, and current emergency settings.
- Radio passage data remains separate from SI-card validation data.
- The live listener never writes data to Firestore.
- Bom continues to use validated SI readout data only; no Bom formula or
  calculation path changed.
- Existing WebSocket/server code and Vercel configuration were not changed.

## Security and deployment note

The client query is limited to radio/prewarning functions, but Firestore
Security Rules authorize reads at the document level and cannot redact fields.
Readout and Forest users can therefore read the complete station-punch
documents, including SI identity and raw hex fields. This is a broader data
exposure than the UI requires and should be reviewed before production rollout.

The Firestore rules source was updated but not deployed. Readout and Forest
listeners require that rules update to be deployed; Admin access continues
under the existing rule. No production Firestore or Vercel deployment was
performed.

## Validation

- `npm run build` — passed. Existing Vite `__dirname` and large-chunk warnings
  remain.
- `npm run lint` — passed (`tsc --noEmit`).
- `npx vitest run src` — passed: 24 test files and 110 tests; 4 files and 12
  tests skipped.
- Focused Firestore emulator role check — passed: Readout could query
  station-punch documents; Start and an unassigned user were denied.
- Full `runFirestoreRulesDirtyDozenSuite()` — did not pass; it stops at an
  existing Firestore rule-expression limit error at `firestore.rules:1685`.
  This is distinct from the focused station-punch role check.
- Plain `npx vitest run` is not a valid runner for the root
  `firestore.rules.test.ts`: that file exports a custom suite rather than
  registering Vitest tests, so Vitest reports it as “0 test”.

## Remaining WebSocket dependencies and gaps

- The WebSocket endpoint remains unchanged and is still used for state fields
  outside Phase 1, including operational events, Eventor/ROC state, connected
  monitor count, and other bootstrap/synchronization data.
- Speaker receives the shared competitor state, but cannot read raw
  station-punch documents under the current rules. It still relies on the
  existing socket path for live radio splits until Phase 2 defines a safe
  Speaker data source.
- Public Portal selected-event result updates remain API/one-shot based and
  are deferred to Phase 3.
- The station-punch rule grants document-level access to full punch records;
  a narrower speaker-safe projection or schema change would be needed before
  broadening access to Speaker or public clients.
