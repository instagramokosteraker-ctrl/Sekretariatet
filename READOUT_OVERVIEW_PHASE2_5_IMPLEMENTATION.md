# Readout Overview — Phase 2.5 Implementation

Date: 2026-11-17

## Scope delivered

Implemented UX review findings M1–M4 from [READOUT_WORKSTATION_UX_REVIEW.md](./READOUT_WORKSTATION_UX_REVIEW.md), without starting Phase 3.

- **M1 — Primary workstation visibility:** Latest Readout is the first operational panel and remains sticky while the page scrolls. Offline queue details, station diagnostics, and the simulated-offline tool are inside a collapsed **Offlinekö och tekniska verktyg** section. Its summary still shows network state and the pending count.
- **M2 — Inline unknown-card action:** Both history and live-event **Anmäl** actions open an inline registration panel instead of navigating to Entries. For a captured readout, submission carries its `clientReadoutId`, capture metadata, SI number, and punches into the existing direct-entry validation and history-resolution path. Registration options for class, club, rental/borrowed card, and optional start time remain available. The readout station stays in readout mode so another card can be captured while the panel is open.
- **M3 — Stable selected readout:** Selected details are rendered separately from the paginated list and keyed by `clientReadoutId`. Filtering, pagination, and new captures do not remove the selected record from the panel. Original/current match and result context, issue state, delivery state, card series, finish time, and punches remain available.
- **M4 — Latest Readout summary:** The sticky summary shows competitor or provisional runner match, class, result, finish time, placing when available, Bom, MP explanation when applicable, and delivery/synchronization state.

Capture identity and ordering, history persistence, Outstanding Issues filtering, offline queue/retries, receipt handling, and validation/Bom calculation were not changed.

## Files changed

- `src/App.tsx` — wired inline unknown-card registration to the existing validated direct-entry handler and removed the old navigation state.
- `src/components/EntriesRegistrationView.tsx` — removed the now-obsolete readout-linking props and flow; normal direct registration remains unchanged.
- `src/components/ReadoutDashboard.tsx` — prioritized Latest Readout, collapsed technical/queue details, detached selected-readout panel, inline unknown-card registration, and expanded latest summary.
- `src/services/readoutSummary.ts` — shared placing and MP-explanation helpers.
- `src/services/readoutSummary.test.ts` — focused tests for placing and MP-explanation summaries.
- `READOUT_OVERVIEW_PHASE2_5_IMPLEMENTATION.md` — this report.

## Tests added

- Placing ranks only finished `OK` competitors in the same class and excludes non-finishers.
- MP explanation includes missing and extra controls and handles unavailable validation.

Existing readout-history tests continue to cover capture ordering, replay, and issue-state behavior.

## Validation results

- `npm run build` — passed. Vite reported the existing `__dirname` configuration warning and a large-chunk warning.
- `npm run lint -- --pretty false` — passed.
- `npx vitest run src` — passed: 30 test files passed, 4 skipped; 133 tests passed, 12 skipped.
- `git diff --check` — passed.

No live SPORTident station workflow was exercised.

## Remaining work before Phase 3

The M1–M4 usability fixes are complete. Before or during Phase 3, the V4 plan still calls for:

- Implementing the broader unknown, unlinked, and conflict correction flows, including `WRONG_COMPETITOR` and `RESULT_REASSIGNMENT`.
- Adding a preview for successful-readout reassignment and an authorized, server-validated, idempotent correction transaction.
- Preserving original match/result data while updating the current competitor link and derived results safely.
- Adding append-only correction audit records with actor/role, timestamp, reason, before/after state, and transaction/validation outcome; keep future SI-card ownership changes separate and explicitly authorized.
- Reviewing staff-only access/rules and confirming raw readout and audit data remain private from public projections.

Phase 4 pilot reconciliation and physical hardware testing also remain pending. No Phase 3 correction or audit workflow was implemented.
