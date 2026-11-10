# Readout Auto-Create Migration Plan

Status: Design baseline; implemented in [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md).

The current-flow sections below describe the pre-migration implementation.

## Executive summary

`POST /api/readout` currently contains a legacy auto-create path that can create a new competitor identity from `runnerDb` when a readout arrives for an SI number that is not already present in the active event. That path is not routed through the Firestore-authoritative competitor/assignment flow and does not create or validate a canonical SI assignment record. In its current state, it can bypass Atomic SI Matching, competitor ownership rules, assignment uniqueness guarantees, and the Firestore transaction boundary.

This is a P0 blocker and should be treated as a hard migration requirement before any GO decision for competitor ownership cutover.

## Current execution chain for `POST /api/readout`

### 1. Readout enters the online punch pipeline

The readout route is handled in `server.ts` via the shared online punch processor.

Relevant current behavior from `processOnlinePunchForEvent(...)`:

- It finds a runner by matching the incoming SI number against `ev.competitors`.
- If no active runner is found, it looks for a match in `seasonDb.runnerDb`.
- If a runnerDb match exists and `seasonDb.eventor.autoCreateFromRunnerDbOnReadout` is enabled, it synthesizes a `Competitor` object in memory.

### 2. Unknown competitor creation trigger

The creation branch is:

- `const dbMatch = seasonDb.runnerDb.find((r) => r.siNumber === params.siNumber) ?? null`
- `if (!runner && dbMatch && seasonDb.eventor.autoCreateFromRunnerDbOnReadout)`
- Then it creates a record like:
  - `id: cmp-<timestamp>-<random>`
  - `bib: maxBib + 1`
  - `fullName: dbMatch.fullName`
  - `club: dbMatch.club`
  - `classId: preferredCls?.id ?? 'cls-open'`
  - `siNumber: params.siNumber`
  - `cardSeries: dbMatch.cardSeries`
  - `status: 'REGISTERED'`

This new competitor is then inserted into the active event with:

- `ev.competitors.unshift(autoCreatedRunner)`

### 3. Mutation boundary used by the legacy path

The legacy auto-create is wrapped in a mutation diagnostic helper:

- `runCompetitorMutation({
    source: 'cloud readout auto-create from runner database',
    operation: 'CREATE',
    competitionId: ev.competition.id,
    competitorId: autoCreatedRunner.id,
    siNumber: autoCreatedRunner.siNumber,
    assignmentHandling: {
      mode: 'LEGACY',
      reason: 'Legacy readout flow creates a competitor from runnerDb without creating an SI assignment.'
    },
    identityAffecting: true,
  }, () => ev.competitors.unshift(autoCreatedRunner))`

This is the key signal: the path is intentionally treated as a legacy flow and is not writing the assignment contract. It only emits diagnostics and then performs the write.

### 4. SI ownership assignment behavior

The current flow does not do any of the following:

- create a Firestore document under `competitions/{competitionId}/siCardAssignments/{siNumber}`
- check whether the requested SI number is already assigned to another competitor
- activate or retire an assignment record
- validate that the card is active and belongs to the competing entity
- enforce uniqueness or conflict resolution

The SI is only used as a matching key in the local event and runnerDb. It is not bound to a canonical assignment record during readout creation.

### 5. Competitor identity generation behavior

The competitor identity is generated locally in-process:

- `id: cmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

This creates a new competitor identity without a synchronized ownership transaction or assignment record. There is no unique canonical source of truth ensuring that the generated record is consistent with Firestore or assignment state.

### 6. runnerDb / seasonDb mutation behavior

The route does not directly mutate `seasonDb.runnerDb` in the auto-create branch itself, but it does mutate the in-memory active event state and then persists the season database:

- existing event competitor list is mutated in memory
- the result is persisted via the server persistence lifecycle (`saveSeasonDatabase(...)` / `persistUserMutation`)
- websockets broadcast the updated state to clients

This means the auto-created competitor becomes part of the season snapshot and is treated as a persisted local data object, even though the assignment contract was never created.

## Current flow diagram

```text
POST /api/readout
  -> processOnlinePunchForEvent(...)
      -> find by ev.competitors.siNumber
      -> if not found: lookup seasonDb.runnerDb by siNumber
      -> if autoCreateFromRunnerDbOnReadout is enabled
          -> synthesize new Competitor object
          -> runCompetitorMutation(... mode: LEGACY ...)
          -> ev.competitors.unshift(autoCreatedRunner)
          -> persistUserMutation/saveSeasonDatabase()
          -> broadcastFullState()
      -> continue readout event creation / status updates
```

## Data ownership map

| Component | Current role | Authority model | Notes |
|---|---|---|---|
| `seasonDb.runnerDb` | Legacy runner directory | LEGACY / compatibility lookup | Used as an identity source for auto-create fallback |
| `ev.competitors` | Active event competitor list | LEGACY / local event source | Mutable in-memory list for current competition |
| Firestore `competitors/*` | Intended canonical competitor records | AUTHORITATIVE target | Must be the canonical identity owner after migration |
| Firestore `competitions/{competitionId}/siCardAssignments/{siNumber}` | Intended canonical SI assignment ownership | AUTHORITATIVE target | Missing in the current readout path |
| `ev.events` | Readout/event stream | LOCAL / runtime | Real-time event lineage, not identity authority |
| WebSocket state | Broadcast of local state | DISTRIBUTION only | Not a write authority |

## Write targets

The current readout auto-create branch writes to:

- `ev.competitors` (in-memory competitor list for active event)
- server-side persisted season DB (`seasonDb` via `saveSeasonDatabase`) 
- event/state broadcasts (not canonical data, but state propagation)

It does not write to:

- Firestore `competitors/*`
- Firestore `siCardAssignments/*`
- authoritative readout receipt collection

## Authority analysis

### Current authority

The route is effectively a legacy, event-local write path.

It is not authoritative because:

- it does not create the assignment record required by the Atomic SI Matching contract
- it does not validate ownership against the canonical SI assignment model
- it does not use a Firestore transaction boundary
- it does not reject duplicate SI assignments or re-use conflicts
- it only logs diagnostics without blocking the write

### Intended authority after migration

The authoritative model should be:

- competitor identity is created only via a canonical server-side transaction
- competitor creation requires an ACTIVE assignment ownership
- SI assignment ownership is created or reactivated in the same transaction
- readout acceptance is processed against the canonical competitor/assignment state

## Uniqueness risks

The current flow exposes several risks:

1. Duplicate SI creation risk
   - Two concurrent readouts for the same unknown SI can each create a new competitor if the first has not yet persisted or been assigned.

2. Duplicate competitor identity risk
   - `Date.now()` + random ID generation is not tied to canonical identity assignment and does not ensure uniqueness against Firestore state.

3. Assignment ownership drift
   - A new competitor may be inserted with an SI number that is already represented by a different competitor in the assignment space, without any check.

4. Event-local mismatch risk
   - The active event's local competitor list may diverge from the Firestore assignment source of truth because the write path never updates the assignment model.

## Race conditions

The current pattern is vulnerable to race conditions for the following reasons:

- the existence check and assignment-free creation are split across separate in-memory operations
- the path checks local event state but not the authoritative assignment collection
- it uses a non-transactional, in-process insertion into the event list
- readout processing can be concurrent across multiple connected clients or import sources

This is a classic create-then-assign pattern, but with no assignment step at all.

## Rollback implications

A legacy auto-create has poor rollback semantics:

- If a later step fails, the in-memory competitor may remain persisted to season state
- There is no compensating delete or assignment retirement transaction
- There is no durable audit that clearly identifies the competitor as auto-created from runnerDb
- It is difficult to reverse if a readout was accepted by mistake or if a later import resolves the same SI differently

The safe migration pattern is to create the competitor and assignment as a single atomic unit and then persist the readout receipt only after the identity + assignment step succeeds.

## Bypass analysis against migration guarantees

### Atomic SI Matching

Current result: YES, it bypasses Atomic SI Matching.

Reason:

- no `siCardAssignments` create or validation
- no assignment lifecycle check
- no transaction boundary to pair the identity and assignment writes

### Competitor ownership

Current result: YES, it bypasses competitor ownership guarantees.

Reason:

- competitor identity is created from runnerDb without verifying ownership in the canonical model
- the route uses legacy local state instead of authoritative competitor/assignment ownership

### Assignment uniqueness

Current result: YES, it bypasses assignment uniqueness guarantees.

Reason:

- no assignment record is created
- no duplicate detection or active-ownership check is performed

### Firestore transaction boundary

Current result: YES, it bypasses the transaction boundary.

Reason:

- the mutation exists in the legacy Express/local season state
- no Firestore transaction is used
- diagnostics are informational only and do not enforce the rule

## Target architecture

The intended architecture is:

```text
Unknown readout
  -> classify as unknown or unbound competitor
  -> Atomic competitor creation
      -> canonical competitor identity record created
      -> ownership metadata attached to same transaction
  -> Atomic SI assignment
      -> validate ACTIVE assignment or create/activate one atomically
      -> reject duplicate/malformed/retired ownership conflicts
  -> Readout persistence
      -> persist readout receipt after identity + assignment validation
      -> only then mark runner as active in the event state
```

### Target logic

1. `POST /api/readout` receives a readout for SI `N`.
2. Lookup active event competitors and authoritative assignment state.
3. If no valid competitor exists:
   - create a competitor record only through the canonical backend helper
   - require or create a valid `siCardAssignments/{N}` assignment in the same transaction
4. If the assignment is already taken, reject or route to a conflict path instead of synthesizing a local competitor.
5. Append the readout receipt only after the transaction succeeds.

## Recommended implementation phases

### Phase 0 — Disable the legacy auto-create fallback

- feature-flag the `autoCreateFromRunnerDbOnReadout` behavior
- default it off in production
- emit a warning when a readout would have auto-created a competitor
- keep legacy path only for controlled, shadow-mode diagnostics

### Phase 1 — Replace with explicit unknown-card handling

- when the SI is unknown and no valid competitor exists, emit an `UNKNOWN_CARD`/`UNRESOLVED_IDENTITY` result
- do not create a competitor in this stage
- allow later reconciliation by admin flow or import pipeline

### Phase 2 — Canonical atomic competitor creation

- add an explicit backend helper for: create competitor + assignment in one transaction
- validate competition context and assignment state before creating
- include idempotency and conflict handling

### Phase 3 — Atomic SI assignment

- create or activate the assignment record in the same transaction
- retire or reject conflicting ownership if required by policy
- guarantee uniqueness and ownership invariants before competitor persistence

### Phase 4 — Readout persistence and cleanup

- persist readout receipts after canonical identity/assignment creation succeeds
- remove any direct legacy creation path from the readout pipeline
- remove runnerDb fallback auto-create from active runtime

## Recommended migration decision

The current readout auto-create path should be treated as a hard blocker until it is replaced with a canonical atomic write path.

Recommendation: NO-GO for competitor ownership cutover while this path remains enabled.

## Final assessment

The code shows that readout auto-create can currently bypass:

- Atomic SI Matching
- competitor ownership
- assignment uniqueness guarantees
- Firestore transaction boundary

Therefore, the route is not acceptable as a production-authoritative write path. The correct migration target is to disable the legacy auto-create branch and replace it with an explicit unknown-card flow followed by atomic competitor + SI assignment creation in a single trusted backend transaction.
