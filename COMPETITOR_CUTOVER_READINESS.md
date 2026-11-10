# Competitor Cutover Readiness

Status: ownerUid forensic reassessment, 2026-11-10.

## Executive summary

**Readiness: NO-GO for competitor identity ownership cutover and system-wide enforcement of per-competition SI uniqueness.**

The authenticated, read-only V2 audit and ownerUid forensic scan ran locally against the configured Firestore project at `2026-11-10T21:52:24.668Z`. It read all four competition documents returned by the query: 14 competitors and 20 assignments. Six retired assignments have matching ACTIVE successors for the same competitor and are expected historical reassignments, not lifecycle failures. The audit found six active assignment/competitor `ownerUid` parity mismatches (four in Reflexcup#2 and two in Lång-TM), with no orphan assignments, orphan competitors, duplicate SI ownership, competitor ID, document ID, current SI, or active card-series mismatches. The added Terräng-KM competition has two competitors and four assignments, zero parity mismatches, and two expected historical reassignments. For all six mismatches, classify the current condition as **C — Current integrity violation**. The available document evidence does not establish whether the underlying cause is historical pre-migration data (A) or an ownership migration defect (B); D is not appropriate for active mismatches. No production data was changed. See [OWNERUID_FORENSIC_ANALYSIS.md](./OWNERUID_FORENSIC_ANALYSIS.md), [OWNERUID_REMEDIATION_PLAN.md](./OWNERUID_REMEDIATION_PLAN.md), [LIVE_INTEGRITY_INVENTORY_V2.md](./LIVE_INTEGRITY_INVENTORY_V2.md), and [CONFLICT_REMEDIATION_PLAN_V2.md](./CONFLICT_REMEDIATION_PLAN_V2.md).

Readout auto-create has been migrated: the Firestore path atomically creates the competitor, active SI assignment, receipt, and count projections, while the Express readout and online-punch processors no longer create competitor identities. The remaining NO-GO status is based on incomplete production inventory, deployed-rule/trusted-writer assurance, and concurrency/rollback validation—not on the repository-local standalone assignment paths, which this hardening closes.

The assignment mutation boundary has now been hardened in the repository: standalone assignment create/retire APIs were removed, bootstrap rereads and validates the competitor within each transaction, competitor lifecycle and card-series changes require matching assignment writes, and skipped assignment outcomes abort the enclosing transaction. Firestore rules also require meaningful paired competitor changes and enforce identity/card-series/owner parity. This closes the repository-local non-atomic and fail-open assignment writer blocker; the rules suite and deployed rules are not yet verified. Production-wide ownership consistency, trusted-writer inventory, concurrency behavior, and rollback behavior remain unestablished.

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
- `generateMissingSIAssignmentsFromFirestore` rereads the competitor and assignment in the write transaction, verifies path identity, SI, card series, and owner parity, updates the competitor timestamp in the same commit, and throws on the first write failure. Earlier successful candidates remain committed if a later candidate fails; the operation is atomic per competitor, not as a whole scan.
- `createCompetitionSICardAssignment` and `retireCompetitionSICardAssignment` standalone exports were removed; the Firestore `db` instance, `runAtomicSIAssignmentMutation`, and assignment document-reference helpers are now private to `src/firebase.ts`.
- `deleteCompetitorFromFirestore` and `retireCompetitorInFirestore` throw on invalid, conflicting, or version-limited retirement outcomes, aborting the transaction before competitor changes commit.
- `updateCompetitorInFirestore` updates the matching assignment in the same transaction for SI reassignment and card-series-only changes; it verifies current assignment identity/card-series/owner parity and rejects version-limit or ownership conflicts.
- Firestore rules now require a matching competitor mutation (including the DNS/DNF cases), compare active assignment SI/card-series/owner/IDs to the post-write competitor, validate pre-write parity for retirement, and require assignment pairing for card-series changes. Duplicate competitor SI queries remain outside the rules boundary. Deployed rules were not verified.

## Canonical active blocker list

This is the single source of truth for active competitor-ownership cutover blockers. The [legacy writer inventory](./LEGACY_WRITER_INVENTORY.md) and [readout auto-create migration record](./READOUT_AUTO_CREATE_MIGRATION_PLAN.md) refer here rather than maintaining separate blocker lists.

1. **Reconcile six active ownerUid parity mismatches (highest priority):** The latest forensic scan covered four competitions, 14 competitors, and 20 assignments, and confirmed the same six mismatches as before. In Reflexcup#2, competitor ownerUid matches competition ownerUid while later `SYSTEM` assignment ownerUid differs. In Lång-TM, each competitor and retired predecessor share an ownerUid, while the `MANUAL` active successor matches competition ownerUid; the predecessor retirement timestamp matches successor creation. The added Terräng-KM competition is clean apart from two expected same-competitor historical reassignments. These patterns implicate assignment creation/reassignment provenance but do not prove the historical cause. Confirm competitor ownership with the competition owner; if confirmed, correct the assignment ownerUid atomically through the canonical transaction boundary and rerun the audit. No data was changed. See [OWNERUID_FORENSIC_ANALYSIS.md](./OWNERUID_FORENSIC_ANALYSIS.md) and [OWNERUID_REMEDIATION_PLAN.md](./OWNERUID_REMEDIATION_PLAN.md).
2. **Trusted-writer and deployed-rule assurance:** Enumerate Admin SDK/deployed writer authorities, verify the deployed Firestore rules version, run the Firestore rules regression suite, and demonstrate that no writer bypasses the canonical path. Firestore rules do not constrain Admin SDKs.
3. **Concurrency, retry, and rollback validation:** Exercise same-SI competing creates, reassignment/readout/import races, retries/timeouts, and partial import/bootstrap recovery. No production-like concurrency/rollback evidence is recorded.

Competition deletion and destructive season-reset paths are disabled rather than migrated. This is a deliberate capability restriction, not an assignment-aware deletion implementation. Backup restore cannot change the competition set or protected competitor identity fields. The three legacy competitor CRUD routes and their first-party UI callers are no longer active blockers. Firestore import and snapshot creates are assignment-aware per competitor; Eventor/IOF Express competitor import writes are disabled or redirected to the canonical Firestore path.

**What is the single highest-priority remaining blocker?** Confirm authoritative competitor ownership and reconcile the six active assignment `ownerUid` parity mismatches, then rerun the read-only inventory.

The Express `/api/readout` compatibility path remains a readout/result-mirror concern: it does not create competitor identity, but it does not replace the canonical Firestore receipt/result flow. It is not the former readout auto-create identity blocker; complete readout/result ownership remains a separate cutover concern.

## Readiness basis

- **Design:** sufficiently documented.
- **Implementation:** the repository-local assignment boundary is fail-closed; unsafe competition deletion/reset routes remain disabled. The rules regression suite and deployed rules are not verified.
- **Operational/safety validation:** the latest local V2 audit checked owner UID, active card-series, competitor/document IDs, SI, lifecycle, orphans, and duplicate ownership for all four competition documents returned by the authorized query. The forensic report captures the six mismatches' raw UIDs and is restricted operational data. Those mismatches remain unresolved, and the complete intended competition set, trusted writers, deployed rules, and concurrency/rollback behavior remain unverified.

The assignment mutation inventory and local verification record is [ASSIGNMENT_BOUNDARY_HARDENING.md](./ASSIGNMENT_BOUNDARY_HARDENING.md). The detailed writer, conflict, concurrency, and rollback evidence is in [FINAL_READINESS_BLOCKERS.md](./FINAL_READINESS_BLOCKERS.md). The Firestore import/snapshot path trace is in [IMPORT_SNAPSHOT_MIGRATION.md](./IMPORT_SNAPSHOT_MIGRATION.md), and the Eventor/IOF flow trace is in [EVENTOR_IOF_IMPORT_MIGRATION.md](./EVENTOR_IOF_IMPORT_MIGRATION.md). The earlier [POST_CRUD_READINESS_REVIEW.md](./POST_CRUD_READINESS_REVIEW.md) and [IMPORT_SNAPSHOT_OWNERSHIP_GAP_ANALYSIS.md](./IMPORT_SNAPSHOT_OWNERSHIP_GAP_ANALYSIS.md) are historical records; this file is the sole current blocker list. Rules regression cases require Firestore emulator execution; no emulator or Firebase CLI is available in this environment. Application build/lint do not validate deployed rules or trusted writers.

Therefore, do not enable global uniqueness enforcement or declare competitor ownership fully cut over until every item in the canonical list is closed and verified.

## Contradictions found and resolved in this document set

- `READOUT_AUTO_CREATE_MIGRATION_PLAN.md` previously described the legacy `POST /api/readout` competitor-creation branch as current and an active P0 blocker. That description is now explicitly historical; the migration and current behavior are recorded there and in [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md).
- `LEGACY_WRITER_INVENTORY.md` previously marked readout auto-create as a remaining blocker and repeated outdated readout claims in its final assessment. It now marks that writer migrated and points to this canonical blocker list.
- `MIGRATION-STATUS.md` retains phase notes that describe independent assignment writes as permitted and the pre-Step-7 rule behavior. Those statements are historical and superseded by the current rule predicate, which now requires a changed matching competitor and card-series/owner parity. Emulator and deployed-rule verification remain outstanding; see [FINAL_READINESS_BLOCKERS.md](./FINAL_READINESS_BLOCKERS.md).
- “Global SI uniqueness” in earlier readiness wording was ambiguous. Assignment document IDs are scoped under each competition; the remaining goal is system-wide enforcement of uniqueness within each competition across all writers, not uniqueness across separate competitions.
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
- [LIVE_INTEGRITY_INVENTORY_V2.md](./LIVE_INTEGRITY_INVENTORY_V2.md)
- [CONFLICT_REMEDIATION_PLAN_V2.md](./CONFLICT_REMEDIATION_PLAN_V2.md)
- [OWNERUID_FORENSIC_ANALYSIS.md](./OWNERUID_FORENSIC_ANALYSIS.md)
- [OWNERUID_REMEDIATION_PLAN.md](./OWNERUID_REMEDIATION_PLAN.md)
