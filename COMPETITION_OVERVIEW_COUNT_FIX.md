# Competition overview count fix

## Change

`mergePublicCompetitionSummaries()` now keeps `competitorCount` and
`finishedCount` from the Firestore summary when API and Firestore entries share
a competition ID. API-only entries remain unchanged, Firestore-only entries
remain included, and the existing metadata merge behavior—including the
`classCount` fallback—is preserved.

## Tests

Updated `src/utils/publicCompetitionSummaries.test.ts` to cover:

- API `0/0` plus Firestore `24/6` results in `24/6`, while retaining the
  existing unrelated field merge behavior.
- API-only competitions retain their API counts.
- Firestore-only competitions retain their Firestore counts.

## Validation

- `npm run build` — passed.
- `npm run lint` — passed.
- `npx vitest run src/utils/publicCompetitionSummaries.test.ts` — passed,
  3 tests.

## Files changed

- `src/utils/publicCompetitionSummaries.ts`
- `src/utils/publicCompetitionSummaries.test.ts`
- `COMPETITION_OVERVIEW_COUNT_ANALYSIS.md` — marked as pre-fix analysis and
  linked to this resolution.
- `COMPETITION_OVERVIEW_COUNT_FIX.md`
