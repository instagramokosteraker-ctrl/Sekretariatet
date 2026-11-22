# Readout Eligibility and Status Fix

## Implemented

### Unknown-card receipt promotion

The unknown-card registration path now passes the captured receipt identity and
payload details through the direct-entry API. `createCompetitorWithAssignment`
validates that the receipt:

- exists at the requested readout ID and belongs to the same competition;
- is still `UNKNOWN` with no assigned original/current competitor;
- has matching SI number, card series, station, timing, punch, and raw-data
  fields.

The competitor creation, assignment, and receipt promotion happen in one
Firestore transaction. The receipt is set to `PROCESSED`, and both
`competitorId` (original owner) and `currentCompetitorId` are set to the new
competitor ID. A mismatch aborts the transaction and does not create the
competitor.

The server returns the promoted receipt ID. The client only marks local history
`PROCESSED`/`SYNCED` after receiving that matching confirmation. Receipt-linked
direct entry does not fall back to a client-only competitor write if the
backend is unavailable.

### Reassignment eligibility and failed requests

Readout history now tracks the receipt status confirmed by successful
processing. The reassignment action requires a processed local readout and
processed receipt, valid event/readout/current/original IDs, and a reassignable
result. The server remains the final authority.

The client no longer creates a `WRONG_COMPETITOR/OPEN` issue before submitting
the request. On a failed request, any pre-existing open/in-progress
wrong-competitor issue is cleared. Successful corrections still record the
issue as resolved with the correction audit.

### Independent status indicators

Each row now separates:

- **Result** badge, with row background determined only by result status;
- **Issue** badge and, when applicable, a separate action-required/state badge;
- **Delivery** badge with state-specific color.

For example, an `OK` readout with an open wrong-competitor issue remains green
and displays distinct `OK`, `Fel löpare`, `Åtgärd krävs`, and `Synkad` labels.

## Files changed

- `server.ts` — forwards optional receipt-promotion data to the trusted
  competitor-creation transaction.
- `src/server/competitorCreation.ts` — validates and atomically promotes a
  matching unknown receipt; returns the promoted receipt ID.
- `src/server/competitorCreation.test.ts` — adds Firestore transaction tests
  for successful promotion and mismatch rollback.
- `src/firebase.ts` — sends receipt identity/payload with readout-linked
  direct entry and rejects unconfirmed promotion; disallows client-only
  fallback for this flow.
- `src/App.tsx` — records receipt state after confirmed processing, preserves
  original ownership on direct entry, and rolls back failed reassignment issue
  state.
- `src/services/readoutHistoryStore.ts` — stores receipt status and applies
  strict reassignment eligibility; adds failed-issue rollback helper.
- `src/services/readoutHistoryStore.test.ts` — tests eligibility before/after
  receipt promotion and cleanup after failed reassignment.
- `src/components/ReadoutHistoryRow.tsx` — renders separate result, issue, and
  delivery badges.
- `src/components/ReadoutHistoryRow.test.tsx` — tests receipt-gated action
  visibility and distinct status badges/row color.
- `src/utils/readoutStatusPresentation.ts` — derives row color from result and
  provides separate issue/delivery badge presentation.
- `src/utils/readoutStatusPresentation.test.ts` — verifies independent status
  presentation and green `OK` rows with open issues.

## Data and compatibility

No Firestore schema migration is required. Receipt promotion adds or updates
the existing `currentCompetitorId` field in the same transaction that sets the
existing receipt status and original competitor ID.

`receiptStatus` is a local readout-history field only. Older IndexedDB history
records without this field fail closed: their reassignment action is hidden
until the receipt status has been confirmed by a successful processing flow.
This avoids reintroducing the local/server eligibility mismatch for historical
records.

## Validation

- `npm run build` — passed.
- `npm run lint` — passed (`tsc --noEmit`).
- `npx vitest run src` — 42 test files passed, 6 skipped; 205 tests passed,
  29 skipped.
- Firestore Emulator: `src/server/competitorCreation.test.ts` — 6 passed,
  including the promotion and mismatch-rollback integration cases. The
  emulator emitted a non-fatal metadata lookup warning in this environment.
- Build emitted existing Vite `__dirname` and large-client-chunk warnings; it
  completed successfully.

## Remaining limitations

- Existing local history records without a confirmed `receiptStatus` are not
  eligible for reassignment. An authoritative lookup/backfill for legacy
  records is not included.
- If the server commits a receipt promotion but the response is lost, the
  client fails closed and does not mark the local history processed. Recovery
  requires refreshing/retrying against the server; direct client-side writes
  are intentionally not used to infer success.
