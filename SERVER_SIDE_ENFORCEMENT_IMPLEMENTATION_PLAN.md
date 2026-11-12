# Server-Side Enforcement Implementation Plan

## Executive conclusion

The lowest-risk, lowest-cost path is to implement the cross-document integrity checks in the existing PasserSI backend transaction layer and leave Firestore Rules to only the cheap authorization and safety checks.

This is the correct boundary because the repository already contains the required transaction infrastructure:

- [server.ts](./server.ts) imports and uses mutation orchestration helpers such as `declareCompetitorMutation`, `runCompetitorMutation`, and `runCompetitorMutations`.
- [src/firebase.ts](./src/firebase.ts) already contains `runAtomicSIAssignmentMutation`, which performs multi-document transaction validation for assignment/competitor integrity.
- The repo already has the transaction model needed for assignment-aware competitor writes and reassignments.

This means the project does not need a brand-new backend platform to solve the current problem.

## 1) Current evidence in the repository

### Existing backend layer

From [server.ts](./server.ts):

- the app is an Express/Node server (`express` is already present)
- it already coordinates mutation flows through `declareCompetitorMutation` and `runCompetitorMutation`
- it is not a bare frontend app; it contains server-side mutation orchestration and data processing logic

From [src/firebase.ts](./src/firebase.ts):

- `runAtomicSIAssignmentMutation(...)` is already implemented
- it reads assignment and competitor docs in a transaction
- it checks duplicate candidate conflicts, assignment state, reassignment conditions, and assignment/competitor consistency
- it is designed to fail closed when the integrity contract is violated

This is strong evidence that the core server-side transaction model already exists and is already used for the canonical SI assignment enforcement.

### Why Rules are the problem

The recorded emulator failures and architecture reviews consistently show the same pattern:

- competitor create/update path is too large
- it combines schema validation, role checks, owner checks, SI assignment parity, RunnerDb checks, and receipt provenance in the same request
- the problem is not a single field or bug; it is the aggregate complexity of the path

The architectural conclusion from [COMPETITOR_RULE_ARCHITECTURE_REVIEW.md](./COMPETITOR_RULE_ARCHITECTURE_REVIEW.md) and [FIRESTORE_RULES_ARCHITECTURE_ASSESSMENT.md](./FIRESTORE_RULES_ARCHITECTURE_ASSESSMENT.md) is effectively: Firestore Rules are too small for the full business-integrity workload on the competitor path.

## 2) What should stay in Firestore Rules

Rules should remain narrow and cheap. Keep only the following:

- authentication presence
- caller is signed in
- path and ID validity
- role checks for coarse authorization
- basic structural checks that are safe and local
- immutability or owner checks that do not require cross-document reads
- a minimal document shape guard if still desirable

Examples:

- `isVerifiedUser()`
- `isValidId(...)`
- `incoming().competitionId == competitionId`
- `incoming().ownerUid == request.auth.uid` for direct-owner paths
- cheap role gates such as admin/super-admin and basic official-role checks

These are appropriate for Rules because they are simple policy checks and do not require deep business validation.

## 3) What should move to server-side transactions

The following must move out of Rules and into the existing Firestore transaction layer:

### Assignment parity

This includes:

- active assignment exists for the target SI
- assignment `competitionId` matches the competitor
- assignment `siNumber` matches the competitor
- assignment `cardSeries` matches the competitor
- assignment `ownerUid` matches the competitor
- `competitorDocumentId` is consistent with the competitor document
- reassignment is valid and conflict-free
- retired-active transitions preserve the canonical contract

This is already the exact type of logic implemented in [src/firebase.ts](./src/firebase.ts) under `runAtomicSIAssignmentMutation`.

### Competitor/assignment consistency

This includes:

- the competitor write must be paired with the matching assignment write
- the assignment must be updated or retired in the same transaction as the competitor mutation
- mutation outcomes must be fail-closed on mismatch or conflict
- no standalone assignment mutation path is allowed to bypass the transaction guard

This is already consistent with the hardening work described in [ASSIGNMENT_BOUNDARY_HARDENING.md](./ASSIGNMENT_BOUNDARY_HARDENING.md).

### RunnerDb identity validation

The competitor readout path currently performs cross-document identity checks against the RunnerDb entry. That logic should not remain in Rules.

Server-side transaction logic should:

- read the RunnerDb document for the SI number
- compare `fullName`, `club`, and `cardSeries`
- apply the existing `Klubblös` exception and any event-specific policy
- reject a write if the values do not line up

This is exactly the sort of expensive multi-document validation that pushes Rules over the expression ceiling.

### Receipt provenance

The readout flow requires a processed receipt and requires the receipt to match the competitor being created or updated.

This should be enforced server-side:

- read the receipt by ID
- verify status is `PROCESSED`
- verify `receipt.competitorId` matches the target competitor
- verify `receipt.siNumber` and `receipt.cardSeries` match
- verify owner or event semantics are valid
- only then commit the competitor/assignment mutation

This is integral business logic, not a simple permission check.

### Ownership consistency

Rules can check that the caller is allowed to attempt the mutation. The transaction must then verify the actual owner consistency of the documents being mutated.

That includes:

- assignment owner matches competitor owner
- new assignment or reassignment does not silently transfer a card to a different owner
- post-write consistency is validated before commit

This preserves the ownership guarantee without forcing the whole cross-document proof into the Rules engine.

## 4) Existing infrastructure assessment

### Option 1: Implement in the existing Express backend only

This is the clear low-risk option.

Why it works:

- [server.ts](./server.ts) already runs an Express server and imports mutation orchestration helpers
- [src/firebase.ts](./src/firebase.ts) already contains transaction-aware assignment logic
- the transaction model is already established
- the workflow does not require a second platform or a new deployment target

Implementation effort:

- Low to medium
- mainly code reorganization and wiring, not a greenfield service

Operational complexity:

- Low
- no separate infra or runtime management required beyond the current backend service

Ongoing cost:

- Very low
- no new pay-per-request service required

Effect on readiness:

- Strong positive
- this directly removes the Rules bottleneck while preserving the current integrity model

### Option 2: Add Cloud Functions / Cloud Run / another backend service

This is possible but not required.

Use-case:

- only if the current app server is not the deployed backend or is not allowed to own the mutation boundary

Implementation effort:

- Medium to high
- requires deployment wiring, auth/config, CI, and environment setup

Operational complexity:

- Medium to high
- extra runtime, observability, and deployment concerns

Ongoing cost:

- Medium
- pay-per-invocation or always-on runtime cost depending on setup

Effect on readiness:

- Positive, but higher deployment and operational risk

### Option 3: Continue optimizing Firestore Rules

This is the least recommended path.

Why it is weak:

- the repo has already had repeated rule simplifications
- the emulator still reports over-limit failures on the competitor path
- the path has multiple required business invariants, so it remains structurally expensive

Implementation effort:

- Medium in the short term
- but eventually diminishing returns

Operational complexity:

- Low
- but it keeps the wrong architecture in place

Ongoing cost:

- Low in direct cost, but high in engineering churn and uncertain payoff

Effect on readiness:

- Weak; still blocked by the same structural issue

## 5) Additional infrastructure required?

### A. Can this be implemented using existing infrastructure only?

Yes, under the current repository structure and backend architecture, it can be implemented using the existing Express backend and the current Firestore transaction utilities.

This does not mean it is a no-op. It means the required backend capability already exists in the project and is the correct place to enforce the expensive integrity checks.

### B. If not, what additional service is required and what is the expected cost?

Not required for this repo as currently structured.

A new service would only be needed if the current Node/Express backend cannot host the mutation boundary in the actual deployment environment. In that case, a lightweight Cloud Run service or Firebase Function would be the likely fallback. The expected cost would be moderate, but it is not the lowest-risk option and is not required by the repository evidence.

### C. Which option is recommended?

Recommended option: implement server-side enforcement in the existing backend.

This is the best fit because it:

- uses the architecture already present in the repo
- preserves current business invariants
- removes Firestore Rules expression pressure
- keeps deployment risk lower than introducing a new service
- aligns with the repository's transaction model and the already-implemented `runAtomicSIAssignmentMutation` path

## 6) Minimal implementation shape

The implementation should be a narrow boundary change, not a rewrite.

### Rules layer

Keep only:

- auth and coarse permission checks
- path validation
- minimal, local schema sanity
- simple status gating

### Backend layer

Add or consolidate a server-side validation pipeline in the current transaction boundary to enforce:

1. current competitor field validity
2. current assignment parity
3. receipt provenance
4. RunnerDb identity
5. lifecycle and owner consistency
6. atomic commit across competitor + assignment + receipt

This must be transactional and fail closed.

## 7) Recommendation

Recommended final direction:

- implement server-side enforcement in existing backend

Not recommended:

- continue optimizing Firestore Rules
- introduce new backend infrastructure unless deployment constraints require it

This is the lowest-risk, lowest-cost path with the highest probability of removing the Firestore Rules expression-limit blocker while preserving the current business guarantees.
