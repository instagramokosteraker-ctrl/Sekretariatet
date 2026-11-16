# Competition Context Preservation

## Goal

Keep the selected competition when switching between Publik vy and Sekretariat.
Also retain the selected class and public competition tab when those are active.
Do not substitute a latest, active-by-default, or otherwise inferred competition
when no competition is selected in the current public view.

## Audit and root cause

- `App.tsx` owns the current route and the Secretariat's `activeEventId`.
- Public competition selection and class filtering are represented in the URL as
  `id` and `class`; `PublicPortalView` also held the RESULTS/STARTLIST tab only in
  local component state.
- The Secretariat navigation callback replaced the URL with `/admin` and reset
  the route's competition and class to `null`. The route parser also discarded
  those query values on `/admin`.
- The reverse navigation used the Secretariat competition's short code instead
  of the competition selected in the public view. As a result, a public
  selection could be lost in both directions. The public tab reset when its
  component unmounted.
- No competition context provider or local/session-storage setting owns this
  selection. Existing browser storage is used for unrelated preferences and
  device/session state.

## Implementation

1. Keep `id`, `class`, and the public `tab` in the URL when entering Secretariat.
2. Resolve a public page's selected competition from its loaded race data and
   pass that context to the Secretariat navigation handler.
3. If an authenticated administrator enters Secretariat with a different
   selected competition in the route, load it through the existing competition
   activation flow. If the public page has no selected competition, leave the
   existing Secretariat selection unchanged; do not choose a fallback.
4. Keep route competition state synchronized with the existing Secretariat
   competition selector. Returning to Publik vy uses that selected ID and keeps
   any applicable class and public tab.
5. Store the public RESULTS/STARTLIST choice in the route so it survives the
   public component unmounting.

## Affected files

- `src/App.tsx` — route transitions, selected competition synchronization, and
  return navigation.
- `src/components/PublicPortalView.tsx` — pass selected competition/class/tab
  through navigation and synchronize the public tab with route state.
- `src/utils/competitionNavigation.ts` — route parsing and URL construction.
- `src/utils/competitionNavigation.test.ts` — route/context preservation tests.

## Implementation phases

1. **Audit:** completed; confirmed route state was dropped at the public to
   Secretariat boundary and identified the local public-tab state.
2. **Preserve route context:** completed; retain competition ID, class, and
   public tab across both directions.
3. **Synchronize Secretariat selection:** completed; use the existing
   competition activation flow only when a public competition was explicitly
   selected, and keep the route in sync with manual selection.
4. **Verify:** route tests, TypeScript check, and production build.

## Verification

- `npx vitest run src/utils/competitionNavigation.test.ts`
- `npm run lint` (TypeScript check)
- `npm run build`

The route tests cover preserving an explicitly selected competition, class,
and public tab in both directions, and confirm that a route without a selected
competition does not invent one.
