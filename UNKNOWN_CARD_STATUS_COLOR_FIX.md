# Unknown-Card Status Color Fix

## Result

Unresolved unknown-card readouts now use the existing orange action tone rather
than the neutral gray tone. Their primary label remains **Okänd bricka**.
Existing result status still takes precedence, so after a successful link the
row returns to its normal result color and label, and its resolved issue no
longer appears in **Kräver åtgärd**.

No status-selection, workflow, or persistence behavior was changed.

## Files changed

- `src/utils/readoutStatusPresentation.ts` — selects the orange action tone for
  unresolved `UNKNOWN_CARD` records without an `OK` or `MP` result.
- `src/utils/readoutStatusPresentation.test.ts` — verifies orange unresolved
  state and normal result presentation after linking.
- `src/components/ReadoutHistoryRow.test.tsx` — verifies orange row styling,
  unchanged label, and restored result presentation after linking.
- `src/services/readoutHistoryStore.test.ts` — verifies unresolved unknown
  cards remain in the action filter and linked/resolved records leave it.

## Validation

- `npm run build` — passed.
- `npm run lint` — passed (`tsc --noEmit`).
- `npx vitest run src` — 43 test files passed, 6 skipped; 220 tests passed,
  29 skipped.

The build reported existing Vite `__dirname` and large-bundle warnings.
