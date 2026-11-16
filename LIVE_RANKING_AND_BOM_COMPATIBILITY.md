# Live Ranking and Bom Compatibility

## Scope and conclusion

The live-ranking implementation changes presentation and sorting only. The
server-side Bom calculation and SI readout validation are unchanged.

The existing Bom algorithm is a server-side post-readout analysis. It uses
validated split legs from official `OK` competitors, grouped by class and
matched course. Live radio passages and the computed `effectiveStatus` are
separate inputs and must remain presentation/ranking data only. With that
boundary preserved, live ranking and automatic `IN_FOREST` status do not
require a Bom algorithm change.

The essential compatibility rule is: **do not write projected times into
validated splits, and do not feed a derived status or a projection into Bom
recalculation.** Continue to compute Bom from actual SI readout data and its
existing server recomputation path.

## Current Bom formula

The implementation is `recomputeAllSplitRanks()` in
[`server.ts`](./server.ts). For each non-rogaining class it:

1. Selects competitors whose stored status is `OK` and that have a validation.
2. Splits those competitors into cohorts by `validation.matchedCourseId`, so
   different courses in an open class are not compared together.
3. Calculates per-leg ranks, best leg time, and cumulative ranks from
   `validation.splits`. A usable leg has a non-null, non-negative `legSec`.
4. Calculates class/course ideal time as the sum of the best valid leg time at
   every active order. A `BROKEN_CTRL` order is skipped. Ideal time is absent
   if an active order has no best leg or the resulting sum is zero.
5. Estimates a reference leg time from the two fastest valid leg times at
   that order (or the only available time), averaging them and applying an
   8-second minimum:

   ```text
   refLeg[order] = max(8, average(up to 2 fastest valid leg times))
   ```

6. For each runner with usable leg ratios, calculates
   `legSec / refLeg[order]` for their valid legs. The runner's baseline pace
   ratio is the value at `floor((ratioCount - 1) * 0.35)` in the sorted ratios
   (the lower 35th-percentile sample, using zero-based indexing).
7. For each leg, calculates `expectedSec = round(refLeg * baselineRatio)` and
   `rawLoss = actual legSec - expectedSec`. A leg contributes to Bom only when
   the runner was not the leg winner and `rawLoss >= 12` seconds. Otherwise
   that leg's time loss is zero; a leg without usable timing has a null loss.
8. Sums qualifying leg losses into `totalTimeLossSec`. If running time is
   known, `mistakeFreeTimeSec` is
   `max(idealTimeSec ?? 0, runningTimeSec - totalTimeLossSec)`.

Special cases in the current implementation:

- Rogaining classes are skipped by the Bom/rank recomputation.
- A cohort of one gets zero per-leg and total Bom; mistake-free time is the
  runner's actual running time.
- A cohort with no usable leg ratios gets zero total Bom and actual running
  time as mistake-free time.
- The recomputation is based on stored `status === 'OK'`, not on
  `effectiveStatus`.

### Data sources and consumers

| Data | Current source/use |
|---|---|
| Start, finish, punches, matched course, cumulative and leg times | Actual SI readout validated into `validation.splits`; the split construction is in [`src/utils/readoutValidation.ts`](./src/utils/readoutValidation.ts). Emergency time offsets and broken controls are applied during validation. |
| Best leg, leg rank, cumulative rank, ideal time and Bom fields | The server recomputation above, written onto the validation data for each cohort. |
| Display and Bom sort | [`src/components/SplitsAnalysisTable.tsx`](./src/components/SplitsAnalysisTable.tsx) displays `timeLossSec` per detailed split and `totalTimeLossSec` in the detailed Bom column; [`src/utils/resultSorting.ts`](./src/utils/resultSorting.ts) sorts the Bom mode using `totalTimeLossSec` after its status grouping. `RunnerSplitCardModal` and `ReadoutDashboard` also read the stored validation fields. |
| Live radio passage | `Competitor.radioSplits`, containing station code, punch time and elapsed `runningTimeSec`. This data is not used by the Bom recomputation. |
| Derived running status | `effectiveStatus` from [`src/utils/effectiveRunnerStatus.ts`](./src/utils/effectiveRunnerStatus.ts), projected for display and sorting; it does not replace stored `status`. |

`src/utils/readoutValidation.ts` constructs SI-derived split validation, but
does not implement the Bom estimator. The server-side recomputation is the
identified source of the Bom/ideal-time fields; integrations that create or
recalculate readouts must continue to use the established recomputation path.

## Compatibility assessment

| Feature | Compatibility with existing Bom |
|---|---|
| Live ranking | Compatible if the ranking comparator reads actual/projection values without mutating `validation.splits` or Bom fields. |
| Projected radio passage | Compatible if projection is ephemeral and distinct from validated `legSec`, `cumulativeSec`, `timeLossSec`, and `totalTimeLossSec`. A radio punch may replace the displayed/sort projection with its actual passage, but must not be treated as an SI readout. |
| Automatic `IN_FOREST` | Compatible. [`src/utils/effectiveRunnerStatus.ts`](./src/utils/effectiveRunnerStatus.ts) only derives a view-model status from stored `CHECKED`, schedule, event date and lifecycle; it does not write status. Bom uses stored `OK` entrants, so overdue `CHECKED` entrants do not enter the Bom cohort. |
| Bom column/sort | Preserve the existing calculation, values, thresholds and tie handling. The result sorter applies the finalized status-group order before a selected Bom sort. Live ranking reset must not change the stored Bom fields or calculation. |

No Bom formula defect was found in the audited code. No Bom algorithm adjustment
is required by the live-ranking feature. The only required safeguards are to
keep projection fields separate from readout validation and to leave the
server recomputation's eligibility (`status === 'OK'`) and cohorting unchanged.

## Verification notes

- The application has result-sort tests in
  [`src/utils/resultSorting.test.ts`](./src/utils/resultSorting.test.ts), live
  passage tests in [`src/utils/livePassage.test.ts`](./src/utils/livePassage.test.ts),
  and effective-status tests in
  [`src/utils/effectiveRunnerStatus.test.ts`](./src/utils/effectiveRunnerStatus.test.ts).
- The targeted test set and TypeScript check pass. `server.ts` Bom
  recomputation was not modified.
