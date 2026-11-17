# Readout Overview V5 Implementation

## Implemented

- Added shared status presentation for Latest Readout, readout history, and the selected-readout panel:
  - OK: green
  - MP without an active issue: yellow
  - Open human-action issue: orange
  - Open technical issue: red
  - Informational duplicate readout: blue
  - Other results: neutral
- Kept delivery and synchronization labels separate from result and issue colors.
- Replaced visible internal issue identifiers with Swedish operator terminology, including “Redan avläst” and “Dubblettkoppling”. History search also uses the localized issue labels.
- Marked local persistence failures as an open technical issue so they are red and included in Outstanding Issues.
- Polished the Outstanding Issues filter with an issue count, explanatory text, accessible focus indication, and colors shared with history rows.
- Kept “Redan avläst” informational and excluded from Outstanding Issues when its issue state is `NONE`.

The previously completed layout requirements remain in place: Latest Readout scrolls normally, displays “Avläsning nr”, and Competition Overview follows Readout History.

## Files changed

- `src/App.tsx`
- `src/components/ReadoutDashboard.tsx`
- `src/services/readoutHistoryStore.ts`
- `src/services/readoutHistoryStore.test.ts`
- `src/utils/readoutStatusPresentation.ts`
- `src/utils/readoutStatusPresentation.test.ts`

## Verification

- `npm run build` — passed.
- `npm run lint -- --pretty false` — passed.
- `npx vitest run src` — passed: 32 test files passed, 4 skipped; 149 tests passed, 12 skipped.

The build reports existing warnings for `__dirname` in the Vite config and a client bundle chunk larger than 500 kB.

## Scope boundary

No WRONG_COMPETITOR workflow, RESULT_REASSIGNMENT, correction transactions, or audit trail were implemented.
