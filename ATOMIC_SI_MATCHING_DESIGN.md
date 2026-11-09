# Atomic SI Card Matching Design

Status: implementation-ready design for the next P0 migration step.

Source material:

- [COMPETITOR_PHASE2_DESIGN.md](./COMPETITOR_PHASE2_DESIGN.md)
- [COMPETITOR_READOUT_ARCHITECTURE.md](./COMPETITOR_READOUT_ARCHITECTURE.md)
- [P0_IMPLEMENTATION_PLAN.md](./P0_IMPLEMENTATION_PLAN.md)
- [P0_RESOLUTION_PLAN.md](./P0_RESOLUTION_PLAN.md)

## Goal

Define the canonical Firestore SI-card matching layer before readout authority, competitor CRUD authority, or result-affecting mutations expand beyond the current administrative migration slice.

This design makes `siCardAssignments/{siNumber}` the single source of truth for competitor-to-SI identity. The assignment record is authoritative for duplicate checks, lookup during readout resolution, and the safe transfer of SI ownership when a competitor changes card or is retired.

This document intentionally covers the matching layer only. It does not authorize readout result generation, online punch authority, station authority, ROC migration, or WebSocket replacement. Those remain later phases.

---

## 1. Firestore collection design

### 1.1 Canonical collection

```text
competitions/{competitionId}/siCardAssignments/{siNumber}
```

The document ID is the normalized SI number as a string (for example `123456789`). This ensures deterministic lookup, avoids a broad query, and makes a single transaction both cheap and safe.

### 1.2 Required document fields

```ts
interface SiCardAssignment {
  competitionId: string;
  siNumber: number;
  cardSeries: string;
  competitorId: string | null;
  competitorDocumentId: string | null;
  state: 'ACTIVE' | 'RETIRED' | 'DUPLICATE_CONFIRMED' | 'UNKNOWN';
  assignmentVersion: number;
  source: 'DIRECT_ENTRY' | 'IMPORT' | 'EVENTOR' | 'MANUAL' | 'READOUT' | 'SYSTEM';
  ownerUid: string;
  schemaVersion: 1;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  previousCompetitorId?: string | null;
  retiredAt?: Timestamp | null;
  retirementReason?: string | null;
  conflictReason?: string | null;
  lastValidatedAt?: Timestamp | null;
}
```

`competitorDocumentId` is required and must equal `competitorId`. Both are nullable only
when the assignment has no resolved competitor. `schemaVersion` is required and is
currently exactly `1`; bumping it requires a coordinated model, parser, rules, and
migration change. Timestamp fields are Firestore `Timestamp` values, never ISO strings.
The four fields after `previousCompetitorId` are optional; when present, nullable values
are accepted where indicated.

### 1.3 Field semantics

- `competitionId`: competition scope for the assignment.
- `siNumber`: normalized SI card number.
- `cardSeries`: metadata and validation only; not uniqueness.
- `competitorId`: current authoritative competitor the card belongs to, or `null` until resolved.
- `competitorDocumentId`: required mirror of `competitorId`, including `null` when unresolved.
- `state`:
  - `ACTIVE`: current valid assignment.
  - `RETIRED`: card intentionally removed or retired.
  - `DUPLICATE_CONFIRMED`: a duplicate was detected and the assignment is locked to prevent reuse.
  - `UNKNOWN`: assignment is temporarily unmatched and must be resolved by review or reprocessing.
- `assignmentVersion`: monotonic integer used for optimistic conflict detection and compatibility fallback.
- `previousCompetitorId`: preserved if a card is reassigned or moved during a manual repair.
- `source`: origin of the assignment creation or mutation; used for audit and troubleshooting.
- `ownerUid`: the verified administrator who created the assignment; stable across updates.
- `schemaVersion`: required schema marker. Version `1` is the only version accepted by the current rules and parser.
- `createdAt` / `updatedAt`: audit timestamps.
- `retiredAt`: immutable retirement timestamp.
- `retirementReason`: human-readable reason for a retirement or deletion.
- `conflictReason`: reason for duplicate or imported-collision rejection.
- `lastValidatedAt`: tracks when the assignment was last confirmed against the competitor record.

### 1.4 Required indexes

FireStore should maintain the following simple indexes and query patterns:

1. Collection-level lookup by document ID (`siNumber`): exact match
2. Competition-scoped query by `competitorId`:
   - `competitionId` + `competitorId`
3. Query by `state`:
   - `competitionId` + `state`
4. Query by `ownerUid`:
   - `competitionId` + `ownerUid`
5. Optional query by import source for duplicate review:
   - `competitionId` + `source`

These are not heavy or complex. The system should avoid broad ad hoc scans. The document ID means the hot path is always a direct read, never a collection scan.

### 1.5 Ownership and lifecycle

The assignment record is owned by Firestore and treated as a canonical routing table.

Ownership rules:

- Firestore is the only valid writer for `siCardAssignments`.
- Express, legacy snapshots, cloud export/hydrate, and `syncFullSeasonToFirestore` are read-only or compatibility-only for this collection.
- Legacy seasonDb-derived values may be used for migration bootstrapping, but they may not overwrite a newer Firestore assignment.

Lifecycle:

- Created when a competitor is first inserted or imported.
- Updated when a competitor SI is changed or a manual correction is accepted.
- Retired when a competitor is deleted or retired for a non-recoverable reason.
- Locked to `DUPLICATE_CONFIRMED` when duplicate detection or uploaded import collision occurs.

---

## 2. SI lifecycle

### 2.1 Registration

On competitor creation, the backend must perform a single transaction:

1. Normalize the SI number.
2. Read `siCardAssignments/{siNumber}`.
3. If the document does not exist -> create it with `state: 'ACTIVE'` and the new competitor.
4. If the document exists and belongs to the same competitor -> allow metadata update.
5. If the document exists and belongs to a different active competitor -> reject with duplicate SI conflict.
6. If the document exists but is `RETIRED` -> require explicit reactivation flow.
7. If the document exists but is `DUPLICATE_CONFIRMED` -> reject and escalate to manual resolution.

The transaction writes the competitor document and the assignment document together, ensuring atomicity.

### 2.2 SI change

Changing a competitor's SI number is a controlled mutation. It must not silently rebind the previous card.

Required flow:

1. Read the current competitor document.
2. Read the target assignment doc `siCardAssignments/{newSiNumber}`.
3. Read the old assignment doc `siCardAssignments/{oldSiNumber}`.
4. Validate permission and lifecycle.
5. Confirm the new assignment is free, or belongs to the same competitor in a controlled update.
6. In one transaction:
   - update the competitor SI number and card metadata
   - update the target assignment to the new `competitorId` and `state: 'ACTIVE'`
   - retire the old assignment or mark it as `RETIRED` with previous pointer data
   - write audit data
7. On failure, abort; no partial rebind.

Important: a card is never “moved” through a best-effort write. The operation is atomic and fails closed.

### 2.3 Competitor deletion

Delete is not automatically a hard delete for migrated domains. Competitor records use a retirement/tombstone policy in the migration model.

Required behavior:

1. Check whether the competitor has historical dependencies:
   - readout receipts
   - station punches
   - historical result projections
   - imported Eventor data
2. If dependencies exist, do not hard delete immediately.
3. Instead, mark the competitor as retired and keep the assignment in a retired state.
4. Only allow hard delete after retention checks pass and the system has explicit approval for a cleanup.

In the same transaction:

- retire the competitor as `retired` or `deleted`
- update `siCardAssignments/{siNumber}` to `RETIRED` with `retirementReason`
- preserve the old records in audit and history collections if required

### 2.4 Competitor retirement

Retirement is different from deletion. Retirement means the competitor record remains visible for historical integrity but is removed from active registration use.

Rules:

- Assignment stays in a non-active state.
- SI card is not available for re-registration until a manual reactivation flow is executed.
- Historical readout receipts remain immutable and continue to point to the retired competitor ID.

This preserves readout continuity and prevents the app from “losing” a previously known competitor by a stale delete.

### 2.5 Eventor import

Eventor-imported competitors must be treated as authoritative at import time, but still pass through the same SI assignment guard.

Required behavior:

- Parse and validate imported competitors server-side.
- For each imported row, perform the same single-assignment transaction.
- If duplicate SI exists, reject or quarantine the imported row rather than silently replacing the existing active competitor.
- Preserve import provenance in `source` and conflict metadata.

This prevents imported data from reintroducing stale competitor identity after the initial migration.

### 2.6 Direct entry

Direct entry is the primary local create path. It must use the same assignment check as all other creation flows.

Rules:

- Create the competitor in a transaction.
- Create the assignment in the same transaction.
- If an SI is already active for another competitor, reject.
- If the SI was previously retired, require reactivation or a manual override.
- Capture `source: 'DIRECT_ENTRY'`.

No direct write from the browser to the assignment doc is allowed.

### 2.7 Readout resolution

During readout processing, the system matches by SI number using `siCardAssignments/{siNumber}`.

Required logic:

1. Normalize the SI number from the readout payload.
2. Look up the assignment doc.
3. If `state === 'ACTIVE'` -> resolve competitor and update the current projection.
4. If `state === 'UNKNOWN'` -> treat as unresolved; create an `UNKNOWN` receipt and do not fabricate a competitor.
5. If `state === 'RETIRED'` -> route to manual review or reject with a clear conflict result.
6. If `state === 'DUPLICATE_CONFIRMED'` -> reject as a conflict and do not update race state.

This is the exact point where a wrong assignment would make the system silently attach a readout to the wrong athlete. The assignment doc is the guardrail.

---

## 3. Concurrency model

### 3.1 Core guarantee

The same SI card can never be assigned to two active competitors in the same competition, even when two clients submit at the same time.

This is guaranteed by a transaction on the assignment document.

### 3.2 Transaction sequence

Pseudo-flow:

```ts
runTransaction(async (tx) => {
  const competitionRef = doc(db, 'competitions', competitionId);
  const competitorRef = doc(db, 'competitions', competitionId, 'competitors', competitorId);
  const assignmentRef = doc(db, 'competitions', competitionId, 'siCardAssignments', String(siNumber));

  const [competitionSnap, competitorSnap, assignmentSnap] = await Promise.all([
    tx.get(competitionRef),
    tx.get(competitorRef),
    tx.get(assignmentRef),
  ]);

  // 1. Validate competition state and permissions
  // 2. Validate competitor creation/update lifecycle
  // 3. Validate assignment state
  // 4. If assignment absent -> create it
  // 5. If assignment belongs to same competitor -> allow update
  // 6. If assignment belongs to another active competitor -> throw conflict
  // 7. Write competitor doc + assignment doc + audit event
});
```

### 3.3 Reads in the transaction

The transaction must read:

- competition document: lifecycle, permissions, ownership
- competitor document: current assigned SI and metadata
- assignment document: card ownership state
- optionally a lock or version doc for future sequence-safe modifications

These reads are all against a single competition path and single SI document. They are stable and low-cost.

### 3.4 Writes in the transaction

The transaction must write, in the same commit:

- competitor document patch
- assignment document creation or update
- audit or conflict document, if required
- optional outbox event for external delivery if the update has live implications

Writes are atomic. Either the whole mutation succeeds or nothing is committed.

### 3.5 Failure behavior

If any validation fails:

- the transaction aborts
- no competitor write is committed
- no assignment write is committed
- the client receives a structured conflict or validation error

Example outcomes:

- duplicate SI -> reject with `DUPLICATE_SI_NUMBER`
- retired card -> reject with `RETIRED_SI_NUMBER`
- imported competitor collision -> reject import row and mark it for manual review

A client retry is allowed only with the same logical operation ID. A new unique operation attempt can be made only after the user resolves the conflict.

---

## 4. Conflict handling

### 4.1 Duplicate SI number

Problem: attempted assignment of an SI already active on another competitor.

Required behavior:

- Reject the mutation before writing anything.
- Write a failure record to the audit log if the operation includes a user-facing conflict report.
- Return a clear message like: `SI-nummer 123456789 är redan registrerat på annan deltagare.`
- Do not overwrite the existing active assignment.

### 4.2 Retired card

Problem: a competitor is retired or deleted, but the SI number still exists in the assignment model.

Required behavior:

- Do not reuse the card silently.
- Require an explicit manual reactivation or assignment-transfer workflow.
- Keep the old record in a retired state and preserve audit trail.

### 4.3 Reassigned card

Problem: a card is being moved from one competitor to another.

Required behavior:

- The new SI assignment must be validated in a transaction.
- The old assignment is updated after the new assignment is confirmed.
- If the new assignment is already taken, reject before touching the old assignment.

This is the safe path for admin repair.

### 4.4 Imported competitor collision

Problem: Eventor or bulk import contains an SI already present in Firestore.

Required behavior:

- Reject the row or quarantine it.
- Preserve source and importer metadata as a conflict record.
- Do not silently replace the existing active competitor.
- Log the event and keep the import job resumable.

### 4.5 Manual resolution workflow

A conflict may need human intervention:

- `duplicate_si`
- `retired_card`
- `reassigned_card`
- `import_conflict`

Manual resolution requires:

- a human reviewer
- the conflicting competitor IDs
- the conflicting SI number
- the reason and time
- a clear approve/reject action

The assignment doc is not automatically mutated by a human fix without a transaction and validation.

---

## 5. Firestore rules

The Firestore rules must enforce the authoritative boundary.

### 5.1 Required rule changes

1. `siCardAssignments` collection must be admin-write-only.
2. Only a trusted backend or service account may write or delete assignment docs.
3. Direct client writes to `siCardAssignments` are denied, even if the client requests an update.
4. Competitor write rules must not allow arbitrary SI rewrites from the client without server-side validation.
5. Public clients may read only a safe public competitor projection.
6. Private competitor fields remain read-protected to admins and explicitly authorized roles.
7. A `state` change from `ACTIVE` to `RETIRED` must require an admin service path, not client self-service.

### 5.2 Rule enforcement model

The app may request writes via a trusted backend callable, but the client must never have direct write rule permission to:

- `competitions/{competitionId}/competitors/*`
- `competitions/{competitionId}/siCardAssignments/*`
- any receipt or punch collection that is authoritative during the migration

This is the architecture-level guarantee that prevents stale snapshots and direct browser mutation from corrupting the canonical state.

---

## 6. Audit model

### 6.1 Logging requirements

Every accepted mutation to the SI assignment layer must log:

- actor UID
- role
- competition ID
- competitor IDs involved
- previous and new SI numbers
- assignment version before/after
- timestamp
- reason and source
- operation ID if available

### 6.2 Conflict reporting

A conflict should be recorded as a structured audit row with:

```ts
interface SiAssignmentAuditEvent {
  eventId: string;
  competitionId: string;
  siNumber: number;
  actorUid: string;
  actorRole: string;
  source: 'DIRECT_ENTRY' | 'IMPORT' | 'EVENTOR' | 'READOUT' | 'SYSTEM';
  oldCompetitorId?: string | null;
  newCompetitorId?: string | null;
  action: 'CREATE' | 'UPDATE' | 'REJECT' | 'RETIRE' | 'REACTIVATE';
  reason: string;
  createdAt: Timestamp;
}
```

This gives the team a durable record of all assignment changes and conflicts.

### 6.3 Manual resolution workflow

Manual review is required for:

- duplicate SI cards
- conflicted imports
- retired card reactivation
- suspicious assignment rewrites

The review workflow should use an admin UI that shows:

- active conflict
- affected competitor records
- source of the conflict
- recommended action
- required confirm/reject button

The workflow always routes through the trusted backend, not direct Firestore client mutation.

---

## 7. Rollback

### 7.1 Rollback procedure

Rollback of the SI matching layer must be surgical and ruled by the assignment contract.

Rollback plan:

1. Stop all new writes to the authoritative assignment collection.
2. Freeze any direct client mutation to competitor SI assignment operations.
3. Revert the UI to the previous read-only or compatibility-mirror mode.
4. Rebuild the assignment layer from a clean snapshot, not by replaying stale snapshot data.
5. Reconcile the assignment documents against surviving competitor documents.

### 7.2 Reconciliation procedure

Reconciliation is a repair job that checks:

- every competitor has a valid active assignment if it should be active
- every active assignment points to an existing competitor
- no two active assignments point to different competitors with the same SI number
- retired assignments remain immutable for historical integrity

The reconciliation job should produce a report with:

- missing assignment
- duplicate assignment
- mismatched competitor pointer
- invalid retired state
- orphaned SI record

This is a repair and validation workflow, not a write path used by normal app runtime.

### 7.3 Protection from stale snapshots

Legacy snapshot or export/hydrate flows must never be used as the canonical rollback restoration path for SI assignments. They are valid only for offline restore or migration analysis. The assignment collection must remain single-writer authoritative.

---

## 8. Validation matrix

### 8.1 Required validation scenarios

| Scenario | Expected result | Failure modes |
|---|---|---|
| Concurrent registration of same SI | Only one competitor gets the assignment; the other is rejected | Double-write race, split-brain assignment |
| SI change to vacant number | Assignment transferred atomically | Partial old/new assignment state |
| SI change to occupied number | Transaction rejected, no update committed | Silent overwrite of existing competitor |
| Direct entry with existing active SI | Rejected with conflict error | Duplicate competitor registration |
| Eventor import duplicate SI | Import row rejected or quarantined | Imported stale data overrides canonical state |
| Readout lookup for active SI | Correct competitor resolved and receipt stored | Wrong athlete, mismatched result |
| Readout lookup for retired SI | Rejected or manual review | Stale card still considered active |
| Readout lookup for duplicate card | Not processed; conflict recorded | Hidden card collision |
| Delete or retirement of competitor | Assignment becomes `RETIRED` and is not reused | Retired card immediately reactivated by stale snapshot |
| Reconciliation after rollback | Assignment set matches current competitor set | Orphaned/mismatched assignments |

### 8.2 Acceptance criteria

The SI matching layer is considered complete when all the following are true:

- every active competitor has exactly one active assignment
- every active assignment points to a valid competitor
- no concurrent registration can claim the same SI card
- duplicated SI imports are rejected or quarantined
- retired cards remain non-reusable until explicit reactivation
- readouts resolve through the assignment doc and never fall back to a stale legacy table
- rollback and reconciliation are deterministic and do not require guesswork

---

## 9. Implementation guide

### 9.1 Required phases for implementation

Phase A: schema support
- Create `siCardAssignments` collection and its model.
- Add Firestore rules and schema tests.
- Keep runtime behavior unchanged.

Phase B: read-only lookups and validation
- Add deterministic SI assignment lookup and resolver helpers.
- Add admin-only integrity reporting and diagnostic audit logs.
- Keep the helpers out of competitor creation, updates, and readout flows.

Phase C: uniqueness enforcement
- Add assignment validation to competitor create and edit operations.
- Reject duplicate assignments and provide a manual review path.
- Ensure competitor and assignment mutations use the same transaction.

Phase D: readout resolution integration
- Resolve SI assignments during readout processing.
- Create `UNKNOWN` / rejected outcomes correctly.
- Keep readout receipts immutable.

Phase D: reconciliation and rollback drill
- Execute repair job and review reports.
- Verify assignment consistency after a simulated stale-write attempt.

### 9.2 Non-goals

The following remain explicitly outside the Atomic SI Matching scope:

- readout result calculation
- online punch authority
- live-event delivery
- ROC integration
- station punch migration
- WebSocket replacement

---

## 10. Final design decision

The authoritative SI identity model is:

```text
competitions/{competitionId}/competitors/{competitorId}
competitions/{competitionId}/siCardAssignments/{siNumber}
```

The competitor doc stores the actual data and status projection. The SI assignment doc is the canonical reverse lookup and uniqueness lock. This is the correct migration boundary for the next P0 implementation step because it prevents the most expensive class of failure: incorrect card-to-competitor identity and competing writes from stale legacy state.
