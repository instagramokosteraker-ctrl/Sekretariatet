# Readout Overview — Phase 2 Implementation

Date: 2026-11-17

## Scope delivered

Implemented Phase 2 from [READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V4.md](./READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V4.md):

- Complete paginated/searchable Readout History for the active competition.
- An Outstanding Issues view filtered by `issueState` in `OPEN` or `IN_PROGRESS`.
- Reopenable rows that restore captured readout details and original/current result context.
- Explicit MP review issue creation; MP alone remains non-outstanding.

The Phase 3 correction/reassignment and audit workflows were not implemented.

## Readout history

- History now offers search, 20/30/50 rows per page, and previous/next pagination over all retained records for the active competition.
- Every row has an accessible button that opens its captured details, including original SI number/card series, captured time, finish time, and punches.
- Expanded details show the original and current competitor match, original and current result status, available time/Bom values, delivery state, and issue type/state.
- `originalCompetitor*` and `originalResultStatus`/snapshot fields are initialized on first match and preserved when current result data is updated.
- Existing IndexedDB history records are normalized on load: original context is backfilled from their existing result data, and existing unknown-card records are initialized as `UNKNOWN_CARD` issues in `OPEN`.
- Unknown-card linking through the existing direct-entry workflow marks that issue `RESOLVED`; a delayed duplicate unknown-card response does not reopen it.

## Outstanding Issues and MP

- The Outstanding Issues count/filter includes only records with `issueState === 'OPEN'` or `issueState === 'IN_PROGRESS'`.
- Unknown-card responses create an explicit `UNKNOWN_CARD` open issue.
- Captured and processed MP readouts keep `issueState=NONE` by default.
- An expanded MP history row offers **Skapa MP-granskningsärende**. Only this explicit action sets `issueType=MP_REVIEW` and `issueState=OPEN`; persistence errors are surfaced and the in-memory state is reverted.

## Preserved behavior

Capture sequence ordering and `clientReadoutId` remain the basis for Latest Readout and response merges. The offline queue, receipts/replay, retry path, validation, and Bom calculation behavior remain in place.

## Validation

- `npm run build` — passed. Vite emitted configuration and large-chunk warnings.
- `npm run lint -- --pretty false` — passed.
- `npx vitest run src` — passed: 29 files passed, 4 skipped; 131 tests passed, 12 skipped.
- `git diff --check` — passed.

Readout-history tests cover capture-sequence latest ordering, reverse response order, duplicate receipt replay, multiple unknown cards, preservation of original match/result context, and MP-vs-issue filtering.
