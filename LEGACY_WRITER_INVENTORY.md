# Legacy Writer Inventory for Competitor Ownership Migration

Status: reassessed 2026-11-10. This inventory documents current migration status; it is not an independent readiness checklist.

The canonical active blocker list and overall verdict are maintained in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md). Readout auto-create is migrated and is not an active identity-writer blocker.

## Summary

Competitor identity ownership is not yet fully cut over. Legacy Express competitor CRUD routes are disabled and their first-party UI callers use Firestore transaction helpers. Firestore import and snapshot creation are assignment-aware; Eventor competitor import is disabled, and Express IOF entry imports are rejected while authenticated IOF import uses the Firestore transaction path. Competition deletion, clear-all, and demo reset paths are disabled; backup restore cannot change the competition set or protected competitor identities. Firestore assignment transactions and client rules protect covered paths, but diagnostics and client rules do not provide a trusted all-writer boundary or global uniqueness by themselves.

The former readout auto-create bypass has been removed. See [READOUT_AUTO_CREATE_MIGRATION_PLAN.md](./READOUT_AUTO_CREATE_MIGRATION_PLAN.md) for the historical rationale and migrated behavior.

## Writer inventory

| # | Path / file | Write target | Current classification | Current status |
|---|---|---|---|---|
| 1 | `server.ts` `POST /api/competitors` | None; terminal HTTP 410 response | Disabled legacy route | Migrated; direct-entry UI writes through the Firestore transaction helper |
| 2 | `server.ts` `PUT /api/competitors/:id` | None; terminal HTTP 410 response | Disabled legacy route | Migrated; UI updates use Firestore transaction helpers |
| 3 | `server.ts` `DELETE /api/competitors/:id` | None; terminal HTTP 410 response | Disabled legacy route | Migrated; UI deletion retires the SI assignment and deletes the competitor atomically |
| 4 | Direct-entry and update/delete UI flows in `src/App.tsx` | Firestore competitor and assignment documents | Firestore transaction paths | Migrated for these CRUD flows; competition deletion is separately disabled pending an assignment-aware lifecycle flow |
| 5 | Eventor `/api/eventor/import-event` | Previously wrote imported competitors, classes, metadata, and runnerDb to Express `seasonDb` | Disable-only legacy route | Returns HTTP 410 before fetching or mutating data; Eventor club-to-RunnerDb sync remains separate and does not create competitors |
| 6 | IOF `/api/import/batch` with non-empty `entries` | Previously created competitors and RunnerDb entries in Express `seasonDb` | Disable-only legacy identity path | Returns HTTP 410 before any writes when entries are present; authenticated UI writes competitors through `saveCompetitionImportToFirestore` and sends an empty entries list to the Express compatibility mirror |
| 7 | Eventor `/api/eventor/sync-club` and IOF `/api/import/batch` with no entries | RunnerDb, courses, and classes in Express `seasonDb` | Redirectable non-identity compatibility paths | No competitor create or assignment mutation; authenticated UI also writes supported domain data to Firestore |
| 8 | `src/firebase.ts` `deleteCompetitionFromFirestore`, Firestore competition parent delete rule, `server.ts` `DELETE /api/competitions/:id`, and administration UI | Competition and competitor tree | Disable-only lifecycle paths | Disabled: client helper throws, parent delete rule denies, Express route returns HTTP 410, and UI delete action is removed. Assignment-aware deletion is not implemented. |
| 9 | `server.ts` `/api/system/clear-demo` and `/api/system/reset-seed` | Legacy season and competitor mirrors; reset may also replace seeded RunnerDb | Disable-only administrative paths | Both return HTTP 410 before mutation; the clear-all UI action and unused demo reset fallback were removed. |
| 10 | `server.ts` `/api/system/restore` | Local/Express season state | Guarded restore path | Rejects competition-ID-set changes and existing competitor identity/lifecycle changes; restores only a same-competition-set legacy mirror. Does not write Firestore assignments. |
| 11 | `src/firebase.ts` `syncFullSeasonToFirestore` | Firestore competitors and SI assignments | Snapshot seed writer | Missing-record seeds create matching competitor/assignment pairs per transaction; existing competitor overwrites/deletes remain blocked; migrated |
| 12 | `src/firebase.ts` `saveCompetitionImportToFirestore` | Firestore competitors and SI assignments | Import writer | Creates and validates assignments in per-competitor transactions; rejects import-driven SI/card-series changes; migrated |
| 13 | `server.ts` cloud-hydrate | Local/Express competitor mirror | Guarded compatibility hydration | Identity changes, additions/removals, duplicates, and omitted competitions are fenced; non-identity mirror hydration remains |
| 14 | `server.ts` `/api/readout` and online-punch compatibility processing | Legacy event/readout/result state | Compatibility/result path | Competitor identity auto-create removed; readout/result ownership is not fully migrated |
| 15 | `src/firebase.ts` readout auto-create helper | Firestore competitor, assignment, receipt, counts | Canonical transaction path | Migrated; not an active legacy identity blocker |
| 16 | `src/firebase.ts` `saveDirectCompetitionEntryToFirestore`, `updateCompetitorInFirestore`, `deleteCompetitorFromFirestore` | Firestore competitor and assignment documents | Assignment-aware client transaction paths | Implemented for covered operations; client paths/rules do not replace all-writer trusted enforcement |
| 17 | `src/utils/siAssignmentDiagnostics.ts` mutation declarations | Diagnostics only | Observability, not enforcement | Must not be counted as a writer guard |

RunnerDb directory CRUD is retained as a distinct runner-directory domain. It is not itself a competitor identity mutation, but any importer or consumer that turns its records into competitor identities must use the canonical competitor/assignment flow. Readout auto-create now does so.

## Readout identity writer status

The earlier Express `POST /api/readout` and online-punch auto-create branches inserted runnerDb-derived competitors into `seasonDb` without a Firestore assignment. Those writes have been removed. The browser Firestore readout transaction now pairs competitor creation with an active SI assignment, immutable receipt, and count updates; it fails closed to an `UNKNOWN` receipt when ownership/identity checks do not pass.

This migration does not make the legacy Express endpoint the canonical receipt/result processor. Its remaining compatibility limitations are described in [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md).

## Authority and uniqueness notes

- `runCompetitorMutation` and related diagnostics report intent; they do not reject legacy writes.
- Covered Firestore competitor and assignment mutations use transactions, and the initial rules fence requires paired writes for those client operations.
- These protections do not cover legacy server/Admin SDK writes, every import/restore path, or all possible writers.
- Duplicate candidate scans outside a Firestore transaction are diagnostic, not a global concurrency guarantee. Do not equate transaction scaffolding or rule fencing with system-wide uniqueness enforcement.

Eventor/IOF import migration details are in [EVENTOR_IOF_IMPORT_MIGRATION.md](./EVENTOR_IOF_IMPORT_MIGRATION.md). The disabled Express entry-import routes and authenticated Firestore import are distinct paths. Competition-deletion path details and disablement are in [COMPETITION_DELETION_MIGRATION.md](./COMPETITION_DELETION_MIGRATION.md). For the authoritative list of remaining work that blocks cutover, see [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).
