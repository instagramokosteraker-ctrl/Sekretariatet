# Draw class selector filter

## Result

**PASS** — the draw selector now contains only classes where `freeStart` is false. A competition with no draw-eligible classes shows a disabled selector with an explanatory message.

## Audit

- The active selector is in `src/components/DrawView.tsx`. `src/App.tsx` passes it the selected competition’s `classes` collection.
- `src/components/DrawAndEmergencyView.tsx` contains a second, currently unreferenced class-draw selector; it uses the same eligibility filter for consistency.
- The field is `CompClass.freeStart` (`src/types/sportident.ts`). Firestore class loading maps the stored field to a boolean. Class-draw execution updates it from the draw plan: interval and mass draws set it to `false`; free-start draws set it to `true`.

## Behavior

- The shared `getDrawEligibleClasses` helper filters only on `!class.freeStart`. It does not filter by competitor start allocations, so classes already assigned start times remain available when they are draw classes.
- Existing draw submission and server behavior are unchanged for eligible classes.
- Eventor API and XML imports create classes with `freeStart: false`, making imported classes eligible for start-time allocation. The import parsers do not provide a free-start configuration to preserve.
- The selection is reconciled against the filtered class list, preventing a previously selected free-start class from remaining the draw target.

## Regression coverage

`src/utils/drawClassSelection.test.ts` covers:

- all draw classes;
- only free-start classes;
- mixed classes.

`src/utils/eventorImport.test.ts` verifies imported Vit, Gul, Orange, and Svart classes are draw-eligible and retain their class identities.

## Verification

- `npm run build` — **PASS**
- `npm run lint` — **PASS**
- `npx vitest run src/utils/drawClassSelection.test.ts src/utils/eventorImport.test.ts src/utils/startListDraw.test.ts src/server/classDraw.test.ts` — **PASS**, 4 test files / 13 tests
- `git diff --check` — **PASS**

The production build emitted existing Vite configuration and large-chunk warnings; the build completed successfully.
