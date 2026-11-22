# Readout Wrong-Competitor UI Cleanup

## Result

The expanded readout summary no longer displays the `WRONG_COMPETITOR` issue
as an `Ärende` status. Result presentation remains `Resultat: OK` or
`Resultat: MP`; **Fel löpare** is presented only as a correction action.

The correction action remains available whenever
`isEligibleWrongCompetitorReadout` allows the readout, regardless of whether a
wrong-competitor issue is open. That existing eligibility predicate validates
processed receipt status, competitor IDs, and a reassignable result status.
The MP-review action remains available for an MP readout with no existing
issue. Repeat reassignment and audit behavior are unchanged.

## Files changed

- `src/components/ReadoutDashboard.tsx` — omits the wrong-competitor issue
  from the normal expanded summary; retains the eligible inline correction
  action.
- `src/services/readoutHistoryStore.test.ts` — verifies eligible OK, MP, and
  preliminary-finish records do not need an open issue.

No schema, persistence, or migration changes were needed.

## Validation

- `npm run build` — passed.
- `npm run lint` — passed (`tsc --noEmit`).
- `npx vitest run src` — 42 test files passed, 6 skipped; 213 tests passed,
  29 skipped. Existing reassignment-history tests passed.

The build reports existing Vite `__dirname` and large-bundle warnings.
