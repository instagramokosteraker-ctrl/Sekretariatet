# MP Control Visualization Implementation

## Result

Expanded OK and MP readout details now show one horizontal **Kontroller**
sequence. The prior punch-code/time chips are replaced for these results;
there is no separate expected-controls or actual-controls row.

- Correctly matched course controls are green.
- Missing required controls, including broken-control omissions, are red and
  shown in parentheses.
- Actual punches not matched to the required sequence are shown in normal
  text color at their captured position.
- The sequence can scroll horizontally without wrapping into another row.

The view uses the readout competitor snapshot's existing validation when
available. If it is absent, it runs the existing validator using the readout,
class, course, and emergency settings. Result status, ranking, sorting, raw
punch data, and server behavior are unchanged. No punch editing or correction
workflow was added.

## Files changed

- `src/components/ReadoutControlSequence.tsx` — merges ordered validation
  splits with captured punches and renders the color-coded one-line sequence.
- `src/components/ReadoutControlSequence.test.tsx` — tests correct controls,
  one and multiple missing controls, extra punches in sequence, and visual
  status styling.
- `src/components/ReadoutDashboard.tsx` — uses the visualization for expanded
  OK/MP readouts in place of the separate punch chips.

## Validation

- `npm run build` — passed.
- `npm run lint` — passed (`tsc --noEmit`).
- `npx vitest run src` — 43 test files passed, 6 skipped; 218 tests passed,
  29 skipped.

The build reports existing Vite `__dirname` and large-bundle warnings.
