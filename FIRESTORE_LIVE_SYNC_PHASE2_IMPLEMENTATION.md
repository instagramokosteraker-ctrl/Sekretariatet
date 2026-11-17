# Firestore Live Sync Phase 2

**Status:** Implemented.  
**Scope:** Speaker result/radio updates and Public Portal competition results
using competition-scoped Firestore projections.

## Implementation

### Speaker

- `App` subscribes Speaker-role sessions to
  `competitions/{competitionId}/publicResults`.
- The subscription only supplies actual radio splits. Validated status, start,
  finish, and other staff data continue to come from the existing authorized
  competitor listener, so Speaker shares the existing result state rather
  than introducing another ranking engine.
- Listener cleanup follows competition and role changes. Public-result updates
  are merged by competitor ID and cannot overwrite the staff competitor data.
- Speaker does not receive access to raw station-punch documents.

### Public Portal

- The selected competition subscribes to
  `competitions/{competitionId}/publicResults`; a selected class adds a
  `classId` filter.
- The portal subscribes to the same competition's
  `publicMetadata/summary` document for competition display data, radio
  controls, and emergency display fields.
- The Public Portal's `/api/ws` reconnect and refetch path was removed.
  Existing REST/Firestore one-shot loading remains a bootstrap path.
- Public Portal runner detail cards no longer display SI numbers.
- The public race API serializes result rows through the safe projection
  mapper and omits the event feed, rather than returning raw competitor
  documents.
- Firestore fallback loading reads the `publicResults` projection and no
  longer loads raw competitors or an unruled `publicSeason/standings`
  document.

### Safe projection and writes

`publicResults/{competitorId}` contains display identity, class, stored status,
allocated/actual times, and actual radio/prewarning splits. It excludes SI
number, card series, raw readout, validation, and ordinary SI-card punches.
The UI adapter uses a placeholder SI number only to satisfy existing internal
types; it is not shown in the public view.

Projection writes were added alongside existing client and server-side
competitor creation, result/readout, online radio punch, direct entry,
recalculation, and SI-assignment retirement flows. Deleting a competitor
deletes its projection. An Admin seed/repair operation backfills projection
rows and actual radio splits from canonical competitor and station-punch data
for the selected competition.

Manual finish is also written through the Firestore result path after a
successful API response. This keeps the canonical competitor and public
projection synchronized rather than relying on a socket broadcast. The
Firestore rule permits only the READOUT and FOREST roles to make that limited
manual-finish update.

### Firestore rules

- Public clients can read `publicResults` and the `publicMetadata/summary`
  document.
- Raw competitor reads require a verified staff/admin role. Public access to
  raw stations and station punches remains denied.
- Projection writes are restricted to verified authorized staff, validate
  the safe field set, and require the projected result fields to match the
  competitor's post-write document.
- Projection deletes are allowed only to Admin when the canonical competitor
  is deleted.
- The season standings projection is not implemented; the Firestore fallback
  returns no series standings when the API bootstrap is unavailable.

## Files changed

- `src/types/sportident.ts` — public result and metadata types.
- `src/utils/publicResultProjection.ts` — safe projection, parser, adapter,
  and radio-split helpers.
- `src/utils/publicResultProjection.test.ts` — projection privacy and parsing
  tests.
- `src/firebase.ts` — projection subscriptions, metadata listener/publisher,
  seed/repair helper, safe public fallback, and projection writes.
- `src/App.tsx` — Speaker listener, Admin projection/metadata maintenance,
  and Firestore persistence after successful manual finish API calls.
- `src/components/PublicPortalView.tsx` — public result/metadata listeners
  and removal of the public WebSocket refresh path.
- `src/components/RunnerSplitCardModal.tsx` — optional SI-number display,
  disabled by the Public Portal.
- `server.ts` — safe public API result serialization.
- `src/server/competitorCreation.ts`,
  `src/server/readoutAutocreate.ts`, and
  `src/server/siAssignmentRetirement.ts` — server-side projection writes.
- `firestore.rules` — public projection access and raw competitor-read
  restriction, plus manual-finish role authorization.
- `firestore.rules.test.ts` — public projection and manual-finish rule cases.
- `FIRESTORE_LIVE_SYNC_IMPLEMENTATION_PLAN.md` — phase status and remaining
  work.

## Verification

- `npm run build` — passed.
- `npm run lint` — passed after final test type correction.
- `npx vitest run src` — passed: 25 test files, 114 tests; 4 files and 12
  tests skipped by existing test configuration.
- Isolated Firestore emulator public-projection rule suite — passed. It
  verifies public reads of safe projections/metadata, denial of raw
  competitor/station/station-punch reads, rejection of mismatched or private
  projection fields, and a READOUT/FOREST manual-finish update with its
  matching public projection.
- The full existing Firestore rules suite was attempted but remains blocked
  by its existing Firestore Rules 1,000-expression evaluation limit in the
  broader competitor-update tests. The isolated Phase 2 rule suite avoids
  that unrelated oversized test path.

The production build reports existing Vite `__dirname` and large-chunk
warnings; neither is a Phase 2 failure.

## Remaining live-sync gaps

- The Admin seed/publish effect currently maintains the selected competition.
  Existing historical competitions with no projection rows need an Admin
  selection/seed pass before their Firestore result listener can supply live
  rows. The sanitized REST bootstrap remains available for initial display.
- Series standings are not yet published to a public Firestore projection.
- Staff station configuration and the cross-client Readout activity feed
  remain outside this phase. Secretariat's broader WebSocket state sync is
  still present for non-result operational fields; it was not expanded or
  used as a Speaker/Public Portal result source.
- Firestore rules have not been deployed. Until deployment, production
  listeners and writes will use the previously deployed rules and may not
  have the new projection permissions.

