# Competitor Cutover Readiness

Status: documentation only; no code changes.

Source material:

- [COMPETITOR_PHASE2_DESIGN.md](./COMPETITOR_PHASE2_DESIGN.md)
- [COMPETITOR_READOUT_ARCHITECTURE.md](./COMPETITOR_READOUT_ARCHITECTURE.md)
- [P0_RESOLUTION_PLAN.md](./P0_RESOLUTION_PLAN.md)
- [CUTOVER_CHECKLIST.md](./CUTOVER_CHECKLIST.md)
- [COMPETITOR_CUTOVER_PREREQUISITES.md](./COMPETITOR_CUTOVER_PREREQUISITES.md)

## Executive summary

This project is not ready to begin Competitor Phase 2 implementation in a production-safe way.

The design work is strong enough to define the target, and the first niche migration step (`feePaid` / `rentalReturned`) is already complete, but the project still has unresolved winner/loser authority conflicts in the legacy competitor and readout write paths. The core blocker is not the Phase 2 schema itself; it is stale-writer elimination and authority enforcement.

Final readiness verdict: RED

Reason: the project still contains multiple legacy `seasonDb` and Express mutation paths that can write competitor/readout state after Firestore is treated as canonical, and the required cutover protections have not been fully implemented or validated.

## 1. What is already ready

The following items are in a reasonably good state:

### 1.1 Phase 1 migration is implemented

- `feePaid` and `rentalReturned` are already Firestore-authoritative.
- The Phase 1 pattern is consistent with the migration goal: Firestore write first, compatibility mirror second.
- The approach is narrow and low-risk, which is good because it avoids readout/result state churn.

### 1.2 The target architecture is documented

- [COMPETITOR_PHASE2_DESIGN.md](./COMPETITOR_PHASE2_DESIGN.md) defines a clean Phase 2 scope.
- [COMPETITOR_READOUT_ARCHITECTURE.md](./COMPETITOR_READOUT_ARCHITECTURE.md) defines the broader authority model and the expected Firestore-first behavior.
- [P0_RESOLUTION_PLAN.md](./P0_RESOLUTION_PLAN.md) establishes the required authority and role boundaries.

### 1.3 The main migration principle is understood

The project explicitly accepts the rule that:

- Firestore is canonical for migrated competitor data
- Express/seasonDb is temporary compatibility-only state
- older snapshot and JSON export paths must not overwrite newer Firestore values

This is the correct direction and is required before any real cutover.

## 2. What still blocks implementation

### Blocker 1: legacy competitor write paths remain active

Status: unresolved

Evidence:

- [COMPETITOR_CUTOVER_PREREQUISITES.md](./COMPETITOR_CUTOVER_PREREQUISITES.md) identifies active routes and functions in [server.ts](./server.ts) and [src/App.tsx](./src/App.tsx) that still mutate competitors through legacy state.

Relevant paths:

- `POST /api/competitors`
- `PUT /api/competitors/:id`
- `DELETE /api/competitors/:id`
- `POST /api/readout`
- `POST /api/online-punch`
- `syncFullSeasonToFirestore`
- `cloud-export`
- `cloud-hydrate`
- state snapshot replay

Unresolved questions:

- Which routes are still live in production and which are only used in local/debug mode?
- Which actors still call the legacy competitor APIs today?
- Who owns the final enforcement of “legacy writes are disabled”?
- Which compatibility mirror writes are still necessary after cutover?

Risk level: Critical

Recommendation:

- Disable or route all legacy competitor mutation routes through a trusted backend before implementing any additional Firestore competitor mutations.
- Treat legacy `seasonDb` as read-only after the authority boundary is enforced.

### Blocker 2: stale snapshot overwrite risk is not resolved

Status: unresolved

Evidence:

- [COMPETITOR_CUTOVER_PREREQUISITES.md](./COMPETITOR_CUTOVER_PREREQUISITES.md) names `syncFullSeasonToFirestore`, snapshot hydration, and Express state synchronization as stale-write sources.
- [CUTOVER_CHECKLIST.md](./CUTOVER_CHECKLIST.md) marks these as requirements, not completed items.

Unresolved questions:

- Which snapshot flows are still allowed to write after a Firestore-first competitor mutation exists?
- What exact stale-write guard is required to reject older snapshots?
- How will the system handle a competing Firestore update and a stale snapshot arriving in the same time window?
- Is there a monotonic timestamp/version mechanism already available for all competitor writes?

Risk level: Critical

Recommendation:

- Add a strict guarded-write policy: snapshot writes are ignored or rejected when the snapshot is older than Firestore state.
- Keep snapshot-based writes out of the competitor authority path until the guard is proven in test.

### Blocker 3: authority model is defined but not fully deployed

Status: partially defined, not complete

Evidence:

- [P0_RESOLUTION_PLAN.md](./P0_RESOLUTION_PLAN.md) defines the ideal backend execution boundary.
- [CUTOVER_CHECKLIST.md](./CUTOVER_CHECKLIST.md) lists the authority and Firestore rule gates as not started.

Unresolved questions:

- Are the real production backend and admin SDK already in place for privileged competitor write actions?
- Are Firestore rules already enforced in the deployed environment, or only in source files?
- Which deletions or writes require admin-only trust beyond the browser?

Risk level: High

Recommendation:

- Before implementation, verify that the trusted backend and rule enforcement are actually deployed and tested, not merely designed.
- The design is right; the operational deployment is the missing part.

### Blocker 4: delete and retirement policy is not fully operationalized

Status: designed, not implemented

Evidence:

- [COMPETITOR_PHASE2_DESIGN.md](./COMPETITOR_PHASE2_DESIGN.md) explicitly requires retire/tombstone before hard delete.
- [COMPETITOR_CUTOVER_PREREQUISITES.md](./COMPETITOR_CUTOVER_PREREQUISITES.md) calls out deletion requirements as P0.

Unresolved questions:

- What counts as a valid historical dependency for a competitor deletion?
- Which receipts and punches are required to preserve for audit/history?
- How is a retired competitor distinguished from a deleted competitor in the UI and API?

Risk level: High

Recommendation:

- Do not allow hard delete in Phase 2 until retention and historical dependency checks are in place.
- Default to retire/tombstone for the first implementation slice.

### Blocker 5: SI ownership model is designed but not yet implemented and tested

Status: designed, not validated

Evidence:

- [COMPETITOR_PHASE2_DESIGN.md](./COMPETITOR_PHASE2_DESIGN.md) defines the `siCardAssignments` collection and transaction flow.
- [P0_RESOLUTION_PLAN.md](./P0_RESOLUTION_PLAN.md) already calls out the SI assignment as an atomic requirement.

Unresolved questions:

- Is the current data model already compatible with a `siCardAssignments/{siNumber}` structure?
- Are there existing competitor records with duplicate or conflicting SI data already in the dataset?
- What is the reconciliation path for existing historical duplicates?

Risk level: High

Recommendation:

- Keep SI ownership as a controlled Phase 2 item, but do not begin it until historical SI duplicates are inventoried and a conflict policy is confirmed.

### Blocker 6: the project is still mixed-authority in several critical code paths

Status: unresolved

Evidence:

- [COMPETITOR_CUTOVER_PREREQUISITES.md](./COMPETITOR_CUTOVER_PREREQUISITES.md) explicitly warns that `App.tsx` and `server.ts` still have mixed-authority flows.
- `onUpdateCompetitor` still includes both Express and Firestore logic in the design notes.

Unresolved questions:

- Which path is actually selected by default in the app when a user edits competitor data?
- Is the current implementation still dual-write or partial-write in the same request cycle?
- Which code path does the live user experience actually take?

Risk level: Critical

Recommendation:

- The system must be made single-authority before Phase 2 implementation begins.
- Do not start competitor CRUD migration while the app can still call both fire-and-forget legacy routes and Firestore in the same flow.

## 3. What can be implemented safely first

The following is safe to do before full cutover, provided it does not expand the authority boundary:

### Safe-first items

- De-risking and documentation cleanup around the Phase 2 scope
- Firestore schema design for competitor admin fields only
- SI assignment model scaffolding, as long as it is not yet active in production paths
- Rule definitions in source for the Phase 2 field set
- Non-authoritative compatibility-mirror protections
- Read-only inventory and audit tooling for competitor and SI state
- Explicit stale-write detection and logging without enabling mutation rejection logic yet

These are safe because they do not create a new authoritative writer or change how the live app persists competitors.

## 4. What absolutely must wait

These must wait until the project is no longer mixed-authority:

- any Phase 2 create competitor code path
- any Phase 2 update competitor code path
- any Phase 2 retire/delete competitor path
- any SI assignment write path affecting live competitor data
- any `syncFullSeasonToFirestore` or snapshot write that touches existing competitor docs
- readout authority
- online-punch authority
- live-event migration
- WebSocket replacement

These are not merely “later features”; they are the actual migration blockers for the safe cutover.

## 5. Readiness assessment by category

### Design readiness

Status: ready enough to proceed with design, but not implementation.

Why:

- The architecture and migration scope are documented clearly.
- The team has a clear target ownership model and field list.

### Operational readiness

Status: not ready.

Why:

- Legacy writes remain active.
- Snapshot/replay stale-writer protections are not yet enforced.
- Existing mixed-authority code paths still exist.

### Safety readiness

Status: not ready.

Why:

- There is insufficient evidence that stale snapshot writes are blocked.
- There is no completed proof of a controlled rollback path for competitor CRUD changes.

## 6. Final verdict

RED

### Why RED

The project is not yet ready to begin Competitor Phase 2 implementation because:

1. Legacy competitor mutation paths remain active.
2. Snapshot and full-season sync flows still present stale-write risks.
3. Mixed-authority code paths still exist in the app and server.
4. Deletion/retirement policy is documented but not deployed and validated.
5. SI assignment rules, duplicate protection, and conflict handling are not proven in the actual deployed environment.
6. The required cutover checklist is still mostly uncompleted.

This is not a “small gap” issue. It is an authority conflict issue. Without solving the stale-write and single-writer boundaries first, Competitor Phase 2 implementation would produce data loss risk and silent drift between Firestore and `seasonDb`.

## 7. Recommendation

Do not begin Competitor Phase 2 implementation yet.

Recommended order:

1. Remove or fence all legacy competitor/write paths from `server.ts` and UI flows.
2. Enforce stale snapshot rejection for competitor documents.
3. Verify single-authority behavior in the app and server.
4. Validate SI assignment conflict handling using real test data.
5. Retire/tombstone deletion behavior before enabling hard delete functions.
6. Only then proceed with the controlled Phase 2 implementation.

Until those gates are closed, implementation should be paused or limited to documentation-safe, non-authoritative work only.
