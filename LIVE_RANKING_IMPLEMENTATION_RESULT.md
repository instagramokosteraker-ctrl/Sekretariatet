# Live Ranking Implementation Result

## Summary

Implemented the live-ranking specification in the shared class results table.
Förenklad vy, Sträcka & bom, Speaker results and public class results use the
same ranking behavior.

- Kept all existing statuses and the computed CHECKED-to-IN_FOREST transition.
  The transition remains derived only and adds no Firestore writes.
- Replaced the separate placement and status cells with one Plac cell.
- Applied the required status-group order. Within IN_FOREST, completed radio
  control count ranks first, followed by the rolling elapsed value.
- Added the rolling `currentTime - actualStartTime` value at only the next
  unreached radio point, or in Tid when Finish is next.
- Added radio, ordinary-control, finish and Bom sort modes. Ordinary controls
  use validated SI readout values only; rows without values follow default LIVE
  order.
- Made Återställ ordning clear all selected sort modes.
- Left the server-side Bom calculation and SI readout validation unchanged.

## Files changed

- `src/components/SplitsAnalysisTable.tsx`
- `src/utils/resultSorting.ts`
- `src/utils/livePassage.ts`
- `src/utils/resultSorting.test.ts`
- `src/utils/livePassage.test.ts`
- `LIVE_RANKING_IMPLEMENTATION_PLAN.md`
- `LIVE_RANKING_PROJECTION_DECISION.md`
- `LIVE_RANKING_AND_BOM_COMPATIBILITY.md`
- `LIVE_RANKING_IMPLEMENTATION_RESULT.md`

## Tests and checks

- `npx vitest run --exclude firestore.rules.test.ts` — passed: 20 test files,
  98 tests; 4 files and 12 tests skipped.
- `npm run lint` — passed (`tsc --noEmit`).
- `npm run build` — passed.
- `git diff --check` — passed.
- Confirmed `server.ts` and `src/utils/readoutValidation.ts` have no changes.

The unfiltered `npx vitest run` cannot pass because the existing
`firestore.rules.test.ts` file contains no test suite. ESLint was also attempted
on the changed TypeScript files, but the repository ESLint configuration has
no matching rules for them; ESLint reported them as ignored, with no lint
errors.

The build reports existing Vite configuration and large-chunk warnings; the
production bundle is generated successfully.

## Remaining gaps

No known live-ranking behavior gaps remain against this specification. The
test-suite discovery issue and lack of ESLint coverage for these TypeScript
files are repository tooling limitations, not failures of the implementation.
