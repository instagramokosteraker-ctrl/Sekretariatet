# Duplicate readout ingestion implementation

## Behavior

Known-competitor readouts now go through the authenticated server endpoint
`POST /api/firestore/competitions/:competitionId/readouts/:receiptId/ingest`.
Its Admin SDK transaction checks for an exact match among that competitor's
processed receipts before writing the new result.

An exact duplicate requires all of the following to match: competitor ID, SI
number, card series, start time, finish time, punch codes, punch times, and raw
payload. A duplicate returns the existing receipt and competitor without
writing a new receipt or changing competitor data, `publicResults`, or
competition counters. The new capture remains in local history as
`DUPLICATE_READOUT` / `issueState: NONE`, displayed as blue **Redan avläst**.

The same-receipt-ID replay check remains ahead of duplicate detection and
retains its prior payload comparison. Unknown-card receipts and RunnerDB
auto-create continue to use their existing paths.

## Files changed

- `server.ts` — authenticated ingestion route and official-role write gate.
- `src/server/readoutIngestion.ts` — validation, exact-match lookup, replay
  handling, and atomic result/receipt transaction.
- `src/server/readoutIngestion.test.ts` — emulator tests for duplicates,
  changed punch data, concurrent captures, and same-ID replay.
- `src/utils/readoutDuplicate.ts` — exact processed-receipt matcher.
- `src/utils/readoutDuplicate.test.ts` — exact-match and partial-match cases.
- `src/firebase.ts` — sends known-competitor readouts through the server route
  and handles duplicate outcomes.
- `src/services/offlineReadoutQueue.ts` — carries duplicate result metadata.
- `src/services/readoutHistoryStore.ts` — creates the informational duplicate
  history update.
- `src/services/readoutHistoryStore.test.ts` — verifies the blue, non-outstanding
  history classification.
- `src/App.tsx` — updates the captured history row from the duplicate outcome.

## Verification

- `npm run build` — passed.
- `npm run lint` — passed.
- `npx vitest run src --testTimeout 20000` — passed: 182 tests; 25 skipped.
- Firestore emulator ingestion tests — passed: 4/4.

The build emitted existing Vite configuration and large-chunk warnings; the
build completed successfully.
