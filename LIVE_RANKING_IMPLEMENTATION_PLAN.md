# Live Ranking Implementation Plan

## Status

The finalized live-ranking behavior is implemented in the shared class results
table used by Förenklad vy, Sträcka & bom, Speaker results and public class
results. The Bom calculation, SI readout validation and persisted runner
statuses remain unchanged.

## Affected files and components

| File | Role |
|---|---|
| `src/components/SplitsAnalysisTable.tsx` | Shared views, Plac/status cell, view-specific columns, rolling projections and sort controls. |
| `src/utils/resultSorting.ts` | Shared status-group ranking and default, radio, ordinary, finish and Bom sort modes. |
| `src/utils/livePassage.ts` | Pure next-passage and rolling elapsed-time calculation. |
| `src/utils/resultSorting.test.ts` | Status groups and sort-mode behavior. |
| `src/utils/livePassage.test.ts` | Rolling value and next-passage advancement. |
| `src/utils/effectiveRunnerStatus.ts` and `src/hooks/useEffectiveCompetitors.ts` | Existing computed CHECKED-to-IN_FOREST behavior; retained without writes. |
| `src/components/SpeakerResultsView.tsx` and `src/components/PublicPortalView.tsx` | Continue to use the shared effective-status table for class results. |

The public portal's separate club-grouped summary is not a class result table
and does not use this ranking presentation.

## Status algorithm

Stored status is not changed. The existing effective-status helper derives
`IN_FOREST` from stored `CHECKED` when competition date/time reaches the
allocated start, and does not derive it for completed competitions. The shared
table consumes this effective status; no Firestore write was added.

Status groups always precede internal ranking:

1. `OK`
2. `PRELIMINARY_FIN`
3. `IN_FOREST`
4. `CHECKED`
5. `REGISTERED`
6. `MP`
7. `DNF`
8. `DNS`

`OK` rows are ordered by official placing. `PRELIMINARY_FIN` rows are ordered
by actual finish time. `IN_FOREST` rows are ordered by the number of completed radio controls, then
by the rolling elapsed value for their next passage. `CHECKED` and
`REGISTERED` rows are ordered by allocated start time. Existing internal MP
ordering remains; DNF and DNS retain their input order at the bottom.

Plac is a single column: `OK` runners with official results show numeric
placing; every other status shows its existing status indicator. There is no
separate Status column.

## Passage values and display

Passage points are configured RADIO/PREWARNING controls in course order,
followed by Finish. Ordinary controls are not passage points.

```text
projectedPassageTime = currentTime - actualStartTime
actualStartTime = startTimeSec, or allocatedStartSec when no actual start exists
```

This is the elapsed race time at the current instant, not a forecast. A row
shows at most one projection: only in the next unreached radio column, or in
Tid when Finish is next. After a punch, its actual time replaces the
projection and the projection advances. Tid remains blank for an active runner
while a radio control is next. Ordinary controls show only validated actual SI
readout data.

## Ranking and sorting

Default LIVE ranking is applied within each status group. For `IN_FOREST`, the
number of completed radio controls ranks first; runners with the same count
are ordered by their rolling elapsed value. This compares runners at the same
stage of progress without treating time at different controls as a prediction.
`OK` rows follow official place, and the remaining groups use the
status-specific rules above.

Clicking a radio-control header sorts within each status group by actual
cumulative time at that control, or by the rolling value when that control is
the runner's next passage. Actual and projected values participate together;
rows with neither value follow the default LIVE order.

Clicking an ordinary-control header sorts rows with an actual validated
cumulative time first, ascending. Rows without that value follow default LIVE
order. No ordinary-control projection is calculated.

The Tid header sorts by actual finish time or, for an active runner whose next
passage is Finish, the rolling value. Bom sorting continues to use the existing
validated total-time-loss value. `Återställ ordning` clears all custom sort
selections and restores LIVE ranking without changing validation or Bom data.

## Result views

- **Förenklad vy:** Plac, Name/Club, Start, radio controls and Tid. No ordinary
  controls, Bom or separate Status column.
- **Sträcka & bom:** Plac, Name/Club, Start, radio and ordinary controls, Tid
  and Bom. Ordinary controls are readout-only and never projected.
- Speaker and public class results use the same table and ranking engine.

## Bom compatibility

The current Bom estimator remains in `server.ts` and is based on validated
SI-card readout data. No projection, effective status, ideal-time estimate or
live-ranking value is written into validation or used as a Bom input. See
[`LIVE_RANKING_AND_BOM_COMPATIBILITY.md`](./LIVE_RANKING_AND_BOM_COMPATIBILITY.md)
for the audited formula and data sources.

## Implementation and verification phases

1. Audit the existing result views, status derivation, sorting and Bom inputs.
2. Add the rolling next-passage helper and focused deterministic tests.
3. Apply status-first ranking and the default, radio, ordinary, finish and Bom
   sort modes in the shared sorter.
4. Update the shared table's Plac cell, projection placement, view columns and
   reset behavior.
5. Verify the shared view callers, effective-status behavior and Bom boundary.
6. Run targeted unit tests, TypeScript checking and a production build.

## Acceptance checks

- Effective CHECKED-to-IN_FOREST remains computed, starts at allocated time,
  handles late check-in and excludes completed competitions.
- Status groups precede within-group ranking; OK always precedes active runners,
  and MP/DNF/DNS remain at the bottom.
- At most one rolling value appears per runner, only at the next passage.
- Radio sorting mixes actual and projected values at the selected control.
- Ordinary sorting uses actual readout values, then default LIVE order.
- Simplified and detailed views use the same ranking engine and have their
  specified columns.
- Reset changes only sort selection; it does not change validation, Bom or
  Firestore state.
- Bom results remain based exclusively on existing validated SI readout data.
