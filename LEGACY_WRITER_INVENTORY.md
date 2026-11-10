# Legacy Writer Inventory for Competitor Ownership Migration

Status: reassessed 2026-11-10. This inventory documents current migration status; it is not an independent readiness checklist.

The canonical active blocker list and overall verdict are maintained in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md). Readout auto-create is migrated and is not an active identity-writer blocker.

## Summary

Competitor identity ownership is not yet fully cut over. Legacy Express competitor CRUD routes are disabled and Firestore import/snapshot creation use per-competitor transactions. However, the SI inventory UI still exposes assignment-only bootstrap, standalone assignment helpers remain exported, some delete/retire flows do not stop after skipped assignment retirement, and card-series parity is not enforced. Competition deletion, clear-all, and demo reset paths are disabled; backup restore cannot change the competition set or protected competitor identities. Firestore rules do not provide a trusted all-writer boundary or complete per-competition uniqueness enforcement.

The former readout auto-create bypass has been removed. See [READOUT_AUTO_CREATE_MIGRATION_PLAN.md](./READOUT_AUTO_CREATE_MIGRATION_PLAN.md) for the historical rationale and migrated behavior.

## Writer inventory

| # | Path / file | Write target | Current classification | Current status |
|---|---|---|---|---|
| 1 | `server.ts` `POST /api/competitors` | None; terminal HTTP 410 response | Disabled legacy route | Migrated; direct-entry UI writes through the Firestore transaction helper |
| 2 | `server.ts` `PUT /api/competitors/:id` | None; terminal HTTP 410 response | Disabled legacy route | Migrated; UI updates use Firestore transaction helpers |
| 3 | `server.ts` `DELETE /api/competitors/:id` | None; terminal HTTP 410 response | Disabled legacy route | Route is disabled; the separate Firestore competitor-delete helper has a skipped-retirement fail-closed gap (row 16) |
| 4 | Direct-entry and update/delete UI flows in `src/App.tsx` | Firestore competitor and assignment documents | Firestore transaction paths | Migrated for these CRUD flows; competition deletion is separately disabled pending an assignment-aware lifecycle flow |
| 5 | Eventor `/api/eventor/import-event` | Previously wrote imported competitors, classes, metadata, and runnerDb to Express `seasonDb` | Disable-only legacy route | Returns HTTP 410 before fetching or mutating data; Eventor club-to-RunnerDb sync remains separate and does not create competitors |
| 6 | IOF `/api/import/batch` with non-empty `entries` | Previously created competitors and RunnerDb entries in Express `seasonDb` | Disable-only legacy identity path | Returns HTTP 410 before any writes when entries are present; authenticated UI writes competitors through `saveCompetitionImportToFirestore` and sends an empty entries list to the Express compatibility mirror |
| 7 | Eventor `/api/eventor/sync-club` and IOF `/api/import/batch` with no entries | RunnerDb, courses, and classes in Express `seasonDb` | Redirectable non-identity compatibility paths | No competitor create or assignment mutation; authenticated UI also writes supported domain data to Firestore |
| 8 | `src/firebase.ts` `deleteCompetitionFromFirestore`, Firestore competition parent delete rule, `server.ts` `DELETE /api/competitions/:id`, and administration UI | Competition and competitor tree | Disable-only lifecycle paths | Disabled: client helper throws, parent delete rule denies, Express route returns HTTP 410, and UI delete action is removed. Assignment-aware deletion is not implemented. |
| 9 | `server.ts` `/api/system/clear-demo` and `/api/system/reset-seed` | Legacy season and competitor mirrors; reset may also replace seeded RunnerDb | Disable-only administrative paths | Both return HTTP 410 before mutation; the clear-all UI action and unused demo reset fallback were removed. |
| 10 | `server.ts` `/api/system/restore` | Local/Express season state | Guarded restore path | Rejects competition-ID-set changes and existing competitor identity/lifecycle changes; restores only a same-competition-set legacy mirror. Does not write Firestore assignments. |
| 11 | `src/firebase.ts` `syncFullSeasonToFirestore` | Firestore competitors and SI assignments | Snapshot seed writer | Missing-record seeds create matching competitor/assignment pairs per transaction; existing competitor overwrites/deletes remain blocked; migrated per competitor |
| 12 | `src/firebase.ts` `saveCompetitionImportToFirestore` | Firestore competitors and SI assignments | Import writer | Creates and validates assignments in per-competitor transactions; rejects import-driven SI/card-series changes; migrated per competitor |
| 13 | `server.ts` cloud-hydrate | Local/Express competitor mirror | Guarded compatibility hydration | Identity changes, additions/removals, duplicates, and omitted competitions are fenced; non-identity mirror hydration remains |
| 14 | `server.ts` `/api/readout` and online-punch compatibility processing | Legacy event/readout/result state | Compatibility/result path | Competitor identity auto-create removed; readout/result ownership is not fully migrated |
| 15 | `src/firebase.ts` readout auto-create helper | Firestore competitor, assignment, receipt, counts | Canonical transaction path | Migrated; not an active legacy identity blocker |
| 16 | `src/firebase.ts` `saveDirectCompetitionEntryToFirestore`, `updateCompetitorInFirestore`, `deleteCompetitorFromFirestore`, `retireCompetitorInFirestore` | Firestore competitor and assignment documents | Mixed atomic client paths | Direct create and SI reassignment use transactions; update permits card-series-only changes without synchronizing assignment; delete/retire do not fail closed on every skipped retirement outcome |
| 17 | `src/utils/siAssignmentDiagnostics.ts` mutation declarations | Diagnostics only | Observability, not enforcement | Must not be counted as a writer guard |
| 18 | `src/firebase.ts` `generateMissingSIAssignmentsFromFirestore` and `SIAssignmentInventoryView.tsx` | Firestore SI assignment documents | Admin bootstrap writer | Active UI operation; transaction writes only assignment, uses pre-read competitor plan, and does not reread/validate competitor ownership in the write transaction |
| 19 | `src/firebase.ts` `createCompetitionSICardAssignment`, `retireCompetitionSICardAssignment` | Firestore SI assignment documents | Dormant exported single-document helpers | No current in-repository call sites found; direct set/update outside a paired competitor transaction. Remove or disable before cutover |

RunnerDb directory CRUD is retained as a distinct runner-directory domain. It is not itself a competitor identity mutation, but any importer or consumer that turns its records into competitor identities must use the canonical competitor/assignment flow. Readout auto-create now does so.

## Readout identity writer status

The earlier Express `POST /api/readout` and online-punch auto-create branches inserted runnerDb-derived competitors into `seasonDb` without a Firestore assignment. Those writes have been removed. The browser Firestore readout transaction now pairs competitor creation with an active SI assignment, immutable receipt, and count updates; it fails closed to an `UNKNOWN` receipt when ownership/identity checks do not pass.

This migration does not make the legacy Express endpoint the canonical receipt/result processor. Its remaining compatibility limitations are described in [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md).

## Authority and uniqueness notes

- `runCompetitorMutation` and related diagnostics report intent; they do not reject legacy writes.
- Most first-party create/import/snapshot/readout/reassignment paths use transactions, but the bootstrap and exported single-document helpers do not pair assignment writes with competitor mutations.
- Current rules check matching IDs/SI/owner for common writes, but their DNS/DNF lifecycle shortcut can accept some assignment-only writes; card-series parity and duplicate competitor queries are not enforced by the rules.
- Firestore client rules do not constrain Admin SDK writers or establish that deployed rules match repository rules. No Admin SDK use was found in the repository; external/deployed writers remain unverified.
- Duplicate candidate scans outside a Firestore transaction are diagnostic, not a global concurrency guarantee. Do not equate transaction scaffolding or rule fencing with system-wide uniqueness enforcement.

Eventor/IOF import migration details are in [EVENTOR_IOF_IMPORT_MIGRATION.md](./EVENTOR_IOF_IMPORT_MIGRATION.md). The disabled Express entry-import routes and authenticated Firestore import are distinct paths. Competition-deletion path details and disablement are in [COMPETITION_DELETION_MIGRATION.md](./COMPETITION_DELETION_MIGRATION.md). The full writer, historical-conflict, uniqueness, concurrency, and rollback analysis is in [FINAL_READINESS_BLOCKERS.md](./FINAL_READINESS_BLOCKERS.md); the canonical verdict and blocker ordering are in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).
