# Readout Timeline Row Simplification

## Result

Collapsed rows now show one primary operational-state label and the existing
expand/collapse affordance. The row still retains its readout identity and
summary fields (runner, card, time, placement, and bom) so operators can
identify the readout without opening every row.

Synchronization state, issue state, delivery metadata, audit history, and
technical details are not repeated as collapsed-row badges. They remain in the
expanded row details. Unknown-card registration and competitor reassignment
are reached by expanding the row; their workflows remain attached to that
readout.

## Primary-state selection

- Duplicate readouts show **Redan avläst**.
- Open unknown-card issues show **Okänd bricka**.
- Open wrong-competitor issues show **Fel löpare**.
- MP review readouts with an MP result show **MP**.
- Other open issues show the issue label (or **Åtgärd krävs**).
- Otherwise, the readout result is shown, falling back to its readout state.

The row background continues to derive from result status; an open issue does
not recolor an OK result.

## Files changed

- `src/components/ReadoutHistoryRow.tsx` — replaced multiple collapsed status
  badges with one primary-state label and kept workflows in expanded content.
- `src/utils/readoutStatusPresentation.ts` — added primary operational-state
  selection.
- `src/components/ReadoutHistoryRow.test.tsx` — verifies primary states,
  reduced collapsed status noise, and expanded workflow placement.

No persistence, API, migration, filtering, or paging behavior changed.

## Validation

- `npm run build` — passed.
- `npm run lint` — passed (`tsc --noEmit`).
- `npx vitest run src` — 42 test files passed, 6 skipped; 212 tests passed,
  29 skipped.

Build output includes the existing Vite `__dirname` and large-chunk warnings.
