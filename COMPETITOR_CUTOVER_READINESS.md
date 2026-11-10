# Competitor Cutover Readiness

Status: fresh post-CRUD blocker inventory, 2026-11-10.

## Executive summary

**Readiness: NO-GO for competitor identity ownership cutover and global SI uniqueness enforcement.**

Readout auto-create has been migrated: the Firestore path atomically creates the competitor, active SI assignment, receipt, and count projections, while the Express readout and online-punch processors no longer create competitor identities. This closes that specific identity-writer bypass. It does not resolve the other legacy writers or prove all-writer uniqueness and operational enforcement.

The existing Firestore transaction paths for direct entry, SI change, retirement, reassignment, and readout, plus the initial Firestore client-rule fence, are meaningful progress. The fresh inventory found that bulk import and snapshot writes remain outside the canonical assignment transaction. The competitor-create rule checks for an active assignment by SI number but does not bind that assignment to the incoming competitor ID. The remaining gap is a single enforced authority boundary for every identity writer, backed by operational validation.

## Completed migration work relevant to this assessment

- ClubSettings, RunnerDb, Courses, Classes, and competition metadata migrations.
- Atomic SI Matching Phases A, B, and C0; assignment create, delete/retire, and reassign paths.
- Cloud-hydrate competitor identity fence.
- Readout auto-create moved to the Firestore transaction flow; Express readout identity creation removed.
- Legacy `POST /api/competitors`, `PUT /api/competitors/:id`, and `DELETE /api/competitors/:id` are disabled with HTTP 410 responses. First-party direct-entry, competitor update, and delete UI flows now call Firestore mutation helpers directly; they no longer use Express CRUD as a prerequisite or fallback.
- Direct-entry competitor creation now rejects existing SI assignment/competitor conflicts and duplicate-scan failures before writing. SI reassignment rejects assignment conflicts and duplicate-scan failures in the transaction path.
- Legacy snapshot updates to existing competitor documents and snapshot-driven deletions are blocked by `syncFullSeasonToFirestore`; snapshot seeding of missing records remains an active writer.
- Firestore client rules provide useful constraints on covered competitor mutations, but the create rule does not verify that the active SI assignment belongs to the created competitor. Rules also do not constrain Admin SDK writers.

## Canonical active blocker list

This is the single source of truth for active competitor-ownership cutover blockers. The [legacy writer inventory](./LEGACY_WRITER_INVENTORY.md) and [readout auto-create migration record](./READOUT_AUTO_CREATE_MIGRATION_PLAN.md) refer here rather than maintaining separate blocker lists.

1. **Firestore import and snapshot writers (highest priority):** `saveCompetitionImportToFirestore` and missing-record seeding in `syncFullSeasonToFirestore` write competitor documents outside the atomic SI-assignment mutation flow. The competitor-create rule requires an active assignment but does not bind it to the incoming competitor ID; close this gap and route every import/snapshot identity mutation through an assignment-aware operation or disable it.
2. **Eventor and IOF legacy import mirrors:** `/api/eventor/import-event` and `/api/import/batch` still create competitors in the persisted Express mirror without assignment handling. Migrate or disable these routes and prevent mirror data from becoming an identity seed.
3. **Competition deletion lifecycle:** `deleteCompetitionFromFirestore` deletes child documents in batches without retiring SI assignments, omits the assignment subcollection, and cannot complete the required competitor lifecycle atomically. Define and implement assignment-aware deletion/retirement.
4. **Administrative lifecycle and restore:** clear-demo, reset-seed, and Express competition deletion still replace or remove identities in the legacy mirror; restore is restricted for SI/ID/card-series/status changes but still restores other competitor fields to that mirror. Constrain these paths so they cannot become alternate identity authorities.
5. **Trusted-writer enforcement and validation:** diagnostics are not enforcement, and Firestore client rules do not constrain Admin SDK writers. Establish and verify the production authority boundary, reconcile existing duplicate/conflicting SI data, and validate uniqueness, retries, rollback, and concurrent mutations. Firestore emulator/integration and deployed-rule evidence is still required.

The three legacy competitor CRUD routes and their first-party UI callers are no longer active blockers. This closes only those Express endpoints and associated application call paths; import, snapshot, administrative mirror, and competition lifecycle writers remain open.

**What is the single highest-priority remaining blocker?** Close the Firestore import/snapshot competitor-write boundary, especially the create-rule gap that accepts any active assignment for an SI number without verifying that the assignment belongs to the incoming competitor.

The Express `/api/readout` compatibility path remains a readout/result-mirror concern: it does not create competitor identity, but it does not replace the canonical Firestore receipt/result flow. It is not the former readout auto-create identity blocker; complete readout/result ownership remains a separate cutover concern.

## Readiness basis

- **Design:** sufficiently documented.
- **Implementation:** partial; atomic assignment transactions exist for covered paths, but active bulk import, snapshot, legacy mirror, and competition lifecycle writers remain.
- **Operational/safety validation:** incomplete; repository notes do not establish deployed trusted-server enforcement, all-writer coverage, historical conflict reconciliation, or successful concurrency/rollback validation.

The detailed ranked inventory is recorded in [POST_CRUD_READINESS_REVIEW.md](./POST_CRUD_READINESS_REVIEW.md). Prior CRUD-route verification (`npm run lint`, `npm run build`, and 16 focused SI-assignment unit tests) does not validate the remaining import/snapshot rules, trusted writers, or lifecycle paths. Firestore emulator/deployed-rule validation remains outstanding.

Therefore, do not enable global uniqueness enforcement or declare competitor ownership fully cut over until every item in the canonical list is closed and verified.

## Contradictions found and resolved in this document set

- `READOUT_AUTO_CREATE_MIGRATION_PLAN.md` previously described the legacy `POST /api/readout` competitor-creation branch as current and an active P0 blocker. That description is now explicitly historical; the migration and current behavior are recorded there and in [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md).
- `LEGACY_WRITER_INVENTORY.md` previously marked readout auto-create as a remaining blocker and repeated outdated readout claims in its final assessment. It now marks that writer migrated and points to this canonical blocker list.
- Earlier readiness notes described the assignment schema/transactions as not implemented. Current implementation has assignment create/retire/reassign paths and a client-rule fence, but not global uniqueness or a trusted all-writer boundary. This document distinguishes those milestones from the remaining blockers.
- The legacy readout endpoint's ongoing compatibility role must not be conflated with identity auto-create: its readout/result persistence limitations remain, but the identity-creation branch was removed.
- Prior inventory descriptions treated all covered competitor creates as requiring a paired assignment write. The current competitor create rule only checks for an active assignment at the SI-number path and does not verify that its `competitorId` matches the new competitor; bulk import and snapshot-seed writes therefore require explicit closure and emulator verification.

## References

- [COMPETITOR_READOUT_ARCHITECTURE.md](./COMPETITOR_READOUT_ARCHITECTURE.md)
- [P0_IMPLEMENTATION_PLAN.md](./P0_IMPLEMENTATION_PLAN.md)
- [LEGACY_WRITER_INVENTORY.md](./LEGACY_WRITER_INVENTORY.md)
- [READOUT_AUTO_CREATE_MIGRATION_PLAN.md](./READOUT_AUTO_CREATE_MIGRATION_PLAN.md)
- [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md)
- [POST_CRUD_READINESS_REVIEW.md](./POST_CRUD_READINESS_REVIEW.md)
