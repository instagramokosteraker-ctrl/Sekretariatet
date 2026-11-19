# Readout Row Clickability Fix

## Scope

Completed the Phase 2 row-reopenability UX fix. No reassignment, `WRONG_COMPETITOR`, correction transaction, or audit workflow was added.

## Changes

- Made the history row's primary, native button fill the complete available row area, including its previous outer padding. Rows now have a pointer cursor, hover feedback, a visible open-details chevron, an explicit instruction, keyboard focus styling, and `aria-pressed` selection state.
- Kept the unknown-card **Anmäl** button separate from the primary row button. It continues to force-open the selected record's registration details without nesting interactive controls. The selected-readout state and detail panel remain unchanged.
- Added focused row tests covering selection for `OK`, `MP`, unknown-card, and informational duplicate-readout records. Also covered the unknown-card action and selected-state accessibility attribute.

## Files changed

- `src/components/ReadoutDashboard.tsx`
- `src/components/ReadoutHistoryRow.tsx`
- `src/components/ReadoutHistoryRow.test.tsx`
- `READOUT_ROW_CLICKABILITY_FIX.md`

## Validation

- `npm run build` — passed; Vite reported the existing `__dirname` configuration warning and a large-chunk warning.
- `npm run lint -- --pretty false` — passed.
- `npx vitest run src` — passed: 35 files passed, 4 skipped; 161 tests passed, 12 skipped.
- `git diff --check` — passed.
