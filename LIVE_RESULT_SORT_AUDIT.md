# Live Result Sort Audit

## Result

**Current behavior does not match the intended model.**

The `Förenklad vy` and `Sträcka & bom` tabs use the same row comparator in
`SplitsAnalysisTable`; the tabs change which passage columns are visible, not
the ranking algorithm.

The literal status `STARTAT` does not exist in the current `RunnerStatus` type
or result-sort branches. If “STARTAT” means a competitor who has started and
is still running, the corresponding current status is `IN_FOREST`. `CHECKED`
is also displayed with a rolling time in some cases, but is ranked in the
unstarted/other status group.

## Current ranking algorithm

`sortCompetitorsByResult()` in
[src/utils/resultSorting.ts](src/utils/resultSorting.ts#L68) applies status
groups before time comparisons:

1. `OK` and `PRELIMINARY_FIN`: rank group 0. In default mode they follow the
   `officialOrder` passed by the table; otherwise valid `runningTimeSec`
   sorts ascending.
2. `IN_FOREST`: rank group 1.
3. `MP`, `DNF`, and recognized disqualification/overtime values: rank group
   2. `MP` runners have an additional progress comparison based on consecutive
   valid controls, time at the last consecutive control, and valid punch count.
4. Other statuses, including `CHECKED`, `REGISTERED`, and `DNS`: rank group 3.

For `IN_FOREST` in **default mode**, the comparator does not compare any time:
the rolling-time comparison only runs for rank group 0. The comparator returns
0 between otherwise equal-ranked in-forest competitors, so the stable sort
retains their order from the input `inClass` array.

The table separately calculates a current elapsed display value from
`startTimeSec`/`allocatedStartSec` and the current clock in
[getLiveRunningTimeSec()](src/components/SplitsAnalysisTable.tsx#L12). That
value is used for the rendered time cell, not for sorting. The latest radio
passage is likewise not used by default ranking. `lastSeenTimeSec` is used to
order a separate incoming-runner speaker queue in
[SpeakerResultsView.tsx](src/components/SpeakerResultsView.tsx#L55); that is
not the result-table comparator.

## View comparison

| Behavior | Förenklad vy | Sträcka & bom |
|---|---|---|
| Default ranking | Same shared comparator: finished official results first, `IN_FOREST` next in input order, then later status groups. | Identical. |
| Start sort | Not available. `Starttid` is a plain header with no sort handler. | Not available. Same header. |
| Radio 1 / Radio 2 sort | A visible radio-control header can be clicked; it selects the course order for that control. The shared comparator sorts by `validation.splits[order].legSec`, not the live `radioSplits` passage value. | Same comparator and behavior. |
| Finish sort | The final `Spurt` leg is normally hidden by the simplified-column filter. The total `Tid` header is not clickable. | The `Spurt` final-leg header is clickable and sorts by its `validation` leg duration. The total `Tid` header remains non-sortable. |
| Reset | Returning to simplified view clears `sortByLegOrder`, restoring default mode. | Column selection is per class; clicking the active passage toggles back to default. |

`Sträcka & bom` also offers a separate `Bom` sort by total time loss. It is
not a Start/Radio/Finish sort.

## Column-sort details

`SplitsAnalysisTable` builds the mode from `sortByLegOrder` and calls
`sortCompetitorsByResult()` for both views at
[src/components/SplitsAnalysisTable.tsx](src/components/SplitsAnalysisTable.tsx#L329).
The column handler passes a course order, while
[getSelectedTime()](src/utils/resultSorting.ts#L97) reads only
`competitor.validation.splits.find(...).legSec`.

The table's displayed radio values are built separately:
`controlResults` prefers a matching `radioSplits` passage's `runningTimeSec`
and derives its leg time when needed
([SplitsAnalysisTable.tsx](src/components/SplitsAnalysisTable.tsx#L367)).
The row comparator never receives or reads that `controlResults` map. Thus a
live runner with a radio passage but no matching validation split receives a
null sort value and remains in input order; if a validation split exists, its
leg time wins even when the displayed radio passage is newer.

### Requested modes

- **Default:** `OK`/`PRELIMINARY_FIN` sort by official order and then
  `runningTimeSec`; `IN_FOREST` does not sort by rolling time or latest radio
  passage. It remains in input order.
- **Start:** no sort mode or clickable `Starttid` header exists.
- **Radio 1:** if its radio-control column is visible, clicking it sorts by
  the validation leg duration for that control order. It does not reliably
  sort in-forest runners by their current radio passage.
- **Radio 2:** same as Radio 1, using that control's course order.
- **Finish:** the detailed `Spurt` column, when present, sorts by the last
  leg's `legSec`, not by finish elapsed time. The total `Tid` column is not
  clickable. In simplified view, `Spurt` is normally hidden and `Tid` is
  still not clickable.

## Intended-model comparison

Intended:

- Default: finishers by finish/running time; active runners by current rolling
  race time.
- Column click: sort by the selected passage column.

Actual:

- The finisher portion broadly matches through official order and elapsed
  `runningTimeSec`.
- Active `IN_FOREST` rows are **not** sorted by current rolling time or latest
  radio passage.
- Start and total Finish/Tid are not sortable.
- Radio/Spurt clicks sort by a validation leg duration, not consistently by
  the selected displayed passage; live radio-only values are ignored by the
  comparator.

Therefore the intended model is **not met in either view**.

## Minimal implementation changes

1. **Use one explicit ranking value for default live ordering.** Extend the
   shared sorter or pass it precomputed sort values from
   `SplitsAnalysisTable`. For finished results use valid `runningTimeSec`; for
   `IN_FOREST` use the same live elapsed-time calculation used in the time
   cell. Decide explicitly whether `CHECKED` with a start time belongs in the
   active group. Preserve the existing status/MP ordering where it remains
   desired.
2. **Represent selected columns by semantic key, not only course order.**
   Add sort modes for Start, a radio control (control code/order), and Finish.
   For a Radio 1/2 click, compare that control's cumulative passage time from
   `radioSplits[].runningTimeSec` (with a documented fallback to the
   validated cumulative split), rather than reading only
   `validation.splits[].legSec`.
3. **Wire the missing controls.** Make `Starttid` sortable. Define Finish
   sorting against the total finish passage/elapsed result rather than the
   final-leg `Spurt` duration, and expose that sort action in both views.
   Keep the default and selected-column comparator shared between the two
   tabs.
4. **Add focused tests** in `src/utils/resultSorting.test.ts` for multiple
   `IN_FOREST` runners whose start times and radio passages disagree; verify
   default rolling-time order, Start order, Radio 1/2 passage order, and Finish
   order. Add a view-level check that both tabs use the same sort mode and
   that Start/Finish controls are reachable.

## Verification performed

`npx vitest run src/utils/resultSorting.test.ts` passes (1 file, 3 tests).
Those tests cover status grouping, MP progress, and a selected leg sort, but
do not test multiple in-forest runners, live radio-only values, Start sorting,
or Finish sorting. No code was changed as part of this audit.
