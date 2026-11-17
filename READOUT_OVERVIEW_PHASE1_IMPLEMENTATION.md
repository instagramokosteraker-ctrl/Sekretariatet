# Readout Overview — Phase 0 and Phase 1 Implementation

Date: 2026-11-17

## Scope delivered

Implemented Phase 0 and Phase 1 from [READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V4.md](./READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V4.md) only:

- Establish capture identity and a durable readout-history foundation.
- Drive Latest Readout and history order by `captureSequence`.
- Move SPORTident Hårdvarutestbänk to the diagnostics section on the Sportident, ROC och USB page.

The correction workflow, issue-state transitions, and full searchable/paginated history remain outside this phase.

## Readout capture and history

- Physical readout submission now rejects an uninitialized history store rather than awaiting initialization before capture. All SI connection paths initialize the store before connecting; startup initialization still completes before automatic reconnect.
- At the start of readout submission—before the first asynchronous operation—the app creates a history record with a new `clientReadoutId`, next per-event `captureSequence`, and `capturedAt`.
- The record is immediately available to the dashboard, persisted to IndexedDB before delivery starts, and then passed unchanged to the existing offline queue.
- Delivery responses continue to merge by `clientReadoutId`. Duplicate receipt replay updates the existing history row; distinct physical reads, including unknown cards, create distinct rows.
- Latest Readout is selected by greatest `captureSequence`; history sorts newest-first by that same sequence. Response timing and timestamps do not affect ordering.
- Existing receipt, retry, validation, and Bom paths were left in place.

## Hardware testbench relocation

Moved the six existing readout test scenarios into [SportidentHardwareTestbench.tsx](./src/components/SportidentHardwareTestbench.tsx). They now appear at the bottom of [HardwareStationsView.tsx](./src/components/HardwareStationsView.tsx), inside a collapsed-by-default `<details>` section labeled **Diagnostik och verktyg**. The scenarios still call the existing simulation/readout pipeline and preserve their runner selection behavior.

Removed the testbench from [ReadoutDashboard.tsx](./src/components/ReadoutDashboard.tsx), and updated its remaining live timing content to use the available width.

## Tests and validation

- `npm run build` — passed. Vite emitted existing configuration and large-chunk warnings.
- `npm run lint -- --pretty false` — passed.
- `npx vitest run src` — passed: 29 files passed, 4 skipped; 129 tests passed, 12 skipped.
- `npx vitest run` — 29 files passed, 4 skipped, but the root `firestore.rules.test.ts` suite failed discovery because it contains no tests. Source tests pass with the scoped command above.
- Added an explicit test that latest ordering follows `captureSequence`, not timestamps or input-array order. Existing readout-history tests cover out-of-order responses, duplicate replay, and multiple unknown cards.
- `git diff --check` — passed.

## Deferred work

No correction/reassignment workflow, human issue queue, MP review behavior, or Phase 2 searchable/paginated history was implemented.
