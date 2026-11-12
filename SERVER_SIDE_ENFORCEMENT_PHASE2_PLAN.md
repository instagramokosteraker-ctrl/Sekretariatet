# Server-side enforcement phase 2 plan

## Decision

Phase 1 is accepted: Firestore Rules should remain a thin policy gate, and the cross-document integrity checks should be enforced in the existing server-side transaction boundary.

This plan does not implement the change. It defines the exact migration path from the current Rules-heavy behavior to the backend enforcement model already supported by the repository.

## 1) Cross-document validations currently enforced in Firestore Rules

The current Rules layer is doing more than cheap authorization. The validations that need to move to the backend are:

- assignment parity
  - SI assignment exists for the target competitor
  - assignment `competitionId`, `siNumber`, `cardSeries`, and `ownerUid` match the competitor
  - competitor and assignment document IDs are aligned
  - reassignment and retirement transitions preserve the assignment contract
- ownership consistency
  - caller ownership matches the document owner for direct-owner writes
  - mutation is only valid when owner and assignment context agree
- RunnerDb identity validation
  - `runnerDb/{siNumber}` must match the competitor identity used in the mutation
- receipt provenance
  - readout receipt must represent the same SI, card series, and event context as the write
- competitor/assignment consistency
  - a competitor write and its assignment write must be coherent in the same transaction
  - mismatched or duplicate assignment outcomes must fail closed

These are all multi-document invariants. They are too expensive for the Firestore Rules expression budget and belong in the server-side transaction layer.

## 2) Exact backend enforcement points

### A. `src/firebase.ts`

This file is the primary enforcement boundary.

Core enforcement functions:

- `runAtomicSIAssignmentMutation(...)`
  - canonical write transaction for SI assignment/competitor integrity
  - reads the competition, competitor, and relevant assignment documents in one transaction
  - validates current SI, target SI, assignment state, duplicate candidates, and identity parity
  - fail-closes on invalid assignment state, conflict, or malformed assignment data

Write paths that already route through this boundary:

- `updateCompetitorInFirestore(...)`
- `deleteCompetitorFromFirestore(...)`
- `retireCompetitorInFirestore(...)`
- `submitReadoutToFirestore(...)` (auto-create path)
- `saveDirectCompetitionEntryToFirestore(...)`

These are the exact backend transaction points that should own the cross-document checks.

### B. `server.ts`

This file is the route-level orchestration boundary for the app server.

Relevant routes and responsibilities:

- `/api/readout` → request validation and readout mutation orchestration
- `/api/competitors` and `/api/competitors/:id` → direct competitor mutation routes
- system/admin endpoints that trigger competitor lifecycle work

These routes must continue to gate coarse authorization in the server layer, but they should call the transaction-aware backend functions rather than relying on Rules to enforce deep integrity.

### C. Atomic SI Matching transaction layer

This is the actual canonical transaction model that should hold the invariants:

- competition + competitor read
- current assignment read and target assignment read
- owner / SI / cardSeries parity validation
- duplicate conflict detection
- atomic write of competitor + assignment together
- abort on any mismatch or partial result

This is the correct place to preserve Atomic SI Matching and Assignment Boundary Hardening.

## 3) Migration table: RULE CHECK → TARGET BACKEND FUNCTION

| RULE CHECK | TARGET BACKEND FUNCTION | Rationale |
|---|---|---|
| assignment parity | `runAtomicSIAssignmentMutation(...)` in `src/firebase.ts` | Reads the competitor and relevant assignment(s) together and validates the canonical SI mapping inside a transaction. |
| ownership consistency | `updateCompetitorInFirestore(...)`, `deleteCompetitorFromFirestore(...)`, `retireCompetitorInFirestore(...)`, `saveDirectCompetitionEntryToFirestore(...)` | Performs ownership and mutation-scope checks before committing paired writes. |
| RunnerDb identity validation | `submitReadoutToFirestore(...)` and the `runAtomicSIAssignmentMutation(...)` validation pipeline | Validates the SI record against `runnerDb/{siNumber}` in the same write flow. |
| receipt provenance | `submitReadoutToFirestore(...)` | Reads and validates the readout receipt and ensures it matches the write payload and assignment state. |
| competitor/assignment consistency | `runAtomicSIAssignmentMutation(...)` + `saveDirectCompetitionEntryToFirestore(...)` + `updateCompetitorInFirestore(...)` | Ensures competitor mutations and assignment mutations are written together and fail as a unit. |
| direct-owner auth gate | `server.ts` request handlers + `getCurrentFirebaseRoles()` | Keeps the public-facing auth check at the server boundary but not deep assignment business logic. |
| path / ID / shape sanity | `firestore.rules` (thin local layer only) | Keep only cheap local validation in Rules. |

## 4) Files, functions, and transaction boundaries to change

### Files to change

1. `firestore.rules`
   - keep only authentication, path, and minimal local-shape checks
   - remove the heavy cross-document enforcement from competitor and assignment write paths

2. `src/firebase.ts`
   - strengthen the canonical transaction boundary
   - ensure the write paths that affect SI identity use `runAtomicSIAssignmentMutation(...)`
   - enforce RunnerDb and receipt validation inside the transaction boundary

3. `server.ts`
   - route-level server auth and mutation orchestration
   - call the server-side transaction-aware functions for create/update/delete/readout flows

4. `src/utils/siAssignmentDiagnostics.ts`
   - keep mutation diagnostics aligned with the new backend enforcement model
   - preserve the compatibility / audit signal but stop depending on Rules for integrity enforcement

5. `src/utils/siAssignmentPreview.ts`
   - maintain preview/intent tracking for the assignment-aware mutation flow

### Functions to change

- `runAtomicSIAssignmentMutation(...)` in `src/firebase.ts`
- `updateCompetitorInFirestore(...)` in `src/firebase.ts`
- `deleteCompetitorFromFirestore(...)` in `src/firebase.ts`
- `retireCompetitorInFirestore(...)` in `src/firebase.ts`
- `submitReadoutToFirestore(...)` in `src/firebase.ts`
- `saveDirectCompetitionEntryToFirestore(...)` in `src/firebase.ts`
- server mutation handlers in `server.ts` that create or update competitors/readouts
- diagnostics helpers in `src/utils/siAssignmentDiagnostics.ts`

### Transaction boundaries involved

1. direct competitor create + assignment create
2. competitor SI reassignment + old/new assignment update
3. competitor retirement / delete + assignment retirement
4. readout auto-create + competitor create + assignment create + receipt write
5. any server-side identity mutation that touches SI or card series

These must remain atomic and fail closed. The key design principle is: no identity-affecting write may commit without the paired assignment validation succeeding in the same transaction.

## 5) Implementation order

### Phase 2.1: finalize the backend contract

- confirm that `runAtomicSIAssignmentMutation(...)` is the one canonical enforcement point
- ensure all create/update/delete/retire write functions delegate to that boundary
- ensure no standalone assignment-write export remains authoritative

Expected result:
- one authoritative transaction flow for competitor-to-assignment identity

### Phase 2.2: move RunnerDb identity checks into the transaction flow

- validate `runnerDb/{siNumber}` inside the backend write transaction
- compare SI metadata, card series, and historical identity before commit
- reject mismatches before writing the competitor assignment pair

Expected result:
- no readout or auto-create path depends on Rules for RunnerDb identity validation

### Phase 2.3: move receipt provenance enforcement into the transaction flow

- validate receipt existence, status, and payload match in the readout write transaction
- ensure receipt writes are part of the same atomic operation when applicable
- reject replay, mismatch, or stale receipt payloads before commit

Expected result:
- readout receipt provenance is enforced by the backend, not by Firestore Rules

### Phase 2.4: enforce ownership consistency in server-side calls

- keep Rules as a coarse gate only
- verify final owner, assignment, and card-series consistency in the transactional backend path
- maintain fail-closed errors for invalid or conflicting updates

Expected result:
- no silent owner transfer or assignment drift across competitor mutations

### Phase 2.5: trim Firestore Rules to the thin policy layer

- remove heavy cross-document logic from competitor and assignment create/update rules
- leave only authentication, role, path, and minimal local validation
- preserve authorization that can be cheaply evaluated without cross-document reads

Expected result:
- the Rules file stays under expression limits while the business integrity stays in the backend

### Phase 2.6: rules regression validation

- run the emulator suite
- validate the exact competitor/create/path behaviors and readout auto-create scenarios
- confirm no return to the 1000-expression ceiling

## 6) Effort, risk, rollback strategy, readiness impact

### Estimated effort

- Low to medium for the transaction refactor itself
- Medium if the receipt/RunnerDb validation must be rewritten across multiple write paths
- Overall: targeted backend migration, not a full platform rewrite

### Implementation risk

- Medium
- primary risk is subtle behavior drift in the assignment ownership and reactivation logic
- the risk is reduced because the repo already contains the core transaction boundary and is already on the server-side model

### Rollback strategy

1. keep the current Phase 1 rules branch available in git
2. roll back only the affected server-side mutation path if a validation discrepancy is found
3. re-enable the narrowest possible Rules gate while preserving the transaction boundary change
4. keep all cross-document validation in one helper (`runAtomicSIAssignmentMutation`) so rollback is localized

### Expected readiness impact

- Positive and material
- this removes the dominant Firestore expression-limit blocker
- it aligns the architecture with the repo’s existing transaction model
- it preserves Atomic SI Matching and Assignment Boundary Hardening without pushing the entire integrity contract into Rules

This is the correct migration path for readiness improvement because it moves the business-critical checks to the only place that can safely evaluate them without an artificial Firestore Rules budget.

## 7) Recommendation

Proceed with Phase 2 using the existing backend transaction model in `src/firebase.ts` and the route orchestration in `server.ts`, not a new backend platform.

The implementation should be scoped to:

1. canonical assignment validation in `runAtomicSIAssignmentMutation(...)`
2. readout receipt provenance in `submitReadoutToFirestore(...)`
3. RunnerDb identity validation in the same transaction path
4. server-side ownership consistency checks in the mutation handlers
5. Rules cleanup to the minimal policy layer only

This is the lowest-risk, lowest-cost path to remove the Firestore Rules expression-limit blocker while preserving the integrity guarantees already required by PasserSI.
