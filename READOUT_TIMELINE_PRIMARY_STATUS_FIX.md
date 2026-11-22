# Readout Timeline Primary Status Fix

## Result

Collapsed rows now show the result/readout status rather than the issue or
workflow name:

- OK results: **OK**
- MP results: **MP**
- Unknown-card readouts without a result: **Okänd bricka**
- Duplicate readouts: **Redan avläst**

Wrong-competitor, MP-review, manual-review, and other issue labels do not
replace a result status in the collapsed row. Result status is resolved first;
unknown readout state is the fallback, except that duplicate readouts retain
their explicit **Redan avläst** label.

Workflows remain in the expanded row. The expanded detail section labels the
current result **Resultat** and exposes applicable actions such as **Fel
löpare**, **Skapa MP-granskningsärende**, and unknown-card registration.
No workflow or persistence behavior was changed.

## Files changed

- `src/utils/readoutStatusPresentation.ts` — simplified the timeline primary
  status selection to use result/readout status, with the duplicate-readout
  label.
- `src/components/ReadoutDashboard.tsx` — labels the expanded current status
  **Resultat**.
- `src/components/ReadoutHistoryRow.test.tsx` — verifies the four required
  collapsed labels and that workflow labels are absent there but remain
  available in expanded content.

## Validation

- `npm run build` — passed.
- `npm run lint` — passed (`tsc --noEmit`).
- `npx vitest run src` — 42 test files passed, 6 skipped; 213 tests passed,
  29 skipped.

Existing Vite warnings about `__dirname` and the large client bundle are
unrelated to this change.
