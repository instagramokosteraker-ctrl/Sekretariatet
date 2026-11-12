# Server-Side Enforcement Roadmap

## Decision

Proceed with the existing-backend server-side enforcement model.

This is the lowest-risk, lowest-cost, most evidence-based path because the repository already contains a transaction-boundary pattern and assignment-aware mutation enforcement in [src/firebase.ts](./src/firebase.ts) and [server.ts](./server.ts). The Firestore Rules path is structurally over-constrained and has already failed the emulator suite despite repeated optimizations.

## 1) Firestore Rules checks that should remain

The remaining Firestore Rules checks should be deliberately limited to cheap, boundary-oriented authorization and shape guards.

### Must remain in Rules

- `request.auth.uid` existence and signed-in state
- call-site role checks for coarse admin/official-role gates
- path validity and ID validity
- path-to-document identity equality (`incoming().competitionId == competitionId`, etc.)
- basic field presence or conservative type checks only where local and cheap
- lightweight owner checks for direct-owner write flows
- minimal status gating that does not require multi-document reads

### Must not remain in Rules

The following are too expensive and belong in server-side transaction validation:

- assignment parity checks
- competitor/assignment consistency validation
- RunnerDb identity matching
- readout receipt provenance
- cross-document consistency checks
- any validation requiring `getAfter()`, `existsAfter()`, or repeated document reads to compare multiple documents in one request

The current emulator failures confirmed that this exact combination overflows the 1,000-expression ceiling.

## 2) Cross-document checks that move to server-side transactions

The following validations should move from Firestore Rules to the server-side transaction layer:

### A. Assignment parity

- active assignment exists for the intended SI
- assignment `competitionId` equals the competitor competition
- assignment `siNumber` equals the competitor SI
- assignment `cardSeries` equals the competitor card series
- assignment `ownerUid` equals the competitor owner
- `competitorDocumentId` equals the competitor document ID
- reassignment and retirement transitions preserve the assignment lifecycle contract

This is already aligned with the implemented logic in [src/firebase.ts](./src/firebase.ts), especially `runAtomicSIAssignmentMutation` and its helper validation flow.

### B. Competitor/assignment consistency

- no competitor write without the matching assignment mutation
- no assignment mutation without matching competitor state change
- retired/current assignment states must be validated before commit
- mismatch, conflict, or version failure aborts the transaction

### C. RunnerDb identity validation

- read `runnerDb/{siNumber}` in the transaction
- compare `fullName`, `club`, and `cardSeries`
- preserve the `Klubblös` special case and event-specific exceptions
- reject mismatch before commit

### D. Receipt provenance

- read the readout receipt by ID
- confirm `status == 'PROCESSED'`
- confirm receipt `competitorId`, `siNumber`, and `cardSeries` match the attempted write
- confirm owner or caller policy matches the current request

### E. Ownership consistency

- caller permission is allowed by Rules
- server-side transaction verifies data-level ownership consistency, not just request.auth
- sequence/order of writes guarantees no silent owner or card transfer

## 3) Files, functions, routes, and transaction boundaries to modify

### Files to modify

1. [firestore.rules](./firestore.rules)
   - reduce to a thin authorization layer
   - remove complex cross-document checks from the competitor create/update path
   - simplify the `allow create` and `allow update` logic for competitors and the readout flow

2. [src/firebase.ts](./src/firebase.ts)
   - keep and harden the existing transaction boundary
   - ensure `runAtomicSIAssignmentMutation` is the canonical enforcement point
   - add or centralize the server-side validation pipeline for competitor assignment, receipt, and RunnerDb checks

3. [server.ts](./server.ts)
   - route-level mutation orchestration and server-side enforcement entry points
   - ensure the Express API passes through the server-side validation boundary instead of relying on complex Rules-only checks

4. [src/utils/siAssignmentDiagnostics.ts](./src/utils/siAssignmentDiagnostics.ts)
   - keep as the mutation-tracing and validation diagnostic layer
   - update declarations to reflect the new enforcement boundary and ensure the legacy path is clearly marked

5. [src/utils/siAssignmentPreview.ts](./src/utils/siAssignmentPreview.ts)
   - maintain preview/diagnostic intent tracking for assignment-aware mutations

6. [src/utils/siCardAssignments.ts](./src/utils/siCardAssignments.ts)
   - ensure the transaction code and assignment parsing remain consistent with the server-side enforcement model

### Functions to modify

- `runAtomicSIAssignmentMutation(...)` in [src/firebase.ts](./src/firebase.ts)
- `declareCompetitorMutation(...)` in [src/utils/siAssignmentDiagnostics.ts](./src/utils/siAssignmentDiagnostics.ts)
- `runCompetitorMutation(...)` and `runCompetitorMutations(...)` in [src/utils/siAssignmentDiagnostics.ts](./src/utils/siAssignmentDiagnostics.ts)
- server mutation entry points in [server.ts](./server.ts) that orchestrate readout/competitor writes
- any helper that validates readout receipt and RunnerDb identity from the existing readout flow

### Routes affected

The affected call sites are the ones tied to participant write flow and readout creation:

- `/api/readout` in [server.ts](./server.ts)
- readout creation and auto-create paths in the backend mutation flow
- direct competitor mutation flows in the server-side transaction utilities
- any admin or import-driven competitor write path that updates SI assignment state

### Transaction boundaries affected

The relevant transaction boundaries are:

- competitor create + active assignment create
- competitor identity update + assignment reassignment
- competitor retirement + assignment retire
- readout receipt + competitor + assignment creation
- any server-side write sequence that changes SI owner/card identity

## 4) Implementation phases

### Phase 1 — Narrow Rules + server-side enforcement boundary

Goal:

- strip the heavy cross-document logic from Firestore Rules
- keep Rules only for auth/path/basic safety
- keep the existing transaction flow as the enforcement point

Files:

- [firestore.rules](./firestore.rules)
- [src/firebase.ts](./src/firebase.ts)
- [server.ts](./server.ts)

Effort:

- Low to medium

Risk:

- Medium

Rollback strategy:

- keep the current rules branch available and restore the existing rules file from git if a transaction-level validation fails
- keep the transaction boundary isolated behind a feature flag or code branch if needed

### Phase 2 — Move receipt and RunnerDb checks into server-side transaction

Goal:

- enforce readout receipt provenance and RunnerDb identity in a transaction
- remove those checks from Rules

Files:

- [src/firebase.ts](./src/firebase.ts)
- server-side readout code in [server.ts](./server.ts)

Effort:

- Medium

Risk:

- Medium

Rollback strategy:

- temporarily re-enable the old Rules-based checks only for the readout path if an emergency rollback is required
- preserve the readout receipt validation in a single helper so it can be restored easily

### Phase 3 — Harden assignment and competitor boundary

Goal:

- ensure every identity-affecting mutation goes through the atomic assignment-aware transaction boundary
- reject any legacy or direct mutation path

Files:

- [src/firebase.ts](./src/firebase.ts)
- [src/utils/siAssignmentDiagnostics.ts](./src/utils/siAssignmentDiagnostics.ts)
- [server.ts](./server.ts)

Effort:

- Medium

Risk:

- Low to medium

Rollback strategy:

- keep a defensive fallback to the current transaction guard and disable legacy mutation paths behind a temporary gate if a conflict emerges

### Phase 4 — Rules regression and readiness recheck

Goal:

- re-run the Firestore Rules suite
- confirm the competitor create/update path is no longer over the expression limit
- verify readiness status with the updated architecture

Files:

- [firestore.rules](./firestore.rules)
- [firestore.rules.test.ts](./firestore.rules.test.ts)
- readiness documents

Effort:

- Medium

Risk:

- Low if the transaction boundary is correct, medium if the remaining rules logic is still too heavy

Rollback strategy:

- revert the Rules simplification only, not the transaction enforcement, if the suite still fails and the issue is limited to the Rules layer

## 5) Rollback and safety strategy

For every phase:

- maintain a clean git baseline of the rules file and server mutation file
- isolate change by function and route rather than rewriting broad areas at once
- retain a transaction-safe fallback in the backend for critical writes
- stop the rollout if the readout or assignment path becomes non-atomic

## 6) Readiness assessment update

The readiness status should be updated as follows:

- The blocker is no longer “Rules are too complex to optimize” in the abstract.
- The blocker becomes: “Rules must be reduced to a thin policy layer and server-side transaction enforcement must be fully wired into the write path.”

This changes the readiness posture from a rules-only optimization problem to a boundary-architecture migration.

### First implementation phase

The first phase should be Phase 1: Narrow Rules + transaction boundary.

Why this is the first phase:

- it addresses the root cause directly
- it has the lowest deployment risk compared with a new backend environment
- it preserves the current transaction infrastructure already in the repo
- it immediately reduces the expression pressure without waiting for broader platform changes

This is the recommended first action before any further rules optimization or infrastructure work.

## 7) Final recommendation

Proceed with the existing-backend server-side enforcement model.

The first implementation phase is:

- reduce Firestore Rules to a minimal policy layer
- keep the transaction boundary in the existing Express/backend code as the enforcement point
- remove the expensive cross-document checks from Rules and validate them server-side

This is the correct path to remove the current expression-limit blocker while preserving the system's Atomic SI Matching and ownership guarantees.
