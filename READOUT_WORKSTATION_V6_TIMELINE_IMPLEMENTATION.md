# Readout Workstation V6 Timeline Implementation

## Result

The workstation now has one primary readout surface: a newest-first
`ReadoutTimeline`. Each active-event history record is de-duplicated by
`clientReadoutId`, ordered by `captureSequence` descending, and rendered once.
The persistence model and server workflows are unchanged; this is a
presentation and interaction refactor.

## Architecture and behavior

- `ReadoutTimeline` owns the timeline filters, search, keyboard navigation,
  paging, latest marker, and row rendering.
- The latest record is marked **Senaste** in its row; there is no separate
  latest-readout card.
- Opening a row places its details, current/original competitor information,
  manual approval, unknown-card registration, MP review, wrong-competitor
  reassignment, and correction audit history in that same row.
- Expansion remains keyed by `clientReadoutId`. A new capture cannot transfer
  the expanded actions to a different readout.
- Filters (**Alla**, **Kräver åtgärd**, **OK**, **MP**, **Okänd bricka**,
  **Redan avläst**) select rows within the timeline. Search and keyboard
  navigation also operate on the timeline.
- Paging remains bounded to 20, 30, or 50 rows per page. Placement data is
  calculated once per competitor update and reused for visible rows.
- Existing repeat reassignment, duplicate detection, audit history, approval,
  MP review, and capture/delivery workflows are preserved.

## Removed and merged surfaces

Removed as independent readout lists/panels:

- Latest Readout card
- Requires Action queue
- Separate selected-readout detail/action panel
- Separate history/archive list

Their useful information and workflows are presented in the timeline row.
Competition KPIs and reader/offline controls remain secondary dashboard
content; they do not duplicate active-event timeline records.

## Offline queue and compatibility

For a queued readout represented in the active-event timeline, retry and remove
controls are available in its expanded row, and its payload is not separately
listed in the offline queue. Online-punch queue entries retain their existing
queue controls.

Pending readouts that do not have a corresponding row in the active event
(for example, an older payload without an ID or a queued item for another
event) remain manageable only in the offline queue. They are not duplicated in
the active timeline. This preserves retry/removal access without fabricating a
history record.

No database migration is required. No history schema or correction ownership
fields changed. Existing queue payloads with `clientReadoutId` associate with
their timeline row when that row is available; unmatched legacy/off-event
payloads retain queue behavior.

## Audio and performance

Audio behavior was not changed: the existing user-controlled sound setting,
readout feedback tones, and station beep callback remain in `App.tsx` and the
dashboard integration.

The timeline uses paging rather than rendering all history. Search, filters,
and ordering are applied to the record set before the current page is rendered.
Placement sorting is batched by class rather than repeated per readout row.

## Files changed

- `src/components/ReadoutDashboard.tsx` — removes duplicate readout surfaces,
  nests details/actions in the timeline, and associates pending queue actions
  with timeline rows.
- `src/components/ReadoutHistoryRow.tsx` — adds the latest badge, compact
  readout summary, and inline expanded content.
- `src/components/ReadoutTimeline.tsx` — new timeline, filters, search,
  keyboard navigation, and paging.
- `src/utils/readoutTimeline.ts` — new deterministic deduplication, ordering,
  filtering, and expansion mapping.
- `src/services/readoutSummary.ts` — batched competitor placement calculation.
- `src/components/ReadoutTimeline.test.tsx` — verifies one rendered row per
  readout, the latest badge, and row-local expanded content.
- `src/components/ReadoutHistoryRow.test.tsx` — covers latest and expanded row
  presentation and existing row actions.
- `src/utils/readoutTimeline.test.ts` — covers uniqueness, ordering,
  latest/expanded identity, and timeline filters.
- `src/services/readoutSummary.test.ts` — covers batched placement behavior.

## Validation

- `npm run build` — passed.
- `npm run lint` — passed (`tsc --noEmit`).
- `npx vitest run src` — 42 test files passed, 6 skipped; 202 tests passed,
  27 skipped.
- Build emitted existing Vite `__dirname` configuration and large-chunk
  warnings; the build completed successfully.
- No screenshot or wireframe was generated.

## Remaining limitations

- A pending readout for a different event, or one without a corresponding
  active-event history record, cannot be shown in that event's timeline and
  remains in the offline queue until it can be associated or delivered.
- The production client bundle remains above Vite's 500 kB advisory threshold;
  bundle splitting was outside this UI refactor.
