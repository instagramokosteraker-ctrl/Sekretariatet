# Result List Status Presentation Fix

## Implemented

### Plac column

The existing `RunnerStatusIndicator` compact-symbol behavior is unchanged.

The result table now uses numeric placement only for `OK`. Every other status
uses the existing status symbol:

- `PRELIMINARY_FIN`
- `IN_FOREST`
- `CHECKED`
- `REGISTERED`
- `MP`
- `DNF`
- `DNS`

The placement logic is centralised by `getResultListPlacementLabel`.

### Time column

The result-list time presentation is status-based:

- `OK`: running time.
- `IN_FOREST`: projected/running race time.
- `CHECKED`: empty.
- `REGISTERED`: empty.
- `MP`: `MP`.
- `DNF`: `DNF`.
- `DNS`: `DNS`.

Running time is no longer rendered for `MP`, `DNF`, or `DNS`.
`PRELIMINARY_FIN` retains its existing running-time presentation.

The public portal's result rows use the same status-based time presentation.

### MP ranking

The existing MP ordering logic is unchanged. MP competitors continue to be
ranked by consecutive correct controls, then last consecutive control time,
then valid punch count.

## Files changed

- `src/utils/resultSorting.ts`
  - Added shared placement/time presentation helpers.
- `src/utils/resultSorting.test.ts`
  - Added status-placement and status-time coverage.
- `src/components/SplitsAnalysisTable.tsx`
  - Uses numeric placement only for `OK`.
  - Uses status-based text in the time column.
- `src/components/PublicPortalView.tsx`
  - Uses status-based result time instead of always displaying running time.

## Validation

- `npm run build` — passed.
- `npm run lint` — passed.
- `npx vitest run src` — 42 test files passed, 6 skipped; 207 tests passed,
  29 skipped.

The build retains existing Vite `__dirname` and large-bundle warnings.
