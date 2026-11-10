# Readout Auto-Create Migration Record

Status: **MIGRATED** — 2026-11-10.

This document preserves the reason readout auto-create was a blocker and records the implemented replacement. The current status and any remaining system-level blockers are maintained in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md). Readout auto-create is not on that active blocker list.

## Current implementation

When runner-database auto-create is enabled for an unmatched SI number, the Firestore readout helper creates the competitor, active `siCardAssignments/{siNumber}` document, immutable readout receipt, and competition count projections in one Firestore transaction. A stable `clientReadoutId` makes retries idempotent; reuse of the ID with different input is rejected.

If assignment ownership already exists, duplicate competitor candidates are found, the duplicate scan fails, runnerDb identity changed, or the proposed competitor ID is occupied, the operation records an `UNKNOWN` receipt without creating competitor identity or an assignment. The SI assignment document serializes competing claims for the same unassigned SI.

The Express `/api/readout` and online-punch processing paths no longer create competitor identities in `seasonDb`. The durable offline-readout queue submits to the Firestore helper. The implementation and validation notes are in [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md).

## Historical blocker: pre-migration behavior

Before the migration, the Express readout/online-punch flow looked up an unmatched SI number in `seasonDb.runnerDb`. With auto-create enabled, it synthesized a competitor with a locally generated ID, inserted it into the active event's competitor list, persisted the season snapshot, and broadcast state.

That write had no canonical SI assignment, no atomic ownership check, and no Firestore transaction. Two concurrent or divergent clients could create event-local competitors for the same card; identity could then drift from Firestore, and rollback had no paired assignment lifecycle operation. Diagnostics only observed the write and did not prevent it. For these reasons readout auto-create was correctly treated as a critical identity ownership blocker before migration.

The historical description above is not a description of current runtime behavior. The old local insertion, ID generation, and season snapshot identity write were removed.

## Scope and remaining limitations

- The migration closes the specific readout auto-create identity bypass; it does not resolve other legacy competitor writers. Refer to the canonical list in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).
- The Firestore Web SDK remains the transaction client. Rules constrain the narrow readout create path, but a trusted server/Functions boundary remains the target for privileged writes and complete all-writer enforcement.
- Duplicate competitor lookup occurs before the transaction because Web SDK transactions cannot query. Query failure is fail-closed, and the assignment document is the concurrency lock for simultaneous new claims.
- Express `/api/readout` remains a compatibility processor for existing competitors/local live-event data; it does not replace canonical Firestore readout receipts and result processing.
- Firestore emulator tests require a running emulator. The implementation record states that build and TypeScript lint/type-check were the required validation; it does not claim emulator validation.

## Historical migration approach

The original plan was to remove the Express fallback, preserve unmatched cards as unknown, and then create identity only through an atomic competitor-plus-assignment transaction. The implementation followed that safe direction, with the readout receipt and count projections included in the same transaction. The old phase checklist is superseded by the implementation record and this current status; do not treat it as pending work.

## Rollback

Disable `autoCreateFromRunnerDbOnReadout` to stop new automatic creation while retaining unknown readout receipts. Do not restore the Express auto-create branch. Reversing an auto-created competitor must use the canonical retirement/deletion flow; preserve its immutable readout receipt.
