# Competitor Cutover Readiness

Status: documentation reassessment, 2026-11-10.

## Executive summary

**Readiness: NO-GO for competitor identity ownership cutover and global SI uniqueness enforcement.**

Readout auto-create has been migrated: the Firestore path atomically creates the competitor, active SI assignment, receipt, and count projections, while the Express readout and online-punch processors no longer create competitor identities. This closes that specific identity-writer bypass. It does not resolve the other legacy writers or prove all-writer uniqueness and operational enforcement.

The existing Firestore transaction paths for create, SI change, retirement, and reassignment and the initial Firestore client-rule fence are meaningful progress. The remaining gap is a single enforced authority boundary for every identity writer, backed by operational validation.

## Completed migration work relevant to this assessment

- ClubSettings, RunnerDb, Courses, Classes, and competition metadata migrations.
- Atomic SI Matching Phases A, B, and C0; assignment create, delete/retire, and reassign paths.
- Cloud-hydrate competitor identity fence.
- Readout auto-create moved to the Firestore transaction flow; Express readout identity creation removed.
- Legacy snapshot updates to existing competitor documents and snapshot-driven deletions are blocked by `syncFullSeasonToFirestore`; snapshot seeding of missing records and other imports still require review.
- Firestore client rules require paired assignment writes for covered competitor create/SI-change/delete operations. This is not a trusted backend boundary and does not constrain Admin SDK writers.

## Canonical active blocker list

This is the single source of truth for active competitor-ownership cutover blockers. The [legacy writer inventory](./LEGACY_WRITER_INVENTORY.md) and [readout auto-create migration record](./READOUT_AUTO_CREATE_MIGRATION_PLAN.md) refer here rather than maintaining separate blocker lists.

1. **Legacy Express competitor CRUD and direct-entry paths:** `POST /api/competitors`, `PUT /api/competitors/:id`, `DELETE /api/competitors/:id`, and related UI/fallback writers can still mutate identity outside the canonical Firestore assignment transaction.
2. **Eventor, IOF, and batch imports:** identity creation or updates from import paths are not all routed through the canonical transaction and assignment ownership boundary.
3. **Restore, reset/seed, clear-demo, and competition deletion:** these paths can still rehydrate, remove, or seed competitor state without a complete assignment-aware lifecycle operation.
4. **Remaining snapshot/import writer paths:** full-season snapshot seeding of missing documents and bulk import writes need a controlled, assignment-aware policy; the guard for updates/deletions of existing competitor documents does not close these create/import paths.
5. **Single-writer enforcement and validation:** diagnostics are not enforcement. Establish and verify the production authority boundary for every remaining writer, reconcile existing duplicate/conflicting SI data, and validate uniqueness, retries, rollback, and concurrent mutations. Firestore emulator/integration and deployed-rule evidence is still required.

The Express `/api/readout` compatibility path remains a readout/result-mirror concern: it does not create competitor identity, but it does not replace the canonical Firestore receipt/result flow. It is not the former readout auto-create identity blocker; complete readout/result ownership remains a separate cutover concern.

## Readiness basis

- **Design:** sufficiently documented.
- **Implementation:** partial; atomic assignment transactions exist for covered paths, but legacy writers remain.
- **Operational/safety validation:** incomplete; repository notes do not establish deployed trusted-server enforcement, all-writer coverage, historical conflict reconciliation, or successful concurrency/rollback validation.

Therefore, do not enable global uniqueness enforcement or declare competitor ownership fully cut over until every item in the canonical list is closed and verified.

## Contradictions found and resolved in this document set

- `READOUT_AUTO_CREATE_MIGRATION_PLAN.md` previously described the legacy `POST /api/readout` competitor-creation branch as current and an active P0 blocker. That description is now explicitly historical; the migration and current behavior are recorded there and in [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md).
- `LEGACY_WRITER_INVENTORY.md` previously marked readout auto-create as a remaining blocker and repeated outdated readout claims in its final assessment. It now marks that writer migrated and points to this canonical blocker list.
- Earlier readiness notes described the assignment schema/transactions as not implemented. Current implementation has assignment create/retire/reassign paths and a client-rule fence, but not global uniqueness or a trusted all-writer boundary. This document distinguishes those milestones from the remaining blockers.
- The legacy readout endpoint's ongoing compatibility role must not be conflated with identity auto-create: its readout/result persistence limitations remain, but the identity-creation branch was removed.

## References

- [COMPETITOR_READOUT_ARCHITECTURE.md](./COMPETITOR_READOUT_ARCHITECTURE.md)
- [P0_IMPLEMENTATION_PLAN.md](./P0_IMPLEMENTATION_PLAN.md)
- [LEGACY_WRITER_INVENTORY.md](./LEGACY_WRITER_INVENTORY.md)
- [READOUT_AUTO_CREATE_MIGRATION_PLAN.md](./READOUT_AUTO_CREATE_MIGRATION_PLAN.md)
- [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md)
