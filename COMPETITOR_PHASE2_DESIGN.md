# Competitor Migration Phase 2 Design

Status: design only, no application-code changes.

Source material:

- [MIGRATION-STATUS.md](./MIGRATION-STATUS.md)
- [COMPETITOR_READOUT_ARCHITECTURE.md](./COMPETITOR_READOUT_ARCHITECTURE.md)
- [SEASONDB_RETIREMENT_PLAN.md](./SEASONDB_RETIREMENT_PLAN.md)
- [P0_RESOLUTION_PLAN.md](./P0_RESOLUTION_PLAN.md)
- [CUTOVER_CHECKLIST.md](./CUTOVER_CHECKLIST.md)
- [COMPETITOR_READOUT_IMPLEMENTATION_PHASES.md](./COMPETITOR_READOUT_IMPLEMENTATION_PHASES.md)

## Goal

Design Competitor Migration Phase 2 before implementation begins.

This phase is limited to:

- Competitor CRUD
- Competitor ownership
- SI-number ownership
- Deletion / retirement policy
- Firestore authority

It deliberately excludes:

- readout authority
- online punch authority
- ROC authority
- live-event migration
- WebSocket replacement

## Current state

Already Firestore-authoritative:

- clubSettings
- runnerDb
- courses
- classes
- competition metadata

Phase 1 completed:

- `feePaid`
- `rentalReturned`

Current-state note: fee/payment management has been removed from the application. This document records the historical Phase 1 boundary; only rental-card return tracking remains active.

Competitor ownership beyond those fields remains mostly in:

- `seasonDb`
- Express routes
- cloud-export
- cloud-hydrate
- state sync snapshots

The core migration principle remains unchanged: Firestore is the canonical source of truth, while Express/seasonDb remains a temporary compatibility mirror only.

---

## 1. Scope of Phase 2

### Included fields

The Phase 2 slice includes the competitor fields needed for identity, registration, and administrative ownership, but not the race-state/result fields that belong to later phases.

Canonical competitor administrative fields:

- `competitorId`
- `competitionId`
- `bib`
- `fullName`
- `club`
- `classId`
- `siNumber`
- `cardSeries`
- `isRentalCard`
- `isBorrowedCard`
- `feePaid` (Phase 1 completed)
- `rentalReturned` (Phase 1 completed)
- `allocatedStartSec`
- `ownerUid`
- `createdAt`
- `updatedAt`
- `isSelfRegistered` (if supported in the current application model)

Operational, administrative metadata that belongs to the same lifecycle boundary:

- deleted/retired state markers
- retirement reason
- tombstone metadata
- import source metadata
- last mutation metadata

### Explicitly excluded until later phases

The following fields remain outside Phase 2 scope and must not be implemented as Firestore-authoritative during this phase:

- `rawReadout`
- `validation`
- `radioSplits`
- `cardPunches`
- `status`
- `checkTimeSec`
- `startTimeSec`
- `finishTimeSec`
- `runningTimeSec`
- `manualFinishTimeSec`
- `official overrides` affecting race-state results
- `lastSeenControl`
- `lastSeenTimeSec`
- `processedClientIds`
- `readoutAtIso`
- derived standings and result computations

### Design principle

Phase 2 is not a readout migration. It is a competitor identity and ownership migration. It does not authorize the system to change race outcomes, finish state, or processed-punch correctness.

---

## 2. Ownership model

### Field ownership table

| Field | Current owner | Future owner | Migration notes | Classification |
|---|---|---|---|---|
| `competitorId` | seasonDb / Express | Firestore | Stable identity must not change across migration | Canonical |
| `competitionId` | seasonDb / Express | Firestore | Competition-scoped document path remains fixed | Canonical |
| `bib` | seasonDb / Express | Firestore | Must be unique within competition; allocation is authoritative in Firestore | Canonical |
| `fullName` | seasonDb / Express | Firestore | Editable competitor metadata | Canonical |
| `club` | seasonDb / Express | Firestore | Administrative metadata only | Canonical |
| `classId` | seasonDb / Express | Firestore | Must remain linked to the competition's class model | Canonical |
| `siNumber` | seasonDb / Express | Firestore + SI assignment doc | Uniqueness is enforced via assignment record; not from UI alone | Canonical |
| `cardSeries` | seasonDb / Express | Firestore | Metadata, not uniqueness | Canonical |
| `isRentalCard` | seasonDb / Express | Firestore | Administrative flag; low-risk, can become canonical in this phase | Canonical |
| `isBorrowedCard` | seasonDb / Express | Firestore | Must be added to Firestore schema and rules in the same migration | Canonical |
| `feePaid` | Firestore (Phase 1) | Firestore | Already migrated; preserved as canonical in Phase 2 | Canonical |
| `rentalReturned` | Firestore (Phase 1) | Firestore | Already migrated; preserved as canonical in Phase 2 | Canonical |
| `allocatedStartSec` | seasonDb / Express | Firestore | Must remain tied to competition configuration, not derived from readouts | Canonical |
| `ownerUid` | seasonDb / Express | Firestore | Debug/ownership metadata | Canonical |
| `createdAt` | seasonDb / Express | Firestore | Set on creation; not derived | Canonical |
| `updatedAt` | seasonDb / Express | Firestore | Must be monotonic on every accepted mutation | Canonical |
| `status` | seasonDb / Express | Later Firestore authority | Result-affecting race state; excluded from Phase 2 | Derived |
| `startTimeSec` | seasonDb / Express | Later Firestore authority | Derived from readout and event processing | Derived |
| `finishTimeSec` | seasonDb / Express | Later Firestore authority | Derived or official-corrected value | Derived |
| `runningTimeSec` | seasonDb / Express | Later Firestore authority | Calculated from time fields | Derived |
| `cardPunches` | seasonDb / Express | Later Firestore authority | Historical readout facts; not a competitor source of truth | Legacy |
| `rawReadout` | seasonDb / Express | Later Firestore receipts | Historical raw readout payload belongs in receipts | Legacy |
| `validation` | seasonDb / Express | Later Firestore authority | Derived from accepted receipt processing | Derived |
| `radioSplits` | seasonDb / Express | Later Firestore authority | Derived from station-punch or readout history | Derived |
| `lastSeenControl` | seasonDb / Express | Later Firestore authority | Cache-only operational field | Cache |
| `lastSeenTimeSec` | seasonDb / Express | Later Firestore authority | Cache-only operational field | Cache |
| `processedClientIds` | seasonDb / Express | Firestore tombstone or receipt model | Replace with deterministic receipts and idempotency checks | Legacy |
| `readoutAtIso` | seasonDb / Express | Firestore receipt metadata | Receipt timestamp is authoritative; competitor is a projection | Cache |

### Ownership rules

Phase 2 enforces the following rules:

1. Firestore is the canonical owner for all competitor CRUD fields in scope.
2. Express remains a compatibility mirror only for those same fields.
3. Legacy `seasonDb` snapshots must never reapply values after Firestore has accepted a newer update.
4. Derived race-state fields remain excluded and must not be written by the Phase 2 mutation paths.

---

## 3. SI-number ownership model

### Goals

- Ensure each SI number is unique within a competition.
- Prevent two clients from registering the same SI number at the same time.
- Preserve the existing competitor ID while changing SI metadata safely.
- Keep the assignment model deterministic and transaction-safe.

### Rules

1. `siNumber` is unique inside a competition.
2. `cardSeries` is metadata only; it does not turn a duplicate SI into a unique record.
3. A competitor cannot be created or updated to an SI number that already belongs to another active competitor in the same competition.
4. SI changes must be atomic: the assignment document and competitor document are updated in the same transaction.
5. If the competitor is retired or deleted, the SI assignment must be retired or removed in the same transaction after retention rules are checked.
6. Duplicate SI numbers are rejected with a deterministic conflict error; they are never silently reassigned.

### Firestore design

Use a dedicated assignment collection:

```text
competitions/{competitionId}/siCardAssignments/{siNumber}
```

Document shape:

```json
{
  "competitionId": "competition-123",
  "siNumber": 123456789,
  "cardSeries": "SIAC",
  "competitorId": "comp_abc",
  "state": "ASSIGNED",
  "assignmentVersion": 1,
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

Optional tombstone form for retired or deleted records:

```json
{
  "competitionId": "competition-123",
  "siNumber": 123456789,
  "competitorId": "comp_abc",
  "state": "RETIRED",
  "retiredAt": "timestamp",
  "retiredReason": "manual-retire",
  "assignmentVersion": 2
}
```

### Conflict handling

Conflict cases:

- Duplicate SI assignment on create
- Duplicate SI update during edit
- Concurrent create of two competitor records with the same SI
- Concurrent SI change from two different clients

Resolution:

- The transaction reads the assignment document and the target competitor doc.
- The assignment write is conditionally performed using a Firestore transaction or equivalent atomic write pattern.
- If the document exists and belongs to a different `competitorId`, rejection is returned.
- The operation is retried by the client as a bounded retry with the same request ID.

### How two clients cannot simultaneously register the same SI card

Two clients cannot simultaneously create the same SI because the write path is transaction-based and the SI assignment document is the single write lock for a logical SI. The first successful transaction wins. The second transaction sees that the assignment already exists and fails with a duplicate-SI conflict. This is deterministic and cannot be eliminated by optimistic UI state alone.

---

## 4. Competitor CRUD authority

### 4.1 Create competitor

Design:

1. Client submits create request with desired competitor metadata.
2. Backend validates role, competition, class ID, and SI uniqueness.
3. Backend creates competitor document in Firestore.
4. Backend creates SI assignment document atomically in the same transaction.
5. Backend writes audit or outbox metadata if required by the policy model.
6. Only after Firestore success is the Express compatibility mirror updated.
7. UI is marked successful only after Firestore commit completes.

Firestore write path:

```text
competitions/{competitionId}/competitors/{competitorId}
competitions/{competitionId}/siCardAssignments/{siNumber}
```

Express mirror path:

- update the legacy in-memory `seasonDb` representation only after Firestore write commits
- never treat the old mirror as the source of truth

Rollback behavior:

- If Firestore create succeeds but mirror update fails, keep Firestore as the source of truth and reconcile mirror later.
- If Firestore create fails, no competitor is created and no SI assignment is written.

### 4.2 Update competitor

Design:

- Update only fields in the Phase 2 slice.
- Do not allow writes to readout/result fields during this phase.
- Update `updatedAt` and any required version metadata.
- If SI number changes, perform assignment transfer atomically.

Firestore write path:

```text
competitions/{competitionId}/competitors/{competitorId}
competitions/{competitionId}/siCardAssignments/{oldSiNumber} -> remove or retire
competitions/{competitionId}/siCardAssignments/{newSiNumber} -> assign
```

Express mirror path:

- update the compatibility mirror after Firestore accepts the update
- mirror only the fields allowed in this slice

Rollback behavior:

- If one part of the transaction fails, the entire transaction fails and no partially updated assignment is accepted.
- If the mirror lags, the client continues by reading Firestore and not the stale snapshot.

### 4.3 Delete competitor

Design:

- Delete is not a silent hard delete during this phase.
- The normal operation is retire/tombstone, not physical deletion.
- Hard delete is allowed only after receipt, punch, and historical dependency checks pass and the competitor is no longer active.

Firestore write path:

```text
competitions/{competitionId}/competitors/{competitorId}
  -> set deleted/retired state
```

and, optionally:

```text
competitions/{competitionId}/siCardAssignments/{siNumber}
  -> state: RETIRED or remove after retention approval
```

Express mirror path:

- compatibility mirror is updated only after canonical deletion/retirement is committed

Rollback behavior:

- If a delete is rejected because historical references exist, the operation is stopped without deleting the record.
- If a hard delete is performed, it must be guarded by a retention policy and reversible via archive snapshot or retention backup.

### 4.4 Retire competitor

Design:

- Retire is the default lifecycle operation.
- Retired competitors keep their IDs and registration history but no longer participate in active race operations.
- Retired status must be consistent with a reason and timestamp.

Recommended fields:

- `retiredAt`
- `retiredReason`
- `retiredByUid`
- `isRetired`

History preservation:

- readout receipts remain intact
- station punch receipts remain intact
- historical standings remain reconstructable

Rollback behavior:

- A retirement is reversible only as a controlled lifecycle change; it must not silently delete historical records.

---

## 5. Retirement versus deletion

### When hard delete is allowed

Hard deletion is allowed only when all of the following are true:

- there are no active race references
- there are no active results or standings depending on the competitor
- no readout or punch receipt is still required for historical reconstruction
- the competition or archive retention policy has been explicitly satisfied
- the deletion has been approved by a trusted admin path

### When retire/tombstone is required

Retire/tombstone is required whenever any of these are true:

- the competitor is no longer active in the competition
- there are prior readout receipts or punches referencing the person
- there are historical standings, allocations, or import records that must remain reconstructable
- a product or audit requirement demands indelible history retention

### Retention rules relevant to Phase 2

Retirement is the default policy for competitor removal because the system still has:

- readout receipts
- station-punch receipts
- historical results
- archive and duplicate-protection constraints

This prevents the migration from accidentally deleting data that is still needed for replay, audit, or later readout authority.

---

## 6. Protection from stale snapshots

The following legacy paths are dangerous because they can overwrite newer Firestore values with older snapshots or legacy state:

- `cloud-export`
- `cloud-hydrate`
- `syncFullSeasonToFirestore`
- `state:sync`
- Express JSON restore/snapshot replay

### Exact protection strategy

1. Treat all snapshot-driven competitor imports as read-only for migrated competitor fields.
2. Add a monotonic compare-and-swap check on competitor updates:
   - if snapshot `updatedAt` < Firestore `updatedAt`, ignore the snapshot update
   - if snapshot `updatedAt` == Firestore `updatedAt`, accept only if same payload hash or explicit idempotent write
   - if snapshot `updatedAt` > Firestore `updatedAt` and the system is in a migration-safe mode, only allow it through a trusted admin override and explicit audit log
3. For Phase 2, `syncFullSeasonToFirestore` must only create missing competitor documents or seed a missing Firestore document; it must not update existing Firestore-owned competitor fields unless a migration-only override is explicitly approved.
4. `cloud-export` and `cloud-hydrate` must not be allowed to overwrite canonical competitor documents during this phase.
5. `state:sync` must ignore competitor changes from legacy state when the Firestore document is newer.
6. Express compatibility mirrors can be updated only after Firestore success; they must never be used to write authoritative competitor state.

### Required guard rule

No path may write a competitor document if:

- the source is a legacy snapshot,
- the source is an older server export,
- the source does not have an explicit migration authorization token.

This is mandatory before Phase 2 can be cut over.

---

## 7. Validation plan

The Phase 2 validation plan must be explicit and should be run with both unit-level and integration-level coverage.

### 7.1 Create competitor

Validation:

- Create competitor with valid SI and class.
- Firestore competitor document is created.
- Firestore SI assignment is created.
- Express mirror is updated after Firestore success.
- `updatedAt` changes only once.
- No stale snapshot can overwrite the document afterward.

### 7.2 Edit competitor

Validation:

- Update fields such as `bib`, `club`, `classId`, `siNumber`, `isBorrowedCard`, and `isRentalCard`.
- Confirm the write is atomic and that the assignment doc is updated.
- Confirm field values read from Firestore remain authoritative even after a legacy snapshot refresh.

### 7.3 Delete competitor

Validation:

- Delete is rejected if dependent receipts or punch history still exist.
- Retire path is accepted when a deletion is not safe.
- Hard delete is allowed only after retention checks pass.

### 7.4 Retire competitor

Validation:

- Retire a competitor and confirm access is removed from active competition operations.
- Confirm the document is not silently dropped.
- Confirm receipts remain intact and historical reconstruction remains possible.

### 7.5 Duplicate SI card

Validation:

- Attempt to create or assign a duplicate SI.
- Confirm the transaction rejects the second write with a deterministic duplicate-SI error.
- Confirm existing competitor remains unchanged.

### 7.6 Concurrent registration

Validation:

- Start two concurrent create requests for the same SI.
- Confirm only one succeeds.
- Confirm the loser receives a conflict and no partial state exists.

### 7.7 Import competitor

Validation:

- Import competitor records using a trusted backend path.
- Validate that duplicate SIs and invalid classes are rejected before commit.
- Confirm import row rejection is visible and resumable without rewriting valid rows.

### 7.8 Eventor import

Validation:

- Eventor-imported competitor rows may not override existing Firestore competitor fields silently.
- If the import touches an existing competitor, the system must apply a merge policy that respects explicit ownership and not a stale snapshot.
- Duplicate SI mappings must be rejected or resolved by the import policy.

### 7.9 Rollback scenario

Validation:

- Simulate a failure after Firestore write but before Express mirror write.
- Confirm Firestore remains authoritative and the mirror is reconciled later.
- Simulate a stale snapshot after the cutover and confirm it is ignored.

---

## 8. Cutover checklist

### Preconditions

Before Phase 2 begins, all of the following must be true:

- Firestore competitor document schema is approved for the Phase 2 field set.
- SI assignment document pattern is approved and tested.
- All legacy mutation routes for competitor create/edit/delete are identified and fenced.
- `cloud-export`, `cloud-hydrate`, `syncFullSeasonToFirestore`, and snapshot replay are restricted from overwriting Firestore competitor data.
- A trusted backend writes path is approved for all competitor CRUD operations.
- Firestore client rules deny direct write access to migrated competitor fields and SI assignment docs.
- `seasonDb` remains compatibility-only and never authoritative.
- Retire/tombstone policy is approved before any delete path is enabled.

### Go criteria

Go when all of the following are true:

- SI collision handling works under normal and concurrent create/update scenarios.
- Firestore writes succeed before UI success is reported.
- Express mirror updates are strictly post-write compatibility updates only.
- Snapshot replays cannot overwrite Firestore competitor data.
- Retire/deletion logic preserves historical receipts and punch data.
- Backward compatibility is preserved for existing competitor list and admin views.
- The build and lint validations pass for the design implementation when implemented.

### No-go criteria

No-go if any of the following is true:

- A legacy route still writes competitor docs after the cutover.
- A stale snapshot can overwrite a newer Firestore update.
- Duplicate SI assignment is not prevented transactionally.
- Deletion removes active or historical references without an approved retention check.
- Expression of authority is mixed: both Firestore and Express are treated as equal writers.

### Rollback criteria

Rollback is required if:

- Firestore writes fail in production under expected load.
- SI collisions appear in production despite transaction checks.
- A legacy snapshot overwrites a newer canonical competitor record.
- A duplicate competitor or assignment is created after cutover.
- A competitor is deleted without an approved retention check.

Rollback behavior:

- disable the new Firestore-first mutation path
- preserve Firestore as the source of truth for the fields already migrated
- reconcile the Express mirror from Firestore instead of reintroducing stale snapshot writes
- restore historical compatibility only after verification

---

## Design summary

Phase 2 is a narrow but structurally important migration. It moves competitor identity, registration, and SI ownership into Firestore without yet taking on readout or punch authority.

The central design aims are:

- Firestore owns competitor CRUD data.
- SI uniqueness is enforced through a deterministic assignment document.
- Legacy snapshots are treated as non-authoritative and are ignored when stale.
- Retire/tombstone is the default deletion model until historical references are safely cleared.
- Express remains a compatibility mirror only.

This phase does not solve readout or live-event authority. Those remain in later phases and must not be merged into this design.
