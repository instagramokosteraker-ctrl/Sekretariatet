# Unknown-Card Control Visualization

## Result

Unknown-card readouts now use the same expanded **Kontroller** visualization
as OK and MP readouts:

- Before a competitor/course is assigned, captured course-punch codes remain
  in readout order and use neutral text. No course-match colors or parentheses
  are shown.
- Configured non-course station punches (`CLEAR`, `CHECK`, `START`, `FINISH`,
  and `READOUT`) are excluded from the control sequence.
- After linking, the assigned readout validation supplies green matched,
  red parenthesized missing, and neutral extra controls.
- **Startstämpling** is shown for an unassigned unknown card and for assigned
  classes with `freeStart`; it reports **OK** or **Saknas**.
- **Målstämpling** is shown separately for each visualized SI-card readout and
  reports **OK** or **Saknas**.

The visualization is read-only. Readout status calculation, sorting, and
linking workflows are unchanged.

## Files changed

- `src/components/ReadoutControlSequence.tsx` — supports both unassigned
  neutral punches and validated course sequences, filters infrastructure
  punches, and displays start/finish stamps separately.
- `src/components/ReadoutControlSequence.test.tsx` — covers unknown-card
  sequence filtering, no validation colors/parentheses before assignment,
  assigned correct/missing/extra controls, and stamp states.
- `src/components/ReadoutDashboard.tsx` — displays the component for OK, MP,
  unassigned unknown-card, and successfully linked unknown-card rows; uses
  the assigned course validation after linking.

No server, Firestore, or persistence changes were made.

## Validation

- `npm run build` — passed.
- `npm run lint` — passed (`tsc --noEmit`).
- `npx vitest run src` — 43 test files passed, 6 skipped; 222 tests passed,
  29 skipped.

The build reports existing Vite `__dirname`, bundle-size, and plugin-timing
warnings.
