# Competitor + Readout Implementation Phases

This document breaks the Firestore-authoritative competitor/readout migration into ordered implementation phases. It is derived from:

- [COMPETITOR_READOUT_ARCHITECTURE.md](./COMPETITOR_READOUT_ARCHITECTURE.md)
- [P0_RESOLUTION_PLAN.md](./P0_RESOLUTION_PLAN.md)
- [CUTOVER_CHECKLIST.md](./CUTOVER_CHECKLIST.md)
- [MIGRATION-STATUS.md](./MIGRATION-STATUS.md)

The migration is intentionally incremental and layered. Each phase narrows the remaining legacy ownership without changing unrelated domains such as stations, ROC, Eventor, WebSocket, or result-processing beyond the required operational path.

## Phase summary

Historical phase records below document the payment/rental migration as it existed when those phases were completed. Fee/payment management has since been removed; only rental-card return tracking remains active, and legacy payment fields are ignored.

| Phase | Scope | Status | Estimated effort |
|---|---|---:|---:|
| Phase 1 | `feePaid`, `rentalReturned` | Completed | Small |
| Phase 2 | Competitor CRUD, SI ownership, deletion/retirement strategy | Planned | Medium |
| Phase 3 | `readoutReceipts` authority, `UNKNOWN` handling, idempotency | Planned | Large |
| Phase 4 | Online punches, `stationPunches` authority | Planned | Large |
| Phase 5 | Result-affecting mutations, manual finish, draw, status transitions | Planned | Large |
| Phase 6 | Live events and outbox delivery | Planned | Medium |
| Phase 7 | Retirement of competitor `seasonDb` ownership | Planned | Medium to large |

## Phase 1 — Completed: `feePaid` and `rentalReturned`

Status: Completed.

### Scope

- Make Firestore the canonical source for competitor billing and rental flags.
- Keep the rest of the competitor state legacy-controlled for now.
- Preserve Express compatibility mirrors for the old API routes.
- Protect the fields from stale snapshot updates and import/full-season sync overwrites.

### Affected files

- [src/firebase.ts](./src/firebase.ts)
- [src/App.tsx](./src/App.tsx)
- [src/components/AccessControlView.tsx](./src/components/AccessControlView.tsx)
- [firestore.rules](./firestore.rules)
- [firestore.rules.test.ts](./firestore.rules.test.ts)
- [MIGRATION-STATUS.md](./MIGRATION-STATUS.md)
- [SEASONDB_RETIREMENT_PLAN.md](./SEASONDB_RETIREMENT_PLAN.md)

### Prerequisites

- Existing Firestore competitor documents already include `feePaid` and `rentalReturned`.
- Admin and READOUT role matrix is already defined in the rules and the trusted backend policy.
- No change to status, times, readouts, punches, or result calculations.

### Validation scenarios

- Admin updates both billing flags and Firestore writes succeed before local UI and mirror updates.
- READOUT may change only `rentalReturned`, never `feePaid`.
- Existing full-season sync/import updates omit these fields for matching documents.
- A stale Express snapshot does not overwrite newer Firestore values.
- Rental overview and fee overview read Firestore values.

### Rollback strategy

- Revert the client to Express-driven billing updates without deleting the Firestore values.
- Keep the Firestore values as the recovery source during rollback.
- Restore the old Express mirror only after a compatibility recheck.

### Cutover requirements

- No change to the legacy competitor lifecycle or other competitor fields.
- Rules and read paths must be fully deployed before enabling UI writes to Firestore.
- Old API clients must remain compatible as mirror writers only.

### Estimated effort

- Small: focused to two fields, no result- or readout-flow changes.

---

## Phase 2 — Competitor CRUD, SI-number ownership, deletion/retirement strategy

### Scope

- Make Firestore authoritative for competitor creation, update, and deletion within the protected slice.
- Define SI-card ownership as a single authoritative assignment model.
- Define the competitor retirement/delete policy, including dependencies and validation.
- Keep all non-migrated competitor fields on the legacy path until later phases.

### Affected files

- [src/firebase.ts](./src/firebase.ts)
- [server.ts](./server.ts)
- [firestore.rules](./firestore.rules)
- [src/App.tsx](./src/App.tsx)
- Any competitor CRUD routes and admin screens depending on direct-entry, update, and delete flows

### Prerequisites

- Phase 1 is complete and the Firestore-first pattern is proven for a limited field slice.
- The authoritative ID model for competitors is final: existing competitor IDs remain stable.
- The role boundary and trusted backend execution model are approved by the P0 plan.
- The Firestore SI assignment model and uniqueness policy are agreed.

### Validation scenarios

- Create competitor in Firestore first, then mirror the created competitor to Express compatibility state only.
- Update competitor metadata without touching readout state, result state, or punch history.
- Attempt duplicate SI assignment and verify deterministic conflict handling.
- Retiring a competitor blocks unsafe deletion when there are active race references, direct dependencies, or historical receipts.
- Deletion is rejected when there are active references to the competitor ID or related records.

### Rollback strategy

- Keep Express as a compatibility mirror only; rollback means turning off the new Firestore-first mutation path and returning to the legacy mutation boundary, not reintroducing dual-write semantics.
- Preserve the competitor document ID and SI assignment mapping so data can be reconciled.
- If a Firestore write succeeds while the mirror fails, keep Firestore as the source of truth and reconcile the compatibility layer later.

### Cutover requirements

- Legacy mutation routes must be disabled or routed to the trusted operation backend.
- A strict SI uniqueness policy must be deployed before competitor creation or SI updates are allowed.
- Direct-delete validation must run before any competition or competitor removal is accepted.
- Duplicate/retired competitor records must not be silently replaced.

### Estimated effort

- Medium: concentrated around CRUD, ownership model, and validation but still limited to the competitor envelope.

---

## Phase 3 — `readoutReceipts` authority, `UNKNOWN` handling, retry and idempotency

### Scope

- Make Firestore the authority for accepted readout submissions.
- Store immutable readout receipts in `readoutReceipts`.
- Handle `UNKNOWN` receipts explicitly without creating a fake competitor.
- Enforce idempotency and retries using stable client operation IDs.

### Affected files

- [src/firebase.ts](./src/firebase.ts)
- [server.ts](./server.ts)
- [firestore.rules](./firestore.rules)
- [src/App.tsx](./src/App.tsx)
- Offline queue and readout submission clients
- Firestore collection rules and migration helpers for `readoutReceipts`

### Prerequisites

- Phase 2 delivered competitor identity and SI-card assignment ownership.
- The trusted backend accepts readout operations and verifies role and competition state.
- The readout queue stores stable operation IDs and payload hashes.

### Validation scenarios

- Submit the same readout twice with the same operation ID and verify only one logical mutation occurs.
- Submit the same payload with a different ID and verify idempotency is enforced at the logical operation level without corrupting history.
- `UNKNOWN` card readout creates a receipt but does not invent a competitor.
- A matched readout updates the competitor and writes the receipt in the same transaction.
- Retry after timeout preserves the same receipt ID and outcome.
- Rejected readouts must not create side-effects or competitor state changes.

### Rollback strategy

- Keep a read-only compatibility mirror while new receipt writes are disabled.
- If any receipt is accepted only in Express, replay the queue into Firestore once the canonical path is restored.
- Never silently drop a readout receipt during rollback; preserve the original payload and operation ID.

### Cutover requirements

- The client offline queue must provide stable IDs across app restart.
- The backend must enforce operation-id deduplication before mutating competitor state.
- The `UNKNOWN` path must be clear to UI and operations staff, with a known recovery flow.
- At least-once delivery is okay, but logical mutation must be idempotent.

### Estimated effort

- Large: includes receipt modeling, queue semantics, transaction boundaries, and deduplication rules.

---

## Phase 4 — Online punches and `stationPunches` authority

### Scope

- Make Firestore authoritative for online/radio punch receipts.
- Capture station function and raw receipt data at the time of submission.
- Prevent stale station configuration from changing the meaning of historical punch data.

### Affected files

- [src/firebase.ts](./src/firebase.ts)
- [server.ts](./server.ts)
- [firestore.rules](./firestore.rules)
- Station processing and online-punch entry paths
- UI and queue components for punch submission and retry

### Prerequisites

- Phase 3 has proven receipt authority and idempotency.
- Station configuration is separated from runtime telemetry and historical station function semantics are preserved.
- Online punch matching logic is deterministic and does not depend on current `seasonDb` snapshots.

### Validation scenarios

- Punches submitted twice with the same operation ID are not applied twice.
- Station function is captured in the receipt and not reinterpreted later from live station configuration.
- Punch matched to a competitor updates the correct competitor state only when the authoritative assignment is valid.
- Duplicate or stale punch IDs are rejected or recognized as duplicates.
- A punch with no current competitor assignment is accepted as a receipt and handled through the proper unmatched flow.

### Rollback strategy

- Preserve the raw punch receipt and underlying station metadata even if a punch update to the competitor state is rolled back.
- Rebuild or replay the transformed punch effect from the receipt history if needed.
- Do not rewrite historical punch receipts during rollback.

### Cutover requirements

- Firestore must contain immutable station punch receipts before any UI or processing path treats them as canonical.
- Client and server deduplication must use the same operation identity and payload hash semantics.
- The legacy Express punch path must be fenced before the Firestore punch path is treated as authoritative.

### Estimated effort

- Large: because punch semantics interact with competitors, readouts, station configuration, and derived result logic.

---

## Phase 5 — Result-affecting mutations, manual finish, draw, and status transitions

### Scope

- Move result-affecting mutations to Firestore-authoritative logic.
- Preserve explicit official decisions such as manual finish or status override.
- Ensure draw order and status transitions are processed through the same canonical path.
- Rebuild result calculations from canonical records and configuration without depending on stale JSON state.

### Affected files

- [src/firebase.ts](./src/firebase.ts)
- [server.ts](./server.ts)
- [src/App.tsx](./src/App.tsx)
- `status` and result calculation logic
- Any manual finish/draw/admin mutation handlers

### Prerequisites

- Readout receipts and station punch receipts are authoritative.
- The competitor document can represent both current projection and explicit official overrides.
- Calculation inputs and versioning are defined (courses, classes, emergency settings, and result algorithms).

### Validation scenarios

- Manual finish updates the official finish time and recalculation respects it.
- Draw and start/finish transition changes are recorded and not overwritten by stale Express state.
- Recalculation after emergency configuration or allowed correction produces deterministic output.
- A status update that is not result-affecting remains isolated from unsupported logic.
- Explicit official override is distinguishable from a computed value.

### Rollback strategy

- Roll back the UI to the compatibility projection but retain Firestore as the data source for result replay.
- Recompute from receipts and versioned configuration to rebuild affected competitor state if a result-affecting mutation is rolled back.
- Avoid reintroducing a dual-writer state where Express and Firestore both mutate the same result projection.

### Cutover requirements

- All result-affecting updates must pass the trusted backend rule set.
- Recalculation and status updates must be versioned and testable.
- Manual finish and official override actions require explicit authorization and auditability.

### Estimated effort

- Large: because this is the highest-risk operational slice and includes result integrity semantics.

---

## Phase 6 — Live events and outbox pattern

### Scope

- Replace direct live-event mutation broadcasting with an outbox/event-delivery pattern.
- Make event publication part of the same transaction as the canonical mutation.
- Ensure event delivery is at-least-once and deduplicated by event ID.

### Affected files

- [src/App.tsx](./src/App.tsx)
- [server.ts](./server.ts)
- Firestore event/outbox collections and consumer code
- WebSocket adapter and local live-state consumers

### Prerequisites

- Competitor and readout mutation paths are already Firestore-authoritative.
- Event consumers can tolerate at-least-once delivery and deduplicate by event ID.
- Transaction boundaries and outbox write semantics are agreed.

### Validation scenarios

- A competitor update writes the outbox event in the same transaction as the canonical mutation.
- Retry of the same client operation does not publish duplicate events.
- Delivery failure does not lose the event; the queue remains pending until a retry succeeds.
- Crash recovery replays pending outbox items without double-applying any event.
- Live consumers rehydrate from Firestore or rebuild state from canonical data.

### Rollback strategy

- If event delivery fails, keep the outbox item and do not mutate the canonical state again.
- Re-enable legacy live-state consumers only after durable event replay is proven stable.
- Do not let outbox delivery create a second, untracked mutation path.

### Cutover requirements

- Event consumers must be dedupe-safe.
- No live-state writer may bypass the outbox pattern.
- A transaction that writes canonical state without a corresponding outbox event is a no-go.

### Estimated effort

- Medium: concentrated on event emission, deduplication, and replay reliability.

---

## Phase 7 — Retirement of competitor `seasonDb` ownership

### Scope

- Retire the remaining competitor state from the Express/JSON `seasonDb` ownership model.
- Keep only compatibility mirrors and derived read models.
- Ensure full export/hydrate, restore, and snapshot workloads cannot overwrite newer Firestore competitor state.

### Affected files

- [src/firebase.ts](./src/firebase.ts)
- [server.ts](./server.ts)
- [src/App.tsx](./src/App.tsx)
- Cloud export/hydrate/restore paths
- Any remaining legacy snapshot synchronization

### Prerequisites

- All prior phases are complete and validated.
- Firestore is the source of truth for the full competitor lifecycle, reads, receipts, punches, direct entry, and status/result logic.
- Outbox and event publication are upstream of the final removal.

### Validation scenarios

- Full-season sync cannot overwrite newer competitor values or delete newer Firestore state.
- Cloud export and hydrate jobs read from Firestore and write backward-compatible mirror data only.
- Legacy snapshot rebuilds do not re-create a competing writer.
- Competitor IDs and history remain stable across migration and rollback.
- Rollback preserves the ability to restore a compatibility mirror without losing canonical Firestore state.

### Rollback strategy

- Rollback means restoring compatibility readers, not re-enabling competitor writes in Express as primary sources.
- Keep a read-only export of the final Firestore canonical state before retirement.
- If a consumer still depends on the legacy mirror, rebuild it from Firestore using the compatibility schema.

### Cutover requirements

- All legacy mutation paths to competitor state are fenced or redirected.
- In-flight queued operations are flushed and reconciled before ownership is retired.
- A final migration sign-off is required from operations and data owners.

### Estimated effort

- Medium to large: primarily integration cleanup and proving the final retirement of `seasonDb` ownership.

---

## Recommended implementation order

1. Phase 1 completes the small field-slice proof.
2. Phase 2 establishes the ownership and validation model for competitor CRUD and SI assignment.
3. Phase 3 establishes the durable receipt/integration layer for readouts.
4. Phase 4 handles online punches and the associated historical evidence.
5. Phase 5 moves result-affecting decisions and manual overrides to canonical logic.
6. Phase 6 adds durable live event publication via outbox.
7. Phase 7 removes remaining legacy ownership and compatibility-only path assumptions.

## Exit criteria for the full migration

- Firestore is authoritative for competitor creation, mutation, receipts, punch receipts, deduplication, and result-affecting changes.
- Express `seasonDb` is only a compatibility mirror and no longer the writer of canonical competitor state.
- Every mutation path has an idempotent, retriable operation ID.
- The outbox is durable, deduplicated, and recoverable.
- No stale snapshot or cloud restore can reintroduce a competing authoritative copy.
- Rollback can be performed without data loss and without forcing a dual-writer state.
