# Competitor Cutover Prerequisites

This document inventories every remaining competitor/readout write path that can still write stale `seasonDb` data over Firestore-owned state. It is based on:

- [COMPETITOR_READOUT_ARCHITECTURE.md](./COMPETITOR_READOUT_ARCHITECTURE.md)
- [P0_RESOLUTION_PLAN.md](./P0_RESOLUTION_PLAN.md)
- [CUTOVER_CHECKLIST.md](./CUTOVER_CHECKLIST.md)
- [MIGRATION-STATUS.md](./MIGRATION-STATUS.md)

Status: analysis only; no code changes.

## Executive summary

The main migration blocker is not the absence of Firestore writes. It is that several legacy write paths still mutate the same competitor and readout state through `seasonDb`/Express, while Firestore is already being treated as canonical for some fields and some flows.

The danger is not isolated to one route. It is a cluster of stale snapshot, restore, cloud export/hydrate, import, direct-entry, and readout/punch paths that can still write older state back over newer Firestore state.

The single most important principle before Competitor Phase 2 starts is:

- No legacy `seasonDb` or Express snapshot path may write competitor/readout state after Firestore is authoritative.
- Any remaining write must be either disabled, routed through a trusted backend, or explicitly prevented by a stale-write guard.

## 1. Remaining seasonDb/Express write paths that can still overwrite Firestore-owned state

### 1.1 Competitor creation paths

P0 — must be solved

- File: [server.ts](./server.ts)
  - Route: `POST /api/competitors`
  - Function: `app.post('/api/competitors', ...)`
  - Effect: creates a competitor in the active `seasonDb` event, updates `db.competitors`, records events, and persists a mutation via `persistUserMutation()` and `broadcastFullState(...)`.
  - Risk: if this route is still active while Firestore is authoritative, it can re-create or overwrite competitor identity and state in the legacy mirror after Firestore accepted a newer value.

- File: [src/firebase.ts](./src/firebase.ts)
  - Function: `saveDirectCompetitionEntryToFirestore(params)`
  - Effect: direct Firestore competitor creation path for authenticated clients.
  - Risk: This is the Firestore-first path, but it still coexists with the legacy `POST /api/competitors` route and can be partially mirrored back through Express if the server-side mirror is not fenced.

- File: [src/App.tsx](./src/App.tsx)
  - Function: `handleCreateDirectEntry`
  - Effect: first tries the legacy Express route, then falls back to Firestore creation via `saveDirectEntryToFirestore`.
  - Risk: fallback logic can create a Firestore competitor and still keep the legacy Express route active; if stale snapshot logic later reapplies, the system can drift.

- File: [src/firebase.ts](./src/firebase.ts)
  - Function: `syncFullSeasonToFirestore(snapshot, isSuperAdmin)`
  - Effect: loops through every event and creates or updates competitor docs under `competitions/{competitionId}/competitors/...`.
  - Risk: this is a broad legacy-to-Firestore path that can seed a whole competitor collection from stale server state. It is not a safe current writer unless the stale-write guard is enforced.

- File: [src/firebase.ts](./src/firebase.ts)
  - Function: `saveCompetitionImportToFirestore(params)`
  - Effect: imports bulk competition data into Firestore, including competitor rows.
  - Risk: importer writes competitor records without fully excluding newer Firestore-owned fields from stale snapshot updates. It is a major stale-source risk.

### 1.2 Competitor update paths

P0 — must be solved

- File: [server.ts](./server.ts)
  - Route: `PUT /api/competitors/:id`
  - Function: `app.put('/api/competitors/:id', ...)`
  - Effect: writes directly into the active `seasonDb` competitor array and recalculates state.
  - Risk: legacy maintenance writes can overwrite Firestore competitor fields that were just updated from the canonical path.

- File: [src/firebase.ts](./src/firebase.ts)
  - Function: `updateCompetitorInFirestore(competitionId, competitorId, patch)`
  - Effect: canonical Firestore update path for competitor fields.
  - Risk: it is necessary, but it is not enough unless all legacy writers are fenced. If Express still writes the same fields, this becomes an authority conflict.

- File: [src/App.tsx](./src/App.tsx)
  - Function: `onUpdateCompetitor={async (id, patch) => { ... }}`
  - Effect: for non-billing patches, it still calls the Express route first and only then updates Firestore.
  - Risk: this is a mixed-authority flow and is a direct cause of stale Express state overriding newer Firestore state.

- File: [src/App.tsx](./src/App.tsx)
  - Function: `updateActiveCompetitorBillingFields`
  - Effect: writes to Firestore then mirrors the same values to Express.
  - Risk: acceptable only for the Phase 1 fields. It must not be generalized to the rest of competitor state before the authority boundary is fully enforced.

### 1.3 Competitor deletion and retirement paths

P0 — must be solved

- File: [server.ts](./server.ts)
  - Route: `DELETE /api/competitors/:id`
  - Function: `app.delete('/api/competitors/:id', ...)`
  - Effect: removes the competitor object from `db.competitors` and persists the mutation.
  - Risk: this still deletes from the legacy state and can become a stale overwrite if the same competitor document has newer Firestore history.

- File: [src/firebase.ts](./src/firebase.ts)
  - Function: `deleteCompetitorFromFirestore(competitionId, competitorId)`
  - Effect: canonical Firestore delete of a competitor document.
  - Risk: legal only after dependency checks and retirement strategy are complete. Without them, Firestore deletes can destroy historical readout or punch data that still matters.

- File: [src/firebase.ts](./src/firebase.ts)
  - Function: `syncFullSeasonToFirestore(snapshot, isSuperAdmin)`
  - Effect: inside the competitor sync loop, `for (const oldId of existingCompIds) { if (!nextCompIds.has(oldId)) delete }`
  - Risk: this is the most direct stale-snapshot delete path. It can delete a Firestore-owned competitor record that exists in Firestore but not in the stale server snapshot.

### 1.4 Race status update paths

P0 — must be solved

- File: [server.ts](./server.ts)
  - Route: `POST /api/readout`
  - Function: `app.post('/api/readout', ...)`
  - Effect: processes both full SI readouts and offline queue submissions, mutates `db.competitors` state, and updates `db.events`.
  - Risk: this is a legacy status mutation path and it is exactly the same state the Firestore competitor document already models.

- File: [server.ts](./server.ts)
  - Route: `POST /api/online-punch`
  - Function: `app.post('/api/online-punch', ...)`
  - Effect: mutates competitor race state and produces online-punch side effects from the server state cluster.
  - Risk: this can update both current status and split/derived values in a way that diverges from Firestore-owned authoritative state.

- File: [src/firebase.ts](./src/firebase.ts)
  - Function: `updateCompetitorInFirestore(competitionId, competitorId, patch)`
  - Effect: canonical Firestore status mutation path.
  - Risk: status mutation still coexists with old readout/punch processing paths, which means the app can accept a newer authoritative Firestore status while a stale Express route later overwrites it.

- File: [src/App.tsx](./src/App.tsx)
  - Function: `handleManualFinish`, `onUpdateRunnerStatus`, and direct readout/punch actions using `updateCompetitorInFirestore`/legacy API
  - Effect: these include both Firestore and Express phases depending on code path.
  - Risk: mixed-authority transitions are a code-level hazard during Phase 2.

### 1.5 Readout processing paths

P0 — must be solved

- File: [server.ts](./server.ts)
  - Route: `POST /api/readout`
  - Function: `app.post('/api/readout', ...)`
  - Effect: the principal legacy readout implementation for full SI-card memory readouts, raw archive, offline queue replay, and processed state updates.
  - Risk: this route directly mutates `seasonDb`, producing end state that can overwrite newer Firestore readout/competitor values.

- File: [server.ts](./server.ts)
  - Effect: offline queue/idempotency logic in same route, using request payloads and processed IDs.
  - Risk: if the stable operation ID and receipt model are not fully enforced, a retry can produce a duplicate or stale mutation.

- File: [src/firebase.ts](./src/firebase.ts)
  - Firestore paths for `readoutReceipts`, `stationPunches`, etc. exist, but migration is incomplete.
  - Risk: Firestore readout receipts and legacy server processing both exist; without a strict authority boundary, they compete.

### 1.6 Punch processing paths

P0 — must be solved

- File: [server.ts](./server.ts)
  - Route: `POST /api/online-punch`
  - Function: `app.post('/api/online-punch', ...)`
  - Effect: maps online punch inputs into race state and stores it in `seasonDb`.
  - Risk: this trims the authoritative state and can race with Firestore `stationPunches` workflows.

- File: [src/firebase.ts](./src/firebase.ts)
  - Firestore infrastructure for `stationPunches` exists, but the authoritative boundary is not fully enforced.
  - Risk: the same punch event may be both written to Firestore and also processed through the legacy server path.

## 2. Stale-snapshot risks

P0 — must be solved

These are the most dangerous stale-write risks because they are broad, automated, and often hidden behind “sync” flows.

- File: [src/firebase.ts](./src/firebase.ts)
  - Function: `syncFullSeasonToFirestore(snapshot, isSuperAdmin)`
  - Risk: writes competitor updates and deletions based on an exported legacy snapshot. It may overwrite or delete newer Firestore state.

- File: [src/firebase.ts](./src/firebase.ts)
  - Function: `saveCompetitionImportToFirestore(params)`
  - Risk: import payloads are a snapshot-like write pattern; they can overwrite current Firestore competitor fields if the importer is allowed to update matching docs.

- File: [src/firebase.ts](./src/firebase.ts)
  - Function: `loadFullSeasonFromFirestore(options?)`
  - Risk: reads the current Firestore state, but it is used as the source for application hydration and can propagate stale values back into Express if the hydrate path is invoked with an older snapshot.

- File: [src/App.tsx](./src/App.tsx)
  - Effects in the app that call `syncFullSeasonToFirestore` and `cloud-hydrate` after cold start and after admin changes.
  - Risk: these are automatic flows and can silently reapply stale server state when the app is freshly hydrated.

- File: [server.ts](./server.ts)
  - Functions that persist season snapshots from `seasonDb` via `saveSeasonDatabase(...)`, `persistUserMutation()`, `broadcastFullState(...)` and export routes.
  - Risk: these make stale JSON state an active writer in the process.

## 3. Cloud-export / cloud-hydrate risks

P0 — must be solved

- File: [server.ts](./server.ts)
  - Route: `GET /api/system/cloud-export`
  - Function: `app.get('/api/system/cloud-export', ...)`
  - Effect: exports the current `seasonDb` state to a snapshot.
  - Risk: an exported legacy snapshot is an active stale-source for future hydrate/sync steps and can reintroduce stale competitor state.

- File: [server.ts](./server.ts)
  - Route: `POST /api/system/cloud-hydrate`
  - Function: `app.post('/api/system/cloud-hydrate', ...)`
  - Effect: hydrates the Express app from a snapshot and calls `applySnapshot`/`broadcastFullState`.
  - Risk: if this is allowed to overwrite current Firestore-owned competitor/readout state, the migration loses authority.

- File: [src/App.tsx](./src/App.tsx)
  - Function: cold-start hydration code path that calls `loadFullSeasonFromFirestore()` and then `POST /api/system/cloud-hydrate`.
  - Risk: synchronous hydration of Express from a Firestore snapshot with stale local state is a replay path that can reintroduce old competitor fields.

- File: [src/components/AccessControlView.tsx](./src/components/AccessControlView.tsx)
  - Code that performs `cloud-export` and `cloud-hydrate` in the admin UI.
  - Risk: UI-driven cloud sync can reinject stale data into the server while Firestore is canonical.

## 4. Express snapshot overwrite risks

P0 — must be solved

- File: [src/App.tsx](./src/App.tsx)
  - Function: `applySnapshot(hydrated)` and the subsequent `setCompetitors(...)`, `setCompetition(...)`, `setCourses(...)`, `setClasses(...)`, and `setStations(...)` writes.
  - Risk: snapshot-driven state replacement is still present and can overwrite Firestore-owned values in the client state even after Firestore is authoritative.

- File: [src/App.tsx](./src/App.tsx)
  - Effect: `if (!hasFirestoreIdentity) return snap.competitors;` and similar snapshot logic.
  - Risk: the code still silently accepts the server snapshot as current state under some conditions, which means stale values can reappear after a refetch or reload.

- File: [server.ts](./server.ts)
  - `broadcastFullState(...)` and `persistUserMutation()`
  - Risk: these produce and re-broadcast the whole state tree, which is exactly how stale competitor/readout state is reintroduced to the app.

- File: [server.ts](./server.ts)
  - Legacy state object: `db.competitors`, `db.events`, `db.roc`, and related derived race fields.
  - Risk: they remain the source of the entire compatibility view.

## 5. Mandatory prerequisites before Competitor Phase 2 starts

### P0 — must be solved before Phase 2

- Freeze all legacy competitor mutation routes:
  - `POST /api/competitors`
  - `PUT /api/competitors/:id`
  - `DELETE /api/competitors/:id`
  - `POST /api/readout`
  - `POST /api/online-punch`
- Disable or route all legacy write logic through a trusted backend with clear role validation.
- Fence all stale snapshot writers:
  - `syncFullSeasonToFirestore`
  - `saveCompetitionImportToFirestore`
  - `cloud-export`
  - `cloud-hydrate`
  - `persistUserMutation`
  - `broadcastFullState`
- Enforce a stale-write guard that blocks any snapshot delete/update for Firestore-owned competitor docs.
- Define and deploy the SI-card assignment ownership model before any competitor mutation is allowed.
- Define and deploy operation idempotency for all readout/punch writes before concurrent retries are possible.
- Ensure identity and history are preserved for competitor deletion/retirement decisions.
- Ensure `readoutReceipts` and `stationPunches` have immutable history semantics before competitor state becomes authoritative.
- Add reconciliation checks for the following invariants:
  - receipt exists for every accepted readout
  - competitor update exists for every accepted readout
  - outbox event exists for every canonical mutation
  - count matches actual competitor data
  - no stale snapshot can delete newer Firestore state

### P1 — should be solved before or immediately after Phase 2 cutover

- Remove nonessential fallback logic in UI that still calls Express routes for competitor mutation.
- Reduce or eliminate the dual-read pattern where UI reads stale Express data and then writes Firestore.
- Add read-only replay/reconciliation tooling to detect stale wipes after sync/hydrate actions.
- Add job-level audit logging for all imports and snapshot sync operations.
- Add explicit validation for competitor retirement, deletion dependencies, and counts before deleting any record.

### P2 — can wait, but must be tracked

- General cleanup of legacy JSON persistence behavior.
- Non-critical UI wrappers that still call old APIs during transitional compatibility periods.
- Extra aggregate reconciliation jobs that are not required for the first safe cutover.
- Operational improvements to replay logic and duplicate filtering after the core migration is stable.

## 6. Migration blockers by category

### Blocker A — legacy competitor mutation still active

- Files: [server.ts](./server.ts), [src/App.tsx](./src/App.tsx)
- Functions/routes: `POST /api/competitors`, `PUT /api/competitors/:id`, `DELETE /api/competitors/:id`, `handleCreateDirectEntry`, `onUpdateCompetitor`
- Impact: stale legacy writes can overwrite Firestore-owned state.

### Blocker B — stale snapshot sync still active

- Files: [src/firebase.ts](./src/firebase.ts), [src/App.tsx](./src/App.tsx), [server.ts](./server.ts)
- Functions: `syncFullSeasonToFirestore`, `loadFullSeasonFromFirestore`, `cloud-export`, `cloud-hydrate`, `broadcastFullState`
- Impact: snapshot replay can overwrite newer Firestore state.

### Blocker C — readout/punch processing still mutates legacy state

- Files: [server.ts](./server.ts)
- Routes: `POST /api/readout`, `POST /api/online-punch`
- Impact: legacy race-state updates are still active and continue to affect the same competitor state as Firestore.

### Blocker D — authority boundary not enforced

- Files: [firestore.rules](./firestore.rules), [src/firebase.ts](./src/firebase.ts), [server.ts](./server.ts)
- Impact: Firestore rules and trusted backend execution must prevent client or legacy API paths from bypassing the authoritative write model.

### Blocker E — no complete retirement/dependency policy

- Files: [src/firebase.ts](./src/firebase.ts), [server.ts](./server.ts)
- Impact: deletion can destroy a live competitor, active readout history, or an important receipt dependency.

## 7. Concrete action list before Phase 2 start

Before enabling any competitor Phase 2 writes, the following must be true:

1. All legacy `seasonDb` competitor mutation routes are disabled or redirected.
2. All snapshot-driven writes have a stale-write guard.
3. All cloud-export/cloud-hydrate and restore paths are read-only for migrated competitor/readout domains.
4. Competitor creation and update are single-authority, not dual-write.
5. Readout and punch processing are idempotent and receipt-based.
6. Competitor deletion includes required dependency checks.
7. Firestore rules prevent direct client writes to the migrated competitor paths.
8. The app is validated to reject or ignore stale Express snapshots for competitor/readout state.
9. A reconciliation report confirms that competitor state and counts are aligned to Firestore before the cutover.

## 8. Summary

Competitor Phase 2 cannot start safely while the system still contains a set of broad, stale snapshot and legacy mutation paths that can write competitor and readout data through `seasonDb`/Express. The main problem is authority conflict, not just missing Firestore logic.

The mandatory fix is not “write more to Firestore.” It is: 
- fence legacy writes,
- disable stale snapshot mutation,
- enforce single-writer authority,
- lock idempotency and transaction integrity,
- then start the actual competitor migration.
