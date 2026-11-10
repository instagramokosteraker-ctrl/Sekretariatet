# Legacy Writer Inventory for Competitor Ownership Migration

Status: reassessed 2026-11-10. This inventory documents current migration status; it is not an independent readiness checklist.

The canonical active blocker list and overall verdict are maintained in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md). Readout auto-create is migrated and is not an active identity-writer blocker.

## Summary

Competitor identity ownership is not yet fully cut over. Legacy Express CRUD/direct-entry, import, reset/restore, competition lifecycle, and snapshot/import paths remain to be redirected, disabled, or safely constrained. The Firestore assignment transaction and rules work protects the paths covered by the implementation, but diagnostics and client rules do not provide a trusted all-writer boundary or global uniqueness by themselves.

The former readout auto-create bypass has been removed. See [READOUT_AUTO_CREATE_MIGRATION_PLAN.md](./READOUT_AUTO_CREATE_MIGRATION_PLAN.md) for the historical rationale and migrated behavior.

## Writer inventory

| # | Path / file | Write target | Current classification | Current status |
|---|---|---|---|---|
| 1 | `server.ts` `POST /api/competitors` | `seasonDb.eventsMap[*].competitors` | Legacy identity writer | Active blocker; redirect or disable |
| 2 | `server.ts` `PUT /api/competitors/:id` | `seasonDb.eventsMap[active].competitors[id]` | Legacy identity/SI writer | Active blocker; redirect or disable |
| 3 | `server.ts` `DELETE /api/competitors/:id` | Active competition competitors | Legacy deletion writer | Active blocker; use assignment-aware retirement/deletion |
| 4 | `server.ts` direct-entry and related UI fallbacks in `src/App.tsx` | Express season state and/or Firestore | Mixed-authority | Active blocker; enforce one canonical write path |
| 5 | Eventor import and IOF/import-batch paths | Imported competitors and related season data | Legacy/import writer | Active blocker; route all identity changes through the canonical transaction |
| 6 | `server.ts` `DELETE /api/competitions/:id` | Competition and competitor tree | Legacy lifecycle writer | Active blocker; define assignment retirement/retention behavior |
| 7 | `server.ts` `/api/system/reset-seed`, restore, and clear-demo paths | Season and competition state | Legacy seed/restore/removal writer | Active blocker until identity and assignment mutations are blocked or canonical |
| 8 | `src/firebase.ts` `syncFullSeasonToFirestore` | Firestore competitors | Snapshot writer | Existing competitor updates/deletes are blocked; missing-record seeding remains controlled/review-required |
| 9 | `src/firebase.ts` `saveCompetitionImportToFirestore` and related bulk imports | Firestore competitors | Import writer | Requires complete assignment-aware policy; active blocker |
| 10 | `server.ts` cloud-hydrate | Local/Express competitor mirror | Guarded compatibility hydration | Identity changes, additions/removals, duplicates, and omitted competitions are fenced; non-identity mirror hydration remains |
| 11 | `server.ts` restore | Local/Express season state | Guarded restore | Competitor identity/lifecycle changes are rejected; non-identity data may still be restored |
| 12 | `server.ts` `/api/readout` and online-punch compatibility processing | Legacy event/readout/result state | Compatibility/result path | Competitor identity auto-create removed; readout/result ownership is not fully migrated |
| 13 | `src/firebase.ts` readout auto-create helper | Firestore competitor, assignment, receipt, counts | Canonical transaction path | Migrated; not an active legacy identity blocker |
| 14 | `src/firebase.ts` `saveDirectCompetitionEntryToFirestore`, `updateCompetitorInFirestore`, `deleteCompetitorFromFirestore` | Firestore competitor and assignment documents | Assignment-aware client transaction paths | Implemented for covered operations; client paths/rules do not replace all-writer trusted enforcement |
| 15 | `src/utils/siAssignmentDiagnostics.ts` mutation declarations | Diagnostics only | Observability, not enforcement | Must not be counted as a writer guard |

RunnerDb directory CRUD is retained as a distinct runner-directory domain. It is not itself a competitor identity mutation, but any importer or consumer that turns its records into competitor identities must use the canonical competitor/assignment flow. Readout auto-create now does so.

## Readout identity writer status

The earlier Express `POST /api/readout` and online-punch auto-create branches inserted runnerDb-derived competitors into `seasonDb` without a Firestore assignment. Those writes have been removed. The browser Firestore readout transaction now pairs competitor creation with an active SI assignment, immutable receipt, and count updates; it fails closed to an `UNKNOWN` receipt when ownership/identity checks do not pass.

This migration does not make the legacy Express endpoint the canonical receipt/result processor. Its remaining compatibility limitations are described in [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md).

## Authority and uniqueness notes

- `runCompetitorMutation` and related diagnostics report intent; they do not reject legacy writes.
- Covered Firestore competitor and assignment mutations use transactions, and the initial rules fence requires paired writes for those client operations.
- These protections do not cover legacy server/Admin SDK writes, every import/restore path, or all possible writers.
- Duplicate candidate scans outside a Firestore transaction are diagnostic, not a global concurrency guarantee. Do not equate transaction scaffolding or rule fencing with system-wide uniqueness enforcement.

For the authoritative list of work that blocks cutover, see [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).
