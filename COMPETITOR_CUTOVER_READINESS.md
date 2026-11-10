# Competitor Cutover Readiness

Status: post import/snapshot migration assessment, 2026-11-10.

## Executive summary

**Readiness: NO-GO for competitor identity ownership cutover and global SI uniqueness enforcement.**

Readout auto-create has been migrated: the Firestore path atomically creates the competitor, active SI assignment, receipt, and count projections, while the Express readout and online-punch processors no longer create competitor identities. This closes that specific identity-writer bypass. It does not resolve the other legacy writers or prove all-writer uniqueness and operational enforcement.

The existing Firestore transaction paths for direct entry, SI change, retirement, reassignment, readout, import, and snapshot seeding, plus the strengthened Firestore client-rule fence, are meaningful progress. Import and missing-record snapshot seeds now validate or create the matching SI assignment in the same transaction as each competitor write. Admin SDK writers, legacy Express import mirrors, competition deletion, and production-wide uniqueness still require migration or operational validation.

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

## Canonical active blocker list

This is the single source of truth for active competitor-ownership cutover blockers. The [legacy writer inventory](./LEGACY_WRITER_INVENTORY.md) and [readout auto-create migration record](./READOUT_AUTO_CREATE_MIGRATION_PLAN.md) refer here rather than maintaining separate blocker lists.

1. **Eventor/IOF Express import mirrors (highest priority):** `/api/eventor/import-event` and `/api/import/batch` still create competitor identities in the persisted Express mirror without assignment handling. Migrate these routes to the canonical Firestore import flow or disable them and prevent mirror data from becoming an identity source.
2. **Competition deletion lifecycle:** `deleteCompetitionFromFirestore` deletes child documents in batches without retiring SI assignments, omits the assignment subcollection, and does not complete competitor deletion atomically with assignment retirement. Implement and validate assignment-aware deletion.
3. **Trusted-writer enforcement and uniqueness validation:** Firestore client rules do not constrain Admin SDK writers. Establish and verify the production authority boundary, reconcile existing duplicate/conflicting SI data, and validate uniqueness, retries, rollback, and concurrent mutations. Emulator and deployed-rule evidence is still required.
4. **Administrative lifecycle and restore mirrors:** clear-demo, reset-seed, and Express competition deletion still replace or remove identities in the legacy mirror; restore is restricted for SI/ID/card-series/status changes but still restores other competitor fields to that mirror. Constrain these paths so they cannot become alternate identity authorities.

The three legacy competitor CRUD routes and their first-party UI callers are no longer active blockers. Firestore import and snapshot writes are now assignment-aware; legacy Express import mirrors, administrative mirror paths, and competition lifecycle writers remain open.

**What is the single highest-priority remaining blocker?** Migrate or disable the Eventor/IOF Express import mirrors so they cannot create competitor identity outside the canonical Firestore assignment-aware import flow.

The Express `/api/readout` compatibility path remains a readout/result-mirror concern: it does not create competitor identity, but it does not replace the canonical Firestore receipt/result flow. It is not the former readout auto-create identity blocker; complete readout/result ownership remains a separate cutover concern.

## Readiness basis

- **Design:** sufficiently documented.
- **Implementation:** partial; Firestore import and snapshot writes are assignment-aware, but legacy Express import mirrors and competition lifecycle writers remain.
- **Operational/safety validation:** incomplete; repository notes do not establish deployed trusted-server enforcement, all-writer coverage, historical conflict reconciliation, or successful concurrency/rollback validation.

The detailed Firestore import/snapshot path trace is in [IMPORT_SNAPSHOT_MIGRATION.md](./IMPORT_SNAPSHOT_MIGRATION.md). The earlier [POST_CRUD_READINESS_REVIEW.md](./POST_CRUD_READINESS_REVIEW.md) and [IMPORT_SNAPSHOT_OWNERSHIP_GAP_ANALYSIS.md](./IMPORT_SNAPSHOT_OWNERSHIP_GAP_ANALYSIS.md) are historical records; this file is the only current blocker list. The rules regression cases require Firestore emulator execution; no emulator or Firebase CLI was available during this assessment. Application build/lint do not validate deployed rules or trusted writers.

Therefore, do not enable global uniqueness enforcement or declare competitor ownership fully cut over until every item in the canonical list is closed and verified.

## Contradictions found and resolved in this document set

- `READOUT_AUTO_CREATE_MIGRATION_PLAN.md` previously described the legacy `POST /api/readout` competitor-creation branch as current and an active P0 blocker. That description is now explicitly historical; the migration and current behavior are recorded there and in [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md).
- `LEGACY_WRITER_INVENTORY.md` previously marked readout auto-create as a remaining blocker and repeated outdated readout claims in its final assessment. It now marks that writer migrated and points to this canonical blocker list.
- Earlier readiness notes described the assignment schema/transactions as not implemented. Current implementation has assignment create/retire/reassign paths and a client-rule fence, but not global uniqueness or a trusted all-writer boundary. This document distinguishes those milestones from the remaining blockers.
- The legacy readout endpoint's ongoing compatibility role must not be conflated with identity auto-create: its readout/result persistence limitations remain, but the identity-creation branch was removed.
- The prior post-CRUD review and ownership-gap analysis listed Firestore import and snapshot seeding as active blockers. This migration closes those gaps with per-competitor transactions; the legacy Express import mirrors remain active blockers and are distinct from the migrated Firestore paths.

## References

- [COMPETITOR_READOUT_ARCHITECTURE.md](./COMPETITOR_READOUT_ARCHITECTURE.md)
- [P0_IMPLEMENTATION_PLAN.md](./P0_IMPLEMENTATION_PLAN.md)
- [LEGACY_WRITER_INVENTORY.md](./LEGACY_WRITER_INVENTORY.md)
- [READOUT_AUTO_CREATE_MIGRATION_PLAN.md](./READOUT_AUTO_CREATE_MIGRATION_PLAN.md)
- [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md)
- [POST_CRUD_READINESS_REVIEW.md](./POST_CRUD_READINESS_REVIEW.md)
- [IMPORT_SNAPSHOT_OWNERSHIP_GAP_ANALYSIS.md](./IMPORT_SNAPSHOT_OWNERSHIP_GAP_ANALYSIS.md)
- [IMPORT_SNAPSHOT_MIGRATION.md](./IMPORT_SNAPSHOT_MIGRATION.md)
