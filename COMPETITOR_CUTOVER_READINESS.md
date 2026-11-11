# Competitor Cutover Readiness

Status: trusted-writer and deployed-rule reassessment, 2026-11-11.

## Executive summary

**Readiness: NO-GO for competitor identity ownership cutover and system-wide enforcement of per-competition SI uniqueness.**

The authenticated, read-only V2 audit and ownerUid forensic scan ran locally against the configured Firestore project at `2026-11-10T21:52:24.668Z`. It read all four competition documents returned by the query: 14 competitors and 20 assignments. Six retired assignments have matching ACTIVE successors for the same competitor and are expected historical reassignments, not lifecycle failures. The audit found six active assignment/competitor `ownerUid` parity mismatches (four in Reflexcup#2 and two in Lång-TM), with no orphan assignments, orphan competitors, duplicate SI ownership, competitor ID, document ID, current SI, or active card-series mismatches. The added Terräng-KM competition has two competitors and four assignments, zero parity mismatches, and two expected historical reassignments. The four Reflexcup#2 mismatches are consistent with the early Phase C0 bootstrap path. For Lång-TM, pre-hardening source used the authenticated context UID for reassignment successors, matching the observed owner pattern; current source uses competitor identity. The two successors postdate the hardening source commit, but deployed revision is unknown, so their writer provenance remains **unresolved**. All six remain current parity failures; no production data was changed. See [LONG_TM_OWNERUID_ROOT_CAUSE.md](./LONG_TM_OWNERUID_ROOT_CAUSE.md), [OWNERUID_DISPOSITION.md](./OWNERUID_DISPOSITION.md), [OWNERUID_FORENSIC_ANALYSIS.md](./OWNERUID_FORENSIC_ANALYSIS.md), [OWNERUID_REMEDIATION_PLAN.md](./OWNERUID_REMEDIATION_PLAN.md), [LIVE_INTEGRITY_INVENTORY_V2.md](./LIVE_INTEGRITY_INVENTORY_V2.md), and [CONFLICT_REMEDIATION_PLAN_V2.md](./CONFLICT_REMEDIATION_PLAN_V2.md).

Readout auto-create has been migrated: the Firestore path atomically creates the competitor, active SI assignment, receipt, and count projections, while the Express readout and online-punch processors no longer create competitor identities. The remaining NO-GO status is based on incomplete production inventory, deployed-rule/trusted-writer assurance, and concurrency/rollback validation—not on the repository-local standalone assignment paths, which this hardening closes.

### Cutover assurance execution (2026-11-11)

The latest read-only production-app scan completed at `2026-11-11T10:02:08.710Z` and returned four competitions, 14 competitors, and 20 SI assignments. It is the older summary report, not the repository V2 owner/parity audit: it reported four retired-assignment/REGISTERED-competitor lifecycle flags (two previously understood Lång-TM reassignments and two Terräng-KM records without a current V2 disposition). The previous V2 snapshot remains the last evidence for owner parity; its six mismatches are not proven changed or resolved by this scan.

All five requested assurance phases remain **FAIL**: the identified deployed-rule source still has bypasses and the active revision is not immutably attested; trusted-writer coverage is incomplete; the production V2 inventory and full expected competition scope were not established; concurrency/retry tests were not run; and rollback/recovery was not exercised. This leaves readiness **NO-GO**. Details and exact limits are in [DEPLOYED_RULE_CLOSURE.md](./DEPLOYED_RULE_CLOSURE.md), [TRUSTED_WRITER_CLOSURE.md](./TRUSTED_WRITER_CLOSURE.md), [INVENTORY_COVERAGE_REPORT.md](./INVENTORY_COVERAGE_REPORT.md), [CONCURRENCY_VALIDATION.md](./CONCURRENCY_VALIDATION.md), [RECOVERY_VALIDATION.md](./RECOVERY_VALIDATION.md), and [CUTOVER_READINESS_REASSESSMENT.md](./CUTOVER_READINESS_REASSESSMENT.md).

The assignment mutation boundary has now been hardened in the repository: standalone assignment create/retire APIs were removed, bootstrap rereads and validates the competitor within each transaction, competitor lifecycle and card-series changes require matching assignment writes, and skipped assignment outcomes abort the enclosing transaction. Repository Firestore rules require meaningful paired competitor changes and enforce identity/card-series/owner parity. The rules regression suite remains unrun; read-only Console inspection found the newest/star-marked release materially stale and allowing independent assignment mutations. Production-wide ownership consistency, complete trusted-writer inventory, concurrency behavior, and rollback behavior remain unestablished.

### Latest trusted-writer and deployed-rule assurance (2026-11-11)

- The repository-local writer inventory found no reachable Express competitor CRUD bypass; HTTP 410 handlers precede the retained legacy route bodies. Canonical application identity writers are concentrated in `src/firebase.ts` and use the hardened per-competitor transaction boundary.
- The newest/star-marked Firestore Rules release shown in Firebase Console (`Yesterday • 8:23 AM`, 2026-11-10) is materially older than repository rules commit `90f0e9f` (`2026-11-10 21:19:26 +0100`). Full token-level inspection found missing paired create/update predicates, missing SI reassignment and retirement predicates, and direct assignment deletion allowed. **A client bypass remains; deployed-rule assurance fails.** See [DEPLOYED_RULE_DIFF.md](./DEPLOYED_RULE_DIFF.md).
- Project IAM inspection showed a human principal with `Owner (Legacy)` and a Firebase Admin SDK service identity. Cloud Run Services and Jobs views showed no entries. Service-account keys, effective inherited IAM, Cloud Functions/other runtimes, scheduled jobs, audit logs, and external CI identities remain unverified; trusted-writer assurance is therefore incomplete.
- No production rules or data were changed. See [TRUSTED_WRITER_ASSURANCE.md](./TRUSTED_WRITER_ASSURANCE.md) and [DEPLOYED_RULE_ASSURANCE.md](./DEPLOYED_RULE_ASSURANCE.md).

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
- Repository Firestore rules now require a matching competitor mutation (including the DNS/DNF cases), compare active assignment SI/card-series/owner/IDs to the post-write competitor, validate pre-write parity for retirement, and require assignment pairing for card-series changes. Duplicate competitor SI queries remain outside the rules boundary. The latest/star-marked deployed release inspected in Console lacks these checks and allows direct assignment deletion; exact release hash and emulator test results remain outstanding.

## Canonical active blocker list

This is the single source of truth for active competitor-ownership cutover blockers. The [legacy writer inventory](./LEGACY_WRITER_INVENTORY.md) and [readout auto-create migration record](./READOUT_AUTO_CREATE_MIGRATION_PLAN.md) refer here rather than maintaining separate blocker lists.

1. **Replace and attest the stale deployed Firestore rules (highest priority):** The newest/star-marked Console release inspected on 2026-11-11 lacks the repository's paired assignment/competitor checks and allows direct assignment deletion. Deploy the reviewed rules through the approved process, capture the active revision/source hash, and run emulator rule tests. No production rules change was performed in this assessment. See [DEPLOYED_RULE_REMEDIATION_PLAN.md](./DEPLOYED_RULE_REMEDIATION_PLAN.md).
2. **Complete trusted-writer assurance:** Repository paths are inventoried, but project IAM/service-account keys, effective inherited permissions, external Admin SDK jobs, audit logs, Cloud Functions/scheduled workloads, and CI/deployment identities are not fully established. Constrain every privileged writer to a reviewed path or remove its write authority.
3. **Resolve six active ownerUid parity mismatches and Lång-TM writer provenance:** Four Reflexcup#2 `SYSTEM` assignments are consistent with the early Phase C0 bootstrap implementation. The two Lång-TM `MANUAL` successors match pre-hardening `context.ownerUid` behavior, but no deployment revision or per-write actor/build evidence establishes which writer ran at 21:53 CET. Do not call them historical or an active current-writer defect without that evidence. Confirm authoritative competitor ownership, obtain an approved correction path, preserve retirement history, and rerun the audit. Even if the two Lång-TM cases were excluded, four active Reflexcup#2 parity violations remain, so readiness remains **NO-GO**. See [LONG_TM_OWNERUID_ROOT_CAUSE.md](./LONG_TM_OWNERUID_ROOT_CAUSE.md), [OWNERUID_DISPOSITION.md](./OWNERUID_DISPOSITION.md), [OWNERUID_FORENSIC_ANALYSIS.md](./OWNERUID_FORENSIC_ANALYSIS.md), and [OWNERUID_REMEDIATION_PLAN.md](./OWNERUID_REMEDIATION_PLAN.md).
4. **Complete production coverage and transaction-behavior validation:** Reconcile the full competition scope and run concurrency, retry, timeout, rollback, and partial import/bootstrap recovery tests. No emulator concurrency or recovery evidence is recorded.

Competition deletion and destructive season-reset paths are disabled rather than migrated. This is a deliberate capability restriction, not an assignment-aware deletion implementation. Backup restore cannot change the competition set or protected competitor identity fields. The three legacy competitor CRUD routes and their first-party UI callers are no longer active blockers. Firestore import and snapshot creates are assignment-aware per competitor; Eventor/IOF Express competitor import writes are disabled or redirected to the canonical Firestore path.

**What is the single highest-priority remaining blocker?** Replace and attest the stale deployed Firestore rules, then run the rules regression suite. The six active ownerUid parity violations remain a separate unresolved data/provenance blocker.

**If repository rules are deployed and verified, what becomes the single highest-priority blocker?** Complete **trusted-writer assurance**. Firebase Rules do not constrain Admin SDK writers, and the project inspection showed privileged principals while effective IAM, keys, external jobs, CI identities, and audit evidence remain incomplete. This is the next item in the canonical list; ownerUid findings and transaction-behavior checks also remain open. See [TRUSTED_WRITER_ASSURANCE.md](./TRUSTED_WRITER_ASSURANCE.md) and [DEPLOYED_RULE_REMEDIATION_PLAN.md](./DEPLOYED_RULE_REMEDIATION_PLAN.md).

The Express `/api/readout` compatibility path remains a readout/result-mirror concern: it does not create competitor identity, but it does not replace the canonical Firestore receipt/result flow. It is not the former readout auto-create identity blocker; complete readout/result ownership remains a separate cutover concern.

## Readiness basis

- **Design:** sufficiently documented.
- **Implementation:** repository-local assignment mutations are fail-closed; unsafe competition deletion/reset routes remain disabled. The inspected deployed rules are stale and permit direct assignment mutations without paired competitor writes.
- **Operational/safety validation:** the latest local V2 audit checked owner UID, active card-series, competitor/document IDs, SI, lifecycle, orphans, and duplicate ownership for all four competition documents returned by the authorized query. The forensic report captures the six mismatches' raw UIDs and is restricted operational data. Four mismatches have a likely early-bootstrap origin; two match the pre-hardening owner-selection behavior but have unknown production writer provenance. Excluding those two would still leave four active parity violations. Full competition coverage, complete IAM/trusted-writer assurance, rules regression execution, and concurrency/retry/rollback behavior remain unverified.

The assignment mutation inventory and local verification record is [ASSIGNMENT_BOUNDARY_HARDENING.md](./ASSIGNMENT_BOUNDARY_HARDENING.md). The deployed-rule and trusted-writer evidence is in [DEPLOYED_RULE_ASSURANCE.md](./DEPLOYED_RULE_ASSURANCE.md) and [TRUSTED_WRITER_ASSURANCE.md](./TRUSTED_WRITER_ASSURANCE.md). The detailed writer, conflict, concurrency, and rollback evidence is in [FINAL_READINESS_BLOCKERS.md](./FINAL_READINESS_BLOCKERS.md). The Firestore import/snapshot path trace is in [IMPORT_SNAPSHOT_MIGRATION.md](./IMPORT_SNAPSHOT_MIGRATION.md), and the Eventor/IOF flow trace is in [EVENTOR_IOF_IMPORT_MIGRATION.md](./EVENTOR_IOF_IMPORT_MIGRATION.md). The earlier [POST_CRUD_READINESS_REVIEW.md](./POST_CRUD_READINESS_REVIEW.md) and [IMPORT_SNAPSHOT_OWNERSHIP_GAP_ANALYSIS.md](./IMPORT_SNAPSHOT_OWNERSHIP_GAP_ANALYSIS.md) are historical records; this file is the sole current blocker list. Rules regression cases require Firestore emulator execution; no emulator or Firebase CLI is available in this environment. Application build/lint do not validate deployed rules or trusted writers.

Therefore, do not enable global uniqueness enforcement or declare competitor ownership fully cut over until every item in the canonical list is closed and verified.

## Contradictions found and resolved in this document set

- `READOUT_AUTO_CREATE_MIGRATION_PLAN.md` previously described the legacy `POST /api/readout` competitor-creation branch as current and an active P0 blocker. That description is now explicitly historical; the migration and current behavior are recorded there and in [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md).
- `LEGACY_WRITER_INVENTORY.md` previously marked readout auto-create as a remaining blocker and repeated outdated readout claims in its final assessment. It now marks that writer migrated and points to this canonical blocker list.
- `MIGRATION-STATUS.md` retains phase notes that describe independent assignment writes as permitted and the pre-Step-7 rule behavior. Those statements are historical and superseded by repository rules that require a changed matching competitor and card-series/owner parity. The Console inspection found an older deployed rules release without those checks; emulator validation and post-deployment revision attestation remain outstanding. See [FINAL_READINESS_BLOCKERS.md](./FINAL_READINESS_BLOCKERS.md), [DEPLOYED_RULE_ASSURANCE.md](./DEPLOYED_RULE_ASSURANCE.md), and [TRUSTED_WRITER_ASSURANCE.md](./TRUSTED_WRITER_ASSURANCE.md).
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
- [LONG_TM_OWNERUID_ROOT_CAUSE.md](./LONG_TM_OWNERUID_ROOT_CAUSE.md)
- [OWNERUID_FORENSIC_ANALYSIS.md](./OWNERUID_FORENSIC_ANALYSIS.md)
- [OWNERUID_REMEDIATION_PLAN.md](./OWNERUID_REMEDIATION_PLAN.md)
- [OWNERUID_DISPOSITION.md](./OWNERUID_DISPOSITION.md)
