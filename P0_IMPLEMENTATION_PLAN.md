# P0 Implementation Plan

Status: implementation planning document for the required P0 architecture work before Competitor Phase 2 begins.

Historical planning record: individual status notes below preserve the state at each planning milestone and are not the current blocker inventory. Current readiness is maintained in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md); the completed Firestore import/snapshot migration is documented in [IMPORT_SNAPSHOT_MIGRATION.md](./IMPORT_SNAPSHOT_MIGRATION.md).

Source material:

- [MIGRATION-STATUS.md](./MIGRATION-STATUS.md)
- [COMPETITOR_READOUT_ARCHITECTURE.md](./COMPETITOR_READOUT_ARCHITECTURE.md)
- [SEASONDB_RETIREMENT_PLAN.md](./SEASONDB_RETIREMENT_PLAN.md)
- [P0_RESOLUTION_PLAN.md](./P0_RESOLUTION_PLAN.md)
- [CUTOVER_CHECKLIST.md](./CUTOVER_CHECKLIST.md)
- [COMPETITOR_READOUT_IMPLEMENTATION_PHASES.md](./COMPETITOR_READOUT_IMPLEMENTATION_PHASES.md)
- [COMPETITOR_CUTOVER_PREREQUISITES.md](./COMPETITOR_CUTOVER_PREREQUISITES.md)

## Goal

Convert all identified P0 architecture risks into concrete implementation tasks.

Current status:

- **Readout auto-create migration (2026-11-10):** The Firestore readout helper now creates the competitor, active SI assignment, readout receipt, and competitor/finished counters in one transaction when auto-create is enabled and runnerDb identity matches. Existing assignments, duplicate competitor candidates, duplicate-scan failures, and changed runnerDb identity fail closed to an `UNKNOWN` receipt. The Express `/api/readout` and online-punch paths no longer create competitor identities. Firestore rules allow this paired path for readout roles only when identity fields match runnerDb. See [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md). This closes the readout auto-create identity bypass, not the remaining legacy-writer or global uniqueness blockers.
- Architecture design is complete.
- Competitor Phase 2 has not started.
- Atomic SI matching Phase B adds opt-in read-only lookup/resolution and admin validation/reporting helpers. Lookup hits, misses, and retired or duplicate assignments produce structured diagnostic logs; no competitor or readout path calls these helpers. Rules tests cover assignment reads for admins/READOUT and denial for unrelated roles; diagnostic logs are not durable audit records.
- Atomic SI matching Phase A is now in place as schema-only support: the Firestore collection, TypeScript model, helper functions, and rules skeleton exist without changing runtime mutation behavior.
- The legacy full-season snapshot writer skips updates to existing competitor documents and refuses snapshot-driven deletion; changed-field and omission attempts are logged. Express competitor and rental mirror routes log protected-field write attempts but continue existing mirror behavior. The writer can still attempt to seed missing records, but the client rules deny creations without a paired assignment.
- P0 Step 2 adds a shared `declareCompetitorMutation` boundary. Competitor mutations currently declare `VALIDATED` or `LEGACY`; all existing create, SI-update, delete, import, direct-entry, Eventor/IOF import, restore/hydrate, snapshot-seed, and relevant update paths declare `LEGACY`. Diagnostics are emitted centrally, but the boundary intentionally always allows writes in this preparation step.
- P0 Step 3 routes identity-affecting competitor writes through `runCompetitorMutation` / `runCompetitorMutations` in `src/utils/siAssignmentDiagnostics.ts`. The common boundary logs operation type, assignment-awareness, `mutationBoundary: CENTRALIZED`, and `enforcementReadiness: PRE_ENFORCEMENT`, then invokes the original write callback. Firestore direct-entry, CRUD, imports, snapshot seeding and competition deletion, and Express direct-entry, SI edits, deletes, IOF/Eventor imports, readout auto-creation, cloud hydration, restore, demo clear and competition deletion now use it. It deliberately does not enforce uniqueness or update assignments atomically.
- P0 Step 4 adds `runCompetitorIdentityMutation(s)` as the canonical pre-enforcement mutation service, with the `runAssignmentAwareCompetitorMutation(s)` API retained as a compatibility wrapper. Requests carry a mutation intent, competitor context, assignment context, and optional synchronous validation hooks. Hook failures are logged and remain non-blocking. Existing Firestore and Express mutation wrappers now route through the canonical service. Diagnostics distinguish service usage, assignment-aware observation, legacy path usage, and pending assignment writes; legacy routing is not the same as bypassing the service. The service supports create, identity update, SI change, retirement and delete intents but does not yet write assignments or enforce uniqueness.
- P0 Step 5 introduces `runAtomicSIAssignmentMutation` in `src/firebase.ts` and routes Firestore direct-entry, competitor update/SI change, and competitor delete through it. After its reads and diagnostics, the transaction's actual write callback now passes through `runAssignmentAwareCompetitorMutation`. Every identified in-repository competitor identity writer routes through the common mutation service: Firestore CRUD/import/snapshot seeding, Express CRUD, direct entry, readout auto-creation, IOF/Eventor import, restore, cloud hydrate, demo clear, and competition deletion. Legacy writers keep their original behavior and emit diagnostics; direct Firestore clients remain outside the in-process boundary. The transaction reads competition and competitor documents plus current/requested assignment documents, classifies assignment existence/missing/mismatch, and returns a structured diagnostic result. Create/SI-change paths also report competitors matching the requested SI as duplicate candidates; because Firebase Web transactions do not support query reads, that read-only candidate scan runs immediately before the transaction and is diagnostic only. No path writes assignments or rejects duplicates. Readout processing is unchanged.
- Atomic SI Matching Phase C Preview adds an explicit transaction-local assignment and competitor mutation plan for create, SI reassignment, retirement, and deletion. The result includes assignment existence/mismatch, duplicate-candidate, reassignment/retirement flags, simulated blockers, and the proposed mutations. Preview blockers never prevent the existing write; no assignment document is written. `[atomic-si-preview-metrics]` reports process-local totals for operations, simulated successes/blocks, and reassignment/retirement requirements after completed transactions. Duplicate candidate queries remain outside the transaction and query failures are conservatively counted as simulated blocks. A fresh client runtime starts with zero counts; implementation validation did not run live Firestore mutations, so simulated results at delivery are 0 operations / 0 successes / 0 would-block / 0 reassignment / 0 retirement.
- **Phase C Step 1:** The Firestore transaction creates assignments with new competitors and retires assignments with competitor retirement/deletion. Missing assignments receive a retired tombstone on retirement/delete when SI/card-series fields are valid. Invalid or differently-owned assignments are not overwritten; the competitor mutation continues and emits a diagnostic. Retirement maps an already-started competitor to `DNF` and a not-yet-started competitor to `DNS`.
- **Phase C Step 2 (current):** SI reassignment reads the current and target assignments before any transaction writes. In one transaction it retires the old assignment, creates a target assignment or reactivates a retired target, and updates the competitor SI fields. Active target assignments owned by another competitor, malformed assignments, or version-limit cases are preserved and reported as conflict/partial outcomes; the competitor update still continues. Duplicate candidates remain allowed and are diagnostic only. The preview includes `reassignmentConflict` and `REASSIGNMENT_CONFLICT`; readout processing is unchanged. Unit tests cover normal reassignment planning, occupied targets, retired targets, version limits, and side-effect-free planning on abort. No uniqueness enforcement is enabled.
- **P0 Step 6 (diagnostics-only rules preparation):** Audited competitor and SI-assignment rules. Both authorize independent admin writes and validate only their own document fields; neither requires a paired transaction or checks cross-document SI consistency. Firestore rules cannot log warnings, so enforcement and authorization are unchanged. `inspectSIAssignmentRuleMutations` emits warning-only diagnostics for competitor SI updates without old-retire/target-activate changes, assignment create/update without a corresponding competitor identity/retirement change, and assignment deletion. The shared mutation boundary and standalone assignment helpers emit applicable diagnostics for in-process legacy paths. The rules suite covers the expected paired reassignment batch and records independently permitted and mismatched writes as current bypasses; it could not be run because no Firestore emulator was running in this workspace.
- **P0 Step 7 (initial Firestore rule fence):** Competitor creation requires an ACTIVE SI assignment to exist after commit; SI changes require retiring the old assignment and an ACTIVE assignment at the requested SI to exist after commit; competitor deletion requires its assignment retirement. Assignment create/update requires a corresponding competitor create, SI/lifecycle change, or delete in the same commit. Hard deletion of an SI assignment is denied. These checks do not query competitors or reject duplicate SI candidates: an already-active SI target remains admissible when the transaction retires the competitor's old SI, preserving pre-enforcement duplicate behavior. Assignment records created/updated by paired transactions must match the corresponding competitor or retirement/deletion state. Unrelated competitor lifecycle/readout/billing fields retain their existing rules. The rules tests now declare paired writes as the expected path and isolated/mismatched writes as denied.
- **Legacy-writer milestone — restore identity fence:** `/api/system/restore` previously replaced the whole Express season from one backup. It now compares competitor identity and lifecycle status (competition, competitor ID, SI number, card series, and status) before applying the restore, and rejects changes with HTTP 409 plus a structured warning. Same-identity/status backups can still restore other season data; no assignment writes or uniqueness enforcement were added.
- **Legacy-writer milestone — cloud-hydrate identity fence:** `/api/system/cloud-hydrate` now hydrates non-identity fields only for matching local competitor IDs. It preserves competitor IDs, SI number, card series, lifecycle status, and assignment relationship/state metadata; additions, removals, identity changes, duplicate IDs, and omitted competitions are blocked with structured warnings and mutation diagnostics. This endpoint does not write Firestore assignment documents.
- **Remaining writer inventory before uniqueness enforcement:**
  - **Risk order:** (1) Express CRUD/direct-entry; (2) Eventor/IOF bulk import; (3) competitor changes during competition deletion; (4) snapshot seeding — incomplete client commits are denied by rules; (5) restore — identity/lifecycle changes fenced; (6) cloud hydrate — identity changes fenced, non-identity mirror hydration remains. The legacy Express readout processor remains a result-mirror concern but cannot create competitor identity.
  - **MUST BE REDIRECTED or DISABLED:** Express competitor CRUD/direct-entry, Eventor/IOF imports, snapshot seeding, and competitor changes during competition deletion. These paths still mutate the Express season or import records without the trusted atomic assignment transaction.
  - **SAFE TO KEEP (limited):** Cloud hydrate for non-identity mirror fields and restore for non-identity data when competitor identity/status is unchanged.
  - **Next highest active bypass:** Express competitor CRUD/direct-entry remains the broadest unfenced identity writer.
  - **MUST BE DISABLED or wrapped:** Standalone client writes to `siCardAssignments`, hard assignment deletion, and any direct competitor SI create/update/delete not submitted with its corresponding assignment mutation. Firestore rules now deny these incomplete client commits; exported one-document helpers should not be used as mutation APIs.
  - **Remaining before uniqueness enforcement:** Route remaining legacy/server writers through a trusted atomic server boundary or disable them. Run the Firestore emulator suite and add trusted-server tests for retries, rollback, and concurrent duplicate attempts. The initial rules fence prevents direct client SI mutations from committing without paired assignment writes but does not establish uniqueness.
- Before Competitor Phase 2 can begin, the following P0 risks must be resolved:
  1. **Single-writer authority:** Express/import/restore/hydrate/snapshot and competition-deletion paths are still legacy writers; route them to the trusted atomic path or disable them before enforcement.
  2. **Atomic SI ownership:** create, retirement, deletion, and reassignment now write competitor and assignment documents in one Firestore client transaction. Uniqueness is still disabled; occupied targets are reported and not overwritten.
  3. **Firestore rule fencing:** the initial client fence is in place for competitor create/SI change/delete and assignment create/update. Legacy/Admin SDK writers remain outside these rules.
  4. **Concurrency and rollback:** verify duplicate races, idempotency, stale snapshots, and rollback behavior with Firestore emulator/integration tests before enabling uniqueness.

This document is a task plan, not code.

---

## Section 1 – Single-writer implementation

### Objective

Design exactly how Firestore becomes the only writer for migrated domains. Legacy `seasonDb`/Express mutation paths must be disabled, redirected, or guarded before any Phase 2 implementation is allowed to write live competitor data.

### Implementation principle

For each migrated domain, one of the following must be true:

- The path is disabled.
- The path is redirected to the trusted backend.
- The path is explicitly blocked by a stale-write guard.
- The path is converted into a compatibility mirror only.

No dual-write model is acceptable for the competitor/readout migration.

### Path inventory and required change

| File | Function / route | Change required | Risk |
|---|---|---|---|
| [server.ts](./server.ts) | `POST /api/competitors` | Disable or redirect to a trusted backend mutation service. If still needed for compatibility, accept only read-only mirror updates and never authoritative writes. | High — legacy direct creation can recreate stale competitor state. |
| [server.ts](./server.ts) | `PUT /api/competitors/:id` | Disable or route through the same trusted backend; do not allow direct `seasonDb` update of migrated competitor fields. | Critical — direct updates can overwrite Firestore-owned fields. |
| [server.ts](./server.ts) | `DELETE /api/competitors/:id` | Replace with retire/tombstone path; hard delete allowed only after retention check. | Critical — deletion can silently remove active or historical state. |
| [server.ts](./server.ts) | `POST /api/readout` | Disable or redirect to Firestore transaction-based readout service; legacy mutation must be blocked. | Critical — readout state and competitor state still controlled by stale server state. |
| [server.ts](./server.ts) | `POST /api/online-punch` | Disable or redirect to trusted backend; do not allow `seasonDb` punch writes to mutate canonical competitor state. | Critical — race and status data can diverge. |
| [src/App.tsx](./src/App.tsx) | `handleCreateDirectEntry` | Remove mixed Firestore/Express create behavior; prefer a single backend operation. | High — fallback logic creates ambiguous authority. |
| [src/App.tsx](./src/App.tsx) | `onUpdateCompetitor` | Stop calling legacy mutation path for migrated fields; only Firestore-authoritative update path is permitted. | Critical — partial dual-write remains active. |
| [src/App.tsx](./src/App.tsx) | `handleManualFinish`, `onUpdateRunnerStatus` | Ensure these paths do not call legacy mutation flow for migrated competitor fields. | High — operational status can be overwritten by stale server state. |
| [src/firebase.ts](./src/firebase.ts) | `syncFullSeasonToFirestore` | Freeze or guard from updating existing Firestore competitor records unless an approved migration override exists. | Critical — full-season sync can overwrite newer Firestore competitor state. |
| [src/firebase.ts](./src/firebase.ts) | `saveCompetitionImportToFirestore` | Require import-time validation and stale-write guard; do not allow bulk import to overwrite authoritative migrated fields. | High — imports are snapshot-like writes and can reintroduce stale state. |
| [src/firebase.ts](./src/firebase.ts) | `loadFullSeasonFromFirestore` | Treat as read-only for migrated competitive state; do not use for writing or replaying authoritative competitor values. | High — hydration logic can reintroduce stale values. |
| [server.ts](./server.ts) | `persistUserMutation`, `broadcastFullState` | Keep only for compatibility mirroring after canonical write succeeds; never use as canonical mutation source. | Medium — compatibility broadcasts can reintroduce stale state into clients. |
| [server.ts](./server.ts) | `cloud-export` / `cloud-hydrate` | Restrict to backup/restore only; no writes to authoritative competitor/readout docs while migration is active. | Critical — export/hydrate can become stale snapshot rewriters. |

### Required implementation tasks

1. Create a single authority boundary document or policy object that lists:
   - allowed mutation paths
   - disabled legacy paths
   - allowed compatibility mirror writes
2. Enforce that all migrated competitor writes originate from one backend service.
3. Disallow any client-side direct write to competitor CRUD paths, even if the UI currently attempts a direct write.
4. Keep the Express server in compatibility-read-only mode for migrated fields.
5. Add explicit logging to every path that attempted a legacy mutation so the team can detect remaining stale writers before cutover.

---

## Section 2 – Atomic mutation model

### Objective

Define the required Firestore transaction for the migrated operations and ensure each transaction contains exactly the required atomic writes.

### Transaction types

#### 2.1 Readout transaction

Required atomic operation:

- one readout receipt is created or deduplicated
- one competitor projection is updated if matched
- one outbox event is emitted
- one counter or result projection update is performed if required by the operation model

Transaction boundaries:

- Start transaction
- Read:
  - competition doc
  - competitor doc if SI matches
  - SI assignment doc if lookup is required
  - operation receipt/tombstone doc
  - counter doc if required
- Validate:
  - role + competition state
  - SI assignment exists or is `UNKNOWN`
  - operation ID is permissible
  - payload hash matches stored hash if same ID is retried
- Write:
  - create or update receipt doc
  - update competitor projection if matched
  - update counters if required
  - append outbox event
  - mark operation as processed or rejected
- Commit

Failure behavior:

- If any read fails or validation fails, the transaction aborts without committing state.
- If the same operation ID already exists with same payload, return the stored result without changing data.
- If the same operation ID exists with different payload, reject the operation and do not mutate anything.

Retry behavior:

- Retry at the client queue layer using the same `clientReadoutId`.
- Do not create a second logical mutation.

#### 2.2 Competitor update transaction

Required atomic operation:

- update the competitor document
- update the SI assignment when SI or card metadata changes
- emit an outbox event if changed state must be visible externally

Transaction boundaries:

- Read:
  - competitor doc
  - current SI assignment doc if SI is involved
  - optional version doc or sequence doc
- Validate:
  - role + competition owner + lifecycle state
  - unique SI assignment rule
  - no readout/result mutation outside allowed slice
- Write:
  - competitor doc patch
  - SI assignment update or retirement
  - outbox event
- Commit

Failure behavior:

- The transaction aborts if the SI is duplicate or any validation fails.
- Existing unchanged competitor state remains stable.

Retry behavior:

- Retry the same request ID if the backend call times out after the transaction is committed; the operation must be idempotent.
- Never replay an unverified competitor update.

#### 2.3 Counter update transaction

Required atomic operation:

- update `competitorCount`, `finishedCount`, or other derived values as a projection
- emit an outbox event if the counter is operationally visible

Transaction boundaries:

- Read:
  - counter doc
  - competitor doc / mutation context
- Validate:
  - operation type is one that requires counter changes
  - fields are allowed to change
- Write:
  - increment or decrement counters
  - reconcile against current state if required
- Commit

Failure behavior:

- If the counter update fails, the entire operation fails and the caller receives the transaction error.

Retry behavior:

- Counters must be idempotent at the operation level; the operation ID must be unique and retried safely.

#### 2.3 Receipt creation transaction

Required atomic operation:

- create or validate a receipt doc
- map the receipt to competitor state or mark as `UNKNOWN`
- write the outbox event if the receipt event is externally visible

Transaction boundaries:

- Read:
  - receipt doc by `clientReadoutId` or `clientPunchId`
  - competitor doc if a match exists
  - SI assignment doc if readout resolves by SI
- Validate:
  - input payload is valid
  - same ID with same payload is safe
  - same ID with different payload rejects
- Write:
  - receipt doc
  - competitor doc update if matched
  - outbox event
- Commit

Failure behavior:

- Without a successful commit, no receipt or competitor state change is visible.

#### 2.4 Outbox event transaction

Required atomic operation:

- one canonical mutation is committed
- one outbox event document is written in the same transaction

Transaction boundaries:

- Same transaction as the mutation it represents.

Document structure:

```json
{
  "id": "event-uuid",
  "operationId": "clientReadoutId|clientPunchId|competitorUpdateId",
  "competitionId": "...",
  "entityType": "competitor|readout|punch|counter",
  "entityId": "...",
  "eventType": "created|updated|retired|deleted|receipt|counter",
  "payload": { "..." },
  "createdAt": "timestamp",
  "status": "pending|sent|acked|failed",
  "attempts": 0,
  "lastError": null
}
```

Failure behavior:

- If the outbox write fails, the entire mutation transaction fails.

Retry behavior:

- Retry outbox delivery with exponential backoff and dedupe on `id`.
- Consumers must treat delivery as at-least-once.

---

## Section 3 – Idempotency implementation

### Objective

Prevent duplicate logical writes and reject conflicting replays.

### Key rules

- same `clientReadoutId` + same payload = safe retry
- same `clientReadoutId` + different payload = reject
- same `clientPunchId` + same payload = safe retry
- same `clientPunchId` + different payload = reject
- no retry may create two different receipt records for the same operation ID

### Firestore documents involved

- `competitions/{competitionId}/readoutReceipts/{clientReadoutId}`
- `competitions/{competitionId}/stationPunches/{clientPunchId}`
- `competitions/{competitionId}/operationTombstones/{operationId}`
- `competitions/{competitionId}/competitors/{competitorId}`
- `competitions/{competitionId}/siCardAssignments/{siNumber}`
- `competitions/{competitionId}/outbox/{eventId}`

### Storage layout

For each operation ID, store a receipt or tombstone record with enough information to reject conflicting payloads.

Suggested layout:

```json
{
  "operationId": "clientReadoutId",
  "competitionId": "...",
  "entityType": "readout",
  "payloadHash": "sha256(...)",
  "status": "accepted|rejected|unknown",
  "createdAt": "timestamp",
  "updatedAt": "timestamp",
  "result": {
    "matchedCompetitorId": "...",
    "outcome": "PROCESSED|UNKNOWN|REJECTED"
  }
}
```

For a tombstone:

```json
{
  "operationId": "...",
  "entityType": "readout",
  "payloadHash": "...",
  "decision": "REJECTED_CONFLICT",
  "reason": "duplicate operation id with different payload",
  "createdAt": "timestamp"
}
```

### Validation flow

1. Compute payload hash from the request payload.
2. Look up the operation ID in the receipt/tombstone collection.
3. If no record exists, proceed.
4. If the record exists with the same hash, return the previous success result.
5. If the record exists with a different hash, reject with a conflict error.
6. In the same transaction, write the receipt or tombstone and all dependent mutation data.

### Required implementation tasks

- Add deterministic operation IDs to client queue items.
- Generate and store `payloadHash` as part of every accepted retryable operation.
- Add a cross-check in the backend before writing any competitor update or receipt.
- Reject duplicate IDs with conflicting payloads before any mutation is performed.
- Ensure the same operation cannot generate an outbox event twice.

---

## Section 4 – Snapshot protection

### Objective

Protect migrated competitor domains from stale snapshot, export, hydrate, and restore corruption.

### Required protected paths

- `cloud-export`
- `cloud-hydrate`
- `syncFullSeasonToFirestore`
- `state:sync`

### Protection model

A migrated domain must never be overwritten by a snapshot whose source is older than the canonical Firestore value.

Required rules:

1. Snapshot writes are read-only for migrated competitor fields.
2. If `snapshot.updatedAt` < Firestore `updatedAt`, ignore the snapshot.
3. If `snapshot.updatedAt` == Firestore `updatedAt`, only accept a write if the payload hash is identical and the operation is known to be idempotent.
4. If `snapshot.updatedAt` > Firestore `updatedAt`, accept only through an explicit migration override and an audit log.
5. Never allow a full-season sync or cloud restore to delete a Firestore doc if the Firestore doc is newer.
6. Never allow `state:sync` to overwrite a canonical competitor record.

### Migration guard specification

A guard function must implement the following:

```text
function canApplySnapshotWrite(firestoreDoc, snapshotDoc, operationType): boolean
  if snapshotDoc is null -> false
  if operationType is not an allowed migration override -> false
  if firestoreDoc.updatedAt > snapshotDoc.updatedAt -> false
  if firestoreDoc.updatedAt == snapshotDoc.updatedAt and payloadHash differs -> false
  if firestoreDoc is missing and snapshotDoc is a new record -> allow once
  if migration override is set and audited -> allow
  otherwise -> false
```

### Required implementation tasks

- Add the guard to all snapshot import and sync functions.
- Reject imports that try to overwrite active competing competitor data.
- Add explicit logs when a snapshot is rejected as stale.
- Add a reconciliation job that compares snapshot state to Firestore state and reports drift without mutating the canonical docs.

### overwrite / delete / rollback corruption cases to protect against

- Overwrite: snapshot tries to replace newer Firestore fields with older values.
- Delete: legacy snapshot deletes a competitor doc that exists in Firestore but not in the stale snapshot.
- Rollback corruption: a failed rollback or stale JSON restore repopulates the app with old values and creates a split-brain state.

---

## Section 5 – Outbox implementation

### Objective

Create a durable outbox that ensures every accepted mutation results in a corresponding outbox event.

### Rules

- One mutation = one outbox event.
- Outbox writes must happen in the same Firestore transaction as the mutation.
- Outbox delivery is at-least-once.
- Duplicate event IDs are ignored.
- Replayed events must not duplicate the logical mutation.

### Document structure

```json
{
  "id": "evt-uuid",
  "competitionId": "...",
  "entityType": "competitor|readout|punch|counter",
  "entityId": "...",
  "operationId": "...",
  "eventType": "created|updated|retired|deleted|receipt|counter",
  "payload": { "..." },
  "status": "pending",
  "attempts": 0,
  "createdAt": "timestamp",
  "updatedAt": "timestamp",
  "lastError": null
}
```

### Processing rules

1. Producer creates mutation and outbox event in the same transaction.
2. A consumer or worker reads `status = pending` rows.
3. Delivery attempts are retried with a bounded backoff.
4. Successful delivery sets `status = sent` and records ack metadata.
5. Failed delivery leaves `status = pending` or `failed` with `attempts++`.
6. Consumer deduplication is by event `id`, not by payload hash alone.

### Cleanup strategy

- Retain outbox rows long enough for at-least-once replay and operational auditing.
- Maintain a compact retention window for completed events.
- Do not delete rows until ack is confirmed and the retention window has passed.

### Retry strategy

- exponential backoff
- bounded retry attempts
- explicit dead-letter status after max retries
- alerting on stuck outbox row

### Crash-safe behavior

- If the server crashes after the mutation commit but before outbox delivery, the outbox row remains pending and is replayed later.
- If the server crashes before the mutation transaction completes, the mutation is rolled back and no outbox row is emitted.

---

## Section 6 – Validation & Test Plan

### 6.1 Readout tests

#### Test: known card

- Submit a valid readout with a matched SI assignment.
- Expected result: receipt created, competitor projection updated, outbox event written once.
- Failure modes: assignment missing, role unauthorized, duplicate operation ID.

#### Test: unknown card

- Submit a readout for an SI number that does not match an active competitor.
- Expected result: receipt created with `UNKNOWN`, no competitor created, outbox event indicates unknown receipt.
- Failure modes: system invents a competitor, receipt is dropped, duplicate unknown event is emitted.

#### Test: duplicate readout

- Submit the same readout twice with the same `clientReadoutId`.
- Expected result: second call returns stored outcome without a second mutation.
- Failure modes: second mutation creates double write or second outbox event.

#### Test: retry after timeout

- Simulate a timeout after mutation is committed but before UI receives a response.
- Expected result: retry with same ID returns same result and no second mutation.
- Failure modes: duplicate state mutation or duplicate outbox event.

#### Test: offline queue recovery

- Queue a readout, restart the app, replay the same operation ID.
- Expected result: one logical readout result, one receipt, no duplicate updates.
- Failure modes: duplicate operation or partial rollback.

### 6.2 Competitor tests

#### Test: create competitor

- Create a valid competitor with unique SI.
- Expected result: competitor doc created, SI assignment created, outbox event written.
- Failure modes: assignment missing, partial commit, stale snapshot overwrite.

#### Test: edit competitor

- Change metadata such as `bib`, `club`, `classId`, or SI assignment.
- Expected result: updated field is written once in Firestore, mirror update follows, no stale snapshot overwrites it.
- Failure modes: update is lost, stale snapshot wins, duplicate SI assignment occurs.

#### Test: delete competitor

- Attempt delete for active competitor with references.
- Expected result: delete rejected or converted to retire/tombstone.
- Failure modes: silent hard delete, historical dependency loss.

#### Test: retire competitor

- Retire a competitor that is no longer active.
- Expected result: competitor remains retrievable and historical data remains intact.
- Failure modes: delete state used instead of retirement, historical records lost.

#### Test: duplicate SI number

- Try to create two competitors with same SI number.
- Expected result: second creation fails deterministically.
- Failure modes: second record created, assignment overwritten.

### 6.3 Concurrent operations

#### Test: simultaneous readouts

- Send multiple readouts with different IDs at the same time.
- Expected result: each receipt is captured once with correct ordering and no cross-mutation corruption.
- Failure modes: lost update or receipt overwrite.

#### Test: simultaneous registrations

- Create two competitor records for same SI at the same time.
- Expected result: only one succeeds.
- Failure modes: duplicate assignment, split-brain competitor creation.

#### Test: simultaneous punches

- Send multiple punch operations for the same competitor at the same time.
- Expected result: all are accepted idempotently or rejected according to the rule; no doubled outbox events.
- Failure modes: duplicate punch handling or lost punch event.

### 6.4 Recovery tests

#### Test: server restart

- Restart the backend after mutation acceptance but before outbox delivery.
- Expected result: outbox replay completes or the pending event remains recoverable.
- Failure modes: lost event or inconsistent mutation state.

#### Test: rollback

- Simulate a rollback to a previous version while the system has a newer Firestore write.
- Expected result: rollback does not restore stale `seasonDb` as the authoritative writer.
- Failure modes: stale snapshot restored, Firestore overwritten.

#### Test: stale snapshot attempt

- Attempt to hydrate a stale snapshot after a newer Firestore write.
- Expected result: stale snapshot is rejected or ignored.
- Failure modes: Firestore overwritten with older values.

---

## Section 7 – Readiness Gate

### P0 complete checklist

#### [ ] Not started

- [ ] Identify and disable all legacy competitor mutation routes.
- [ ] Identify and disable all stale snapshot writers.
- [ ] Confirm no mixed-authority writes remain in the app state flow.
- [ ] Define and deploy the single-writer backend boundary.
- [ ] Define readout and competitor transaction rules.
- [ ] Implement idempotency and payload hash validation.
- [ ] Implement outbox and delivery rules.
- [ ] Implement snapshot guards and stale-write rejection.
- [ ] Validate duplicate SI and concurrent registration paths.
- [ ] Validate rollback, stale snapshot, and server restart recovery.

#### [ ] In progress

- [ ] Current architecture design and requirements documentation.
- [ ] Legacy path inventory and migration blocker list.
- [ ] Planned transaction and idempotency model.
- [x] `syncFullSeasonToFirestore` blocks updates and deletions of existing Firestore competitor documents from legacy snapshots, with changed-field and omission logging; Express compatibility routes log protected-field writes.
- [ ] Fence all remaining legacy mutation routes and snapshot-mediated create paths.
- [ ] Validate the snapshot guard and remaining writer boundaries in the deployed environment.

#### [ ] Complete

- [ ] Architecture and migration documents are approved.
- [ ] P0 risk list is converted to concrete implementation tasks.
- [ ] Required single-authority design is accepted.
- [ ] Required transaction, retry, and guard rules are documented.
- [ ] Validation matrix is approved.

### Final decision

Status: NOT READY

Reason:

The project has completed the design work and identified the required P0 tasks. Initial client-rule fencing is now implemented, but legacy/Admin SDK writer fencing, single-writer enforcement, and operational validation are not yet proved. Until these are implemented and tested, the system cannot be considered ready for uniqueness enforcement or Competitor Phase 2.

The project is ready for the next stage only after the P0 implementation plan above has been executed, validated, and the readiness gate is passed.

---

## Output summary

This document converts the architecture P0 risks into an implementation roadmap. It clarifies what must be disabled, how the Firestore transaction model should work, how idempotency is enforced, how stale snapshots are prevented, and how the system is validated before any Phase 2 competitor CRUD migration begins.

The competitor snapshot guard is implemented for `syncFullSeasonToFirestore`; restore and cloud hydrate now block competitor identity changes. Remaining Express/Admin SDK mutation routes, import updates, and create/resurrection paths still require redirection or disabling before uniqueness enforcement.

Atomic SI Matching Phase B is read-only. Phase C uniqueness enforcement remains blocked on single-writer authority, stale-writer fencing, historical duplicate inventory, and atomic competitor/assignment transaction validation.

The Phase A/B assignment schema and Firestore rules are aligned: `state` is the canonical lifecycle field; `schemaVersion` is required and fixed at `1`; timestamps use Firestore `Timestamp`; and required versus optional fields are enforced consistently by the parser and rules. Phase C creates, retires, deletes, and reassigns assignments atomically through the client transaction for covered paths. P0 Step 7 requires paired client writes but does not implement uniqueness, reject duplicates, establish a trusted server writer, or provide durable audit. Phase C uniqueness enforcement remains blocked by the gates above.

P0 Steps 2–7 add a shared mutation diagnostics/service, assignment-aware client transactions, and an initial Firestore client-rule fence. Restore and cloud hydrate reject or preserve changes to competitor identity, but legacy Express/Admin SDK writers remain outside the transaction and rules. Duplicate candidate scans are diagnostic and not a concurrency guarantee; uniqueness remains disabled. Phase C uniqueness enforcement remains blocked until all writers are routed through a trusted transaction, bypasses are fenced, and concurrency/rollback tests pass.
