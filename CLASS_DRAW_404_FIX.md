# Class Draw 404 Fix

## Implemented

- `DrawView` reconciles its selected class against the current class list. A
  stale class ID is replaced with the first available class (or cleared when
  there are no classes), and submission is blocked unless the selected ID
  belongs to the current list.
- `POST /api/draw/class` now includes the selected `competitionId`.
- The server requires both `competitionId` and `classId`, then runs the draw
  only against that competition's event and matching class. The route no
  longer calls `getActiveEvent()`.
- The Firestore fallback uses the same selected competition ID.

## Regression coverage

- Competition switching while the Draw view stays mounted resets a stale class
  selection.
- Empty class lists clear stale IDs; valid current selections are preserved.
- Server draw execution targets the requested competition even when another
  competition is first/active in the event map. Tests use the same class ID in
  both competitions and verify that only the requested event's competitors
  receive allocations.
- A class ID that exists only in another competition is rejected for the
  requested competition without changing either event.
- Unknown competition IDs are rejected.

## Files changed

- `src/components/DrawView.tsx`
- `src/utils/drawClassSelection.ts`
- `src/utils/drawClassSelection.test.ts`
- `src/App.tsx`
- `server.ts`
- `src/server/classDraw.ts`
- `src/server/classDraw.test.ts`
- `CLASS_DRAW_404_ANALYSIS.md`

## Verification

- `npm run build` — passed.
- `npm run lint` — passed (`tsc --noEmit`).
- `npx vitest run src/utils/startListDraw.test.ts src/utils/drawClassSelection.test.ts src/server/classDraw.test.ts` — passed, 3 test files and 8 tests.
- `git diff --check` — passed.

The production build emitted existing non-blocking Vite configuration and
large-chunk warnings.

## Remaining gaps

- Tests exercise the selection reconciler and the same draw service called by
  the Express route; they do not start an HTTP server or exercise a deployed
  Vercel function.
- Firestore fallback behavior and a live competition switch in a browser were
  not exercised.

## Follow-up: Firestore-only competition 404

The draw API looks up competitions in the Express server's `seasonDb.eventsMap`.
Some competitions (including imports created directly in Firestore) can exist
in Firestore without an entry in that server-side map. In that case the API
returns `HTTP 404: Tävlingen hittades ej.` even though the selected competition
exists.

The client now treats a draw API 404 as a reason to run the draw through
`saveClassStartDrawToFirestore`, which reads the selected competition and class
directly from Firestore. Other client errors such as 400 and 403 still surface
without fallback. This fallback decision is covered by
`src/utils/classDrawFallback.test.ts`.
