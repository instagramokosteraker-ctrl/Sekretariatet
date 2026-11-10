# Legacy Writer Inventory for Competitor Ownership Migration

Status: inventory and classification only; no code changes made.

## Scope

This inventory covers write paths that touch any of the following domains:

- competitors
- runnerDb
- seasonDb
- SI assignments
- readouts
- readout auto-create
- competitor creation / update / delete
- competition competitor collections

It is intentionally focused on code paths that either mutate competitor identity, mutate the active competition collection, assign or retire SI cards, or create/readout-derived competitor records.

## Executive summary

The repository still contains multiple active legacy writers. The dominant issue is not a single rogue route; it is a cluster of mixed-authority writes that still allow Express/seasonDb to mutate competitor identity or to seed competitor records without the SI assignment transaction boundary.

The current state is:

- Firestore-authoritative mutation paths exist for limited slices (`feePaid`, `rentalReturned`, and some SI-assignment helper transactions), but they are not yet the only valid writer for competitor identity.
- The primary remaining bypasses are legacy Express competitor CRUD, readout auto-create, Eventor/IOF imports, snapshot seeding, competition deletion, and the legacy season-restore/reset flows.
- The cloud-hydrate identity fence is implemented and validated, but the broader migration is not yet safe for uniqueness enforcement.

## Inventory

| # | File | Function | Route | Write target | Current authority model | Risk level | Migration status |
|---|------|----------|-------|--------------|------------------------|------------|------------------|
| 1 | `server.ts` | `app.post('/api/competitors', ...)` | `POST /api/competitors` | `seasonDb.eventsMap[*].competitors` | LEGACY | Critical | Remaining blocker |
| 2 | `server.ts` | `app.put('/api/competitors/:id', ...)` | `PUT /api/competitors/:id` | `seasonDb.eventsMap[active].competitors[id]` | LEGACY | Critical | Remaining blocker |
| 3 | `server.ts` | `app.delete('/api/competitors/:id', ...)` | `DELETE /api/competitors/:id` | `seasonDb.eventsMap[active].competitors` | LEGACY | Critical | Remaining blocker |
| 4 | `server.ts` | `POST /api/readout` inner auto-create branch | `POST /api/readout` | Creates competitor from `runnerDb` without SI assignment | LEGACY | Critical | Remaining blocker |
| 5 | `server.ts` | `processOnlinePunchForEvent` via `POST /api/online-punch` | `POST /api/online-punch` | competitor race state (`status`, `startTimeSec`, etc.) | LEGACY | High | Remaining blocker |
| 6 | `server.ts` | `app.delete('/api/competitions/:id', ...)` | `DELETE /api/competitions/:id` | removes whole competition and its competitor collection | LEGACY | Critical | Remaining blocker |
| 7 | `server.ts` | `app.post('/api/system/cloud-hydrate', ...)` | `POST /api/system/cloud-hydrate` | `seasonDb.eventsMap` / competitor collection hydration | REDIRECTED | High | Guarded; identity writes blocked |
| 8 | `server.ts` | `app.post('/api/system/restore', ...)` | `POST /api/system/restore` | full season restore / competitor identity snapshot restoration | REDIRECTED | High | Identity fence implemented |
| 9 | `server.ts` | `app.post('/api/system/reset-seed', ...)` | `POST /api/system/reset-seed` | clears or seeds seasonDb competition data | LEGACY | High | Remaining blocker |
| 10 | `server.ts` | `app.post('/api/import/batch', ...)` | `POST /api/import/batch` | `seasonDb.runnerDb` and imported competition state | LEGACY | High | Remaining blocker |
| 11 | `server.ts` | `app.post('/api/runner-db', ...)` | `POST /api/runner-db` | `seasonDb.runnerDb` | LEGACY | Medium | Remaining blocker |
| 12 | `server.ts` | `app.post('/api/runner-db/import', ...)` | `POST /api/runner-db/import` | `seasonDb.runnerDb` | LEGACY | High | Remaining blocker |
| 13 | `server.ts` | `app.put('/api/runner-db/:id', ...)` | `PUT /api/runner-db/:id` | `seasonDb.runnerDb[id]` | LEGACY | Medium | Remaining blocker |
| 14 | `server.ts` | `app.delete('/api/runner-db/:id', ...)` | `DELETE /api/runner-db/:id` | `seasonDb.runnerDb` | LEGACY | Medium | Remaining blocker |
| 15 | `server.ts` | `app.post('/api/eventor/import-event', async ...)` | `POST /api/eventor/import-event` | imports competition entries into season state and may create competitor identities | LEGACY | Critical | Remaining blocker |
| 16 | `server.ts` | `app.post('/api/system/clear-demo', ...)` | `POST /api/system/clear-demo` | deletes competitors from `seasonDb.eventsMap` without retire logic | LEGACY | High | Remaining blocker |
| 17 | `src/firebase.ts` | `saveDirectCompetitionEntryToFirestore` | client Firestore write path | `competitions/{competitionId}/competitors/{competitorId}` | AUTHORITATIVE (incomplete) | High | Firestore path exists, but not yet full SI assignment enforcement |
| 18 | `src/firebase.ts` | `updateCompetitorInFirestore` | client Firestore write path | `competitions/{competitionId}/competitors/{competitorId}` | AUTHORITATIVE (incomplete) | High | SI-change path exists, but uniqueness/assignment guarantee not enabled |
| 19 | `src/firebase.ts` | `deleteCompetitorFromFirestore` | client Firestore write path | competitor + assignment lifecycle | AUTHORITATIVE (incomplete) | High | Requires retirement strategy before hard delete |
| 20 | `src/firebase.ts` | `syncFullSeasonToFirestore` | administrative sync path | multiple `competitions/{id}/competitors/...` docs | REDIRECTED | Critical | Stale snapshot risk remains |
| 21 | `src/firebase.ts` | `saveCompetitionImportToFirestore` | import/write path | bulk competitor writes to Firestore | REDIRECTED | High | Import path remains a stale-source risk |
| 22 | `src/firebase.ts` | `runAtomicSIAssignmentMutation` | transaction helper | competitor + SI assignment transaction | AUTHORITATIVE (pre-enforcement) | High | Helper exists, but not yet used as the only authority boundary |
| 23 | `src/utils/siAssignmentDiagnostics.ts` | `runCompetitorMutation`, `runCompetitorMutations`, `declareCompetitorMutation` | shared mutation boundary | logging / diagnostics for legacy and assignment-aware mutations | REDIRECTED | Medium | Observational only; it does not enforce uniqueness |
| 24 | `src/utils/cloudHydrateCompetitorFence.ts` | `protectCloudHydratedCompetitors` | local guard | filters identity-changing cloud hydrate writes | REDIRECTED | Medium | Implemented and validated |
| 25 | `src/App.tsx` | UI wrappers and fallback writers (`handleCreateDirectEntry`, edit/update flows, import actions) | browser calls to server and Firestore | mixed legacy + Firestore routes | LEGACY / mixed-authority | Critical | Remaining blocker |

## Detailed path notes

### 1) `server.ts` — direct competitor CRUD routes

#### `app.post('/api/competitors', ...)`
- File: `server.ts`
- Function: `app.post('/api/competitors', (req, res) => {...})`
- Route: `POST /api/competitors`
- Write target: `seasonDb.eventsMap[active].competitors`
- Authority: LEGACY
- Why it matters: creates competitor identity in the legacy seasonDb mirror, then logs a mutation declaration but does not create a Firestore SI assignment.
- Risk: Critical. This is a direct competitor identity write outside the atomic SI transaction boundary.

#### `app.put('/api/competitors/:id', ...)`
- File: `server.ts`
- Function: `app.put('/api/competitors/:id', (req, res) => {...})`
- Route: `PUT /api/competitors/:id`
- Write target: `seasonDb.eventsMap[active].competitors[id]`
- Authority: LEGACY
- Why it matters: changes identity and SI state in Express/seasonDb; declares mutation as legacy and bypasses atomic owner validation.
- Risk: Critical.

#### `app.delete('/api/competitors/:id', ...)`
- File: `server.ts`
- Function: `app.delete('/api/competitors/:id', (req, res) => {...})`
- Route: `DELETE /api/competitors/:id`
- Write target: removal from `seasonDb.eventsMap[active].competitors`
- Authority: LEGACY
- Why it matters: deletes competitor identity without retirement logic.
- Risk: Critical.

### 2) Readout auto-create and competitor creation from runnerDb

#### `POST /api/readout` auto-create branch
- File: `server.ts`
- Function: `app.post('/api/readout', (req, res) => {...})`
- Route: `POST /api/readout`
- Write target: `db.competitors.unshift(autoCreatedRunner)` created from `seasonDb.runnerDb`
- Authority: LEGACY
- Why it matters: if no competitor is found, the route creates a competitor directly from runnerDb with no SI-assignment transaction.
- Risk: Critical.

### 3) Competition-level removals and stale snapshot writes

#### `DELETE /api/competitions/:id`
- File: `server.ts`
- Function: `app.delete('/api/competitions/:id', (req, res) => {...})`
- Route: `DELETE /api/competitions/:id`
- Write target: `seasonDb.eventsMap` and its child competitor list
- Authority: LEGACY
- Why it matters: removes a whole competition tree without retiring the associated SI assignments.
- Risk: Critical.

#### `POST /api/system/cloud-hydrate`
- File: `server.ts`
- Function: `app.post('/api/system/cloud-hydrate', (req, res) => {...})`
- Route: `POST /api/system/cloud-hydrate`
- Write target: `seasonDb.eventsMap` and competitor lists
- Authority: REDIRECTED
- Why it matters: the current implementation protects competitor identity, but the endpoint is still a legacy sync/hydration path and continues to carry mixed-authority semantics until all remaining server-side mutation paths are removed or fully redirected.
- Risk: High

#### `POST /api/system/restore`
- File: `server.ts`
- Function: `app.post('/api/system/restore', (req, res) => {...})`
- Route: `POST /api/system/restore`
- Write target: full season restore into `seasonDb.eventsMap`
- Authority: REDIRECTED
- Why it matters: restore identity and lifecycle checks are now present, but the path is still a legacy write and remains outside the atomic SI transaction boundary.
- Risk: High

### 4) Import and runner-db write paths

#### Eventor / IOF import flows
- File: `server.ts`
- Functions:
  - `app.post('/api/eventor/import-event', async ...)`
  - `app.post('/api/import/batch', ...)`
  - `app.post('/api/runner-db/import', ...)`
- Routes: `POST /api/eventor/import-event`, `POST /api/import/batch`, `POST /api/runner-db/import`
- Write target: `seasonDb.runnerDb`, imported competition entries, and newly created competitors
- Authority: LEGACY
- Why it matters: these flows can add new competitor identities without performing SI-card assignment creation or retirement in the same transaction.
- Risk: Critical.

#### RunnerDb direct writes
- File: `server.ts`
- Functions:
  - `upsertRunnerInSeasonDb`
  - `app.post('/api/runner-db', ...)`
  - `app.put('/api/runner-db/:id', ...)`
  - `app.delete('/api/runner-db/:id', ...)`
- Route: `POST/PUT/DELETE /api/runner-db*`
- Write target: `seasonDb.runnerDb`
- Authority: LEGACY
- Why it matters: runnerDb is not the same as Firestore SI assignment authority, but it feeds auto-create and readout behavior.
- Risk: Medium to High.

### 5) Firestore-authoritative helper writes

These are not the main blocker by themselves, but they are the intended migration target.

#### `saveDirectCompetitionEntryToFirestore`
- File: `src/firebase.ts`
- Function: `saveDirectCompetitionEntryToFirestore(params)`
- Route: browser/client Firestore write path (no route in `server.ts`)
- Write target: `competitions/{competitionId}/competitors/{competitorId}`
- Authority: AUTHORITATIVE (incomplete)
- Why it matters: this is the direct Firestore create path, but it is not yet the only accepted writer for competitor identity and does not fully enforce assignment ownership.
- Risk: High.

#### `updateCompetitorInFirestore`
- File: `src/firebase.ts`
- Function: `updateCompetitorInFirestore(competitionId, competitorId, patch)`
- Route: browser/client Firestore update path
- Write target: competitor document
- Authority: AUTHORITATIVE (incomplete)
- Why it matters: it is a canonical Firestore mutation but can still coexist with stale Express competitor writes unless single-writer enforcement is complete.
- Risk: High.

#### `deleteCompetitorFromFirestore`
- File: `src/firebase.ts`
- Function: `deleteCompetitorFromFirestore(competitionId, competitorId)`
- Route: browser/client Firestore delete path
- Write target: competitor document, plus assignment retirement flow if used
- Authority: AUTHORITATIVE (incomplete)
- Why it matters: delete is gated by the retirement model, but the migration is not yet complete enough to rely on it as the only deletion path.
- Risk: High.

#### `syncFullSeasonToFirestore`
- File: `src/firebase.ts`
- Function: `syncFullSeasonToFirestore(snapshot, isSuperAdmin)`
- Route: admin/client-side sync helper
- Write target: multiple competition/competitor collections
- Authority: REDIRECTED
- Why it matters: broad, stale-snapshot-like writes are a major stale-source risk and can re-seed competitor identity from older data.
- Risk: Critical.

#### `saveCompetitionImportToFirestore`
- File: `src/firebase.ts`
- Function: `saveCompetitionImportToFirestore(params)`
- Route: client import flow
- Write target: imported competitor records under `competitions/{id}/competitors/...`
- Authority: REDIRECTED
- Why it matters: it writes competitor rows in bulk, but import-path validation is not the same as a trusted transactional SI assignment boundary.
- Risk: High.

### 6) Diagnostics-only boundary and compatibility wrappers

#### `runCompetitorMutation` / `runCompetitorMutations`
- File: `src/utils/siAssignmentDiagnostics.ts`
- Functions: `runCompetitorMutation`, `runCompetitorMutations`, `declareCompetitorMutation`
- Route: none, called from multiple legacy and Firestore paths
- Write target: none directly; records mutation intent and logs diagnostics
- Authority: REDIRECTED
- Why it matters: these wrappers are not enforcing uniqueness or assignment ownership; they are still pre-enforcement diagnostics with the mutation continuing.
- Risk: Medium (but important as an indicator of remaining bypasses)

## Remaining P0 blockers summary

| Remaining P0 blocker | Why it matters | Classification |
|---|---|---|
| readout auto-create | creates competitor from runnerDb without SI assignment | LEGACY |
| Eventor import | bulk import can create competitor identities without assignment transaction | LEGACY |
| IOF import | same as Eventor import; can create or update competitor identities without assignment transaction | LEGACY |
| direct CRUD | Express routes still create, update, and delete competitor identities with no atomic SI write | LEGACY |
| snapshot seeding | `syncFullSeasonToFirestore` and snapshot-style writes can reintroduce stale competitor state | REDIRECTED / LEGACY |
| competition deletion | deletes full competition/competitor collections without SI retirement | LEGACY |
| cloud-hydrate | legacy hydration path was a risk until identity fence was added; still a compatibility path and not a full atomic authority boundary | REDIRECTED |
| restore/reset-seed | restore and reset flows still perform legacy rehydration without the assignment transaction | REDIRECTED / LEGACY |

## Bypass analysis

The following paths can still bypass the intended controls:

1. Atomic SI Matching
   - `POST /api/competitors`
   - `PUT /api/competitors/:id`
   - `DELETE /api/competitors/:id`
   - `POST /api/readout` auto-create
   - `POST /api/eventor/import-event`
   - `POST /api/import/batch`
   - `POST /api/system/restore`
   - `POST /api/system/reset-seed`
   - `syncFullSeasonToFirestore`

2. Competitor ownership guarantees
   - same list as above, plus legacy import and hydrate/reset paths that manipulate `seasonDb` without a Firestore assignment transaction

3. Uniqueness guarantees
   - none of the legacy Express paths enforce uniqueness at the assignment layer
   - the diagnostics wrappers are also intentionally non-blocking and therefore cannot guarantee uniqueness

4. Firestore transaction boundary
   - legacy Express routes bypass the Firestore transaction boundary entirely
   - even the diagnostics wrappers are only logging/monitoring; they do not enforce or short-circuit writes
   - the fire-and-forget cloud-sync and snapshot-like flows also bypass the strict atomic write model

## Final assessment

### GO / NO-GO

NO-GO.

### Explicit remaining blockers

1. Legacy Express competitor CRUD remains active and writes competitor identity without the atomic `siCardAssignments` transaction.
2. Readout auto-create still creates competitor records from `runnerDb` without assignment creation or retention checks.
3. Eventor and IOF imports still create or mutate competitor state outside the trusted SI assignment boundary.
4. Snapshot seeding and full-season sync are still stale-source risks unless they are rejected or guarded before writing.
5. Competition deletion and reset/restore flows still mutate competitor collections without retirement semantics.
6. The current mutation diagnostics service is non-blocking and therefore cannot be treated as enforcement.
7. Cloud-hydrate is fenced for identity changes, but the system remains mixed-authority until the remaining write paths are fully redirected or disabled.

### Recommended gating condition before GO

Only after the following are true should the project move to GO:

- all legacy competitor CRUD routes are disabled or redirected to the trusted backend transaction
- all import, restore, reset, and snapshot flows are read-only or gated against identity mutation
- Firestore rules and trusted backend enforcement are live and validated in a real environment
- concurrent duplicate attempts, rollback, and reassignment tests pass under emulator/integration validation
- uniqueness enforcement is enabled and survives real race conditions

This project is not yet ready for the next authority cutover nor for uniqueness enforcement.
