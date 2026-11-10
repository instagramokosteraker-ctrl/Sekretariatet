# Competitor Cutover Readiness

Status: post competition-deletion disablement assessment, 2026-11-10.

## Executive summary

**Readiness: NO-GO for competitor identity ownership cutover and global SI uniqueness enforcement.**

Readout auto-create has been migrated: the Firestore path atomically creates the competitor, active SI assignment, receipt, and count projections, while the Express readout and online-punch processors no longer create competitor identities. This closes that specific identity-writer bypass. It does not resolve the other legacy writers or prove all-writer uniqueness and operational enforcement.

The existing Firestore transaction paths for direct entry, SI change, retirement, reassignment, readout, import, and snapshot seeding, plus the strengthened Firestore client-rule fence, are meaningful progress. Import and missing-record snapshot seeds now validate or create the matching SI assignment in the same transaction as each competitor write. Eventor/IOF Express competitor imports are disabled or redirected to that canonical flow. Competition deletion, clear-all, and demo reset are explicitly disabled because the current rules and transaction boundaries cannot safely resolve every assignment. Trusted-writer enforcement and production-wide uniqueness still require migration or operational validation.

## Completed migration work relevant to this assessment

- ClubSettings, RunnerDb, Courses, Classes, and competition metadata migrations.
- Atomic SI Matching Phases A, B, and C0; assignment create, delete/retire, and reassign paths.
- Cloud-hydrate competitor identity fence.
- Readout auto-create moved to the Firestore transaction flow; Express readout identity creation removed.
- Legacy `POST /api/competitors`, `PUT /api/competitors/:id`, and `DELETE /api/competitors/:id` are disabled with HTTP 410 responses. First-party direct-entry, competitor update, and delete UI flows now call Firestore mutation helpers directly; they no longer use Express CRUD as a prerequisite or fallback.
- Direct-entry competitor creation now rejects existing SI assignment/competitor conflicts and duplicate-scan failures before writing. SI reassignment rejects assignment conflicts and duplicate-scan failures in the transaction path.
- Legacy snapshot updates to existing competitor documents and snapshot-driven deletions are blocked by `syncFullSeasonToFirestore`; missing-record snapshot seeds now atomically create and validate the matching SI assignment.
- Firestore client rules now verify matching competitor ID, assignment ID, SI number, competition ID, and owner for creates and SI reassignment. The rules do not constrain Admin SDK writers; import/snapshot creation now writes the matching assignment in the same transaction.
- Firestore import creates and same-identity updates now validate SI assignment ownership inside per-competitor transactions. Import-driven SI/card-series changes are rejected and must use the canonical reassignment flow.
- Eventor competitor import is disabled with HTTP 410. IOF competitor entries are rejected by the Express import mirror; authenticated IOF import writes competitors through the Firestore transaction path and no longer mirrors entries to Express.
- Firestore competition deletion is denied by rules and the client deletion helper fails closed. Express competition deletion, clear-demo, and reset-seed return HTTP 410; the UI no longer offers delete/clear actions. Backup restore rejects competition-ID-set changes, as well as the existing protected competitor identity changes.

## Canonical active blocker list

This is the single source of truth for active competitor-ownership cutover blockers. The [legacy writer inventory](./LEGACY_WRITER_INVENTORY.md) and [readout auto-create migration record](./READOUT_AUTO_CREATE_MIGRATION_PLAN.md) refer here rather than maintaining separate blocker lists.

1. **Trusted-writer enforcement and production-wide uniqueness validation (highest priority):** Firestore client rules do not constrain Admin SDK writers. Establish and verify the production authority boundary, reconcile existing duplicate/conflicting SI data, and validate uniqueness, retries, rollback, and concurrent mutations. Emulator and deployed-rule evidence is still required.

Competition deletion and destructive season-reset paths are disabled rather than migrated. This is a deliberate capability restriction, not an assignment-aware deletion implementation. Backup restore cannot change the competition set or protected competitor identity fields. The three legacy competitor CRUD routes and their first-party UI callers are no longer active blockers. Firestore import and snapshot writes are assignment-aware, and Eventor/IOF Express competitor import writes are disabled or redirected to the canonical Firestore path.

**What is the single highest-priority remaining blocker?** Establish trusted-writer enforcement and verify production-wide SI uniqueness, including historical conflict reconciliation and concurrency/rollback behavior.

The Express `/api/readout` compatibility path remains a readout/result-mirror concern: it does not create competitor identity, but it does not replace the canonical Firestore receipt/result flow. It is not the former readout auto-create identity blocker; complete readout/result ownership remains a separate cutover concern.

## Readiness basis

- **Design:** sufficiently documented.
- **Implementation:** partial; Firestore import and snapshot writes are assignment-aware and Eventor/IOF competitor import mirrors are disabled. Unsafe competition deletion/reset routes are fail-closed, but deletion remains unavailable.
- **Operational/safety validation:** incomplete; repository notes do not establish deployed trusted-server enforcement, all-writer coverage, historical conflict reconciliation, or successful concurrency/rollback validation.

The Firestore import/snapshot path trace is in [IMPORT_SNAPSHOT_MIGRATION.md](./IMPORT_SNAPSHOT_MIGRATION.md), and the Eventor/IOF flow trace is in [EVENTOR_IOF_IMPORT_MIGRATION.md](./EVENTOR_IOF_IMPORT_MIGRATION.md). The earlier [POST_CRUD_READINESS_REVIEW.md](./POST_CRUD_READINESS_REVIEW.md) and [IMPORT_SNAPSHOT_OWNERSHIP_GAP_ANALYSIS.md](./IMPORT_SNAPSHOT_OWNERSHIP_GAP_ANALYSIS.md) are historical records; this file is the only current blocker list. The rules regression cases require Firestore emulator execution; no emulator or Firebase CLI was available during this assessment. Application build/lint do not validate deployed rules or trusted writers.

Therefore, do not enable global uniqueness enforcement or declare competitor ownership fully cut over until every item in the canonical list is closed and verified.

## Contradictions found and resolved in this document set

- `READOUT_AUTO_CREATE_MIGRATION_PLAN.md` previously described the legacy `POST /api/readout` competitor-creation branch as current and an active P0 blocker. That description is now explicitly historical; the migration and current behavior are recorded there and in [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md).
- `LEGACY_WRITER_INVENTORY.md` previously marked readout auto-create as a remaining blocker and repeated outdated readout claims in its final assessment. It now marks that writer migrated and points to this canonical blocker list.
- Earlier readiness notes described the assignment schema/transactions as not implemented. Current implementation has assignment create/retire/reassign paths and a client-rule fence, but not global uniqueness or a trusted all-writer boundary. This document distinguishes those milestones from the remaining blockers.
- The legacy readout endpoint's ongoing compatibility role must not be conflated with identity auto-create: its readout/result persistence limitations remain, but the identity-creation branch was removed.
- The prior post-CRUD review, ownership-gap analysis, and import/snapshot migration record identified Eventor/IOF Express import mirrors as active blockers. This migration disables competitor writes through those mirrors and keeps authenticated IOF competitor writes on the per-competitor Firestore transaction path; Eventor/IOF import is no longer an active blocker.
- Earlier readiness and import/snapshot notes described competition deletion as an active writer that needed assignment-aware migration. That path is now explicitly disabled in Firestore rules, client/UI, and Express; it is no longer an active delete writer, but the deletion feature is unavailable until a safe lifecycle design is implemented. See [COMPETITION_DELETION_MIGRATION.md](./COMPETITION_DELETION_MIGRATION.md).

## References

- [COMPETITOR_READOUT_ARCHITECTURE.md](./COMPETITOR_READOUT_ARCHITECTURE.md)
- [P0_IMPLEMENTATION_PLAN.md](./P0_IMPLEMENTATION_PLAN.md)
- [LEGACY_WRITER_INVENTORY.md](./LEGACY_WRITER_INVENTORY.md)
- [READOUT_AUTO_CREATE_MIGRATION_PLAN.md](./READOUT_AUTO_CREATE_MIGRATION_PLAN.md)
- [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md)
- [POST_CRUD_READINESS_REVIEW.md](./POST_CRUD_READINESS_REVIEW.md)
- [IMPORT_SNAPSHOT_OWNERSHIP_GAP_ANALYSIS.md](./IMPORT_SNAPSHOT_OWNERSHIP_GAP_ANALYSIS.md)
- [IMPORT_SNAPSHOT_MIGRATION.md](./IMPORT_SNAPSHOT_MIGRATION.md)
- [EVENTOR_IOF_IMPORT_MIGRATION.md](./EVENTOR_IOF_IMPORT_MIGRATION.md)
- [COMPETITION_DELETION_MIGRATION.md](./COMPETITION_DELETION_MIGRATION.md)
