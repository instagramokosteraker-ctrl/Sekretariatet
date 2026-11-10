# Post-CRUD Readiness Review

Assessment date: 2026-11-10.

This review reassesses the canonical [competitor cutover readiness](./COMPETITOR_CUTOVER_READINESS.md) after readout auto-create migration and legacy competitor CRUD retirement. The readiness document remains the source of truth; this document records the current ranked writer inventory and evidence.

## Verdict

**NO-GO** for competitor identity ownership cutover and global SI uniqueness enforcement.

Readout auto-create and the legacy `POST`, `PUT`, and `DELETE /api/competitors` routes are no longer active blockers. Remaining import and lifecycle writers are not consistently assignment-aware, and production-wide uniqueness and trusted-writer enforcement are not established.

> **What is the single highest-priority remaining blocker?**
>
> Close the Firestore import/snapshot competitor-write boundary: `saveCompetitionImportToFirestore` and `syncFullSeasonToFirestore` still write competitor documents outside the atomic SI-assignment mutation flow. The competitor-create rule checks that an assignment is `ACTIVE`, but does not bind that assignment to the incoming competitor ID. A create can therefore rely on an active SI assignment belonging to a different competitor.

## Ranked active writer inventory

| Rank | Classification | Active path | Current behavior and cutover risk |
|---:|---|---|---|
| 1 | Import path | `src/firebase.ts` `saveCompetitionImportToFirestore`, called by the authenticated IOF import flow in `src/App.tsx` | Writes competitor creates and updates in batched writes; does not create, retire, or reassign SI assignments atomically. This is the highest risk because the create rule only requires an active assignment for the SI number, not that it belongs to the incoming competitor. SI-changing updates may be rejected by rules, but same-SI identity updates remain a separate import write path. **High** |
| 2 | Import path | `src/firebase.ts` `syncFullSeasonToFirestore` snapshot seeding | Existing Firestore competitor documents are protected from snapshot updates/deletes, but missing documents are still queued for creation without a paired assignment mutation. The same assignment-to-competitor binding gap can allow a seeded competitor to reuse an SI with another active assignment. **High** |
| 3 | Import path | `server.ts` `/api/import/batch` and `/api/eventor/import-event` | Both create competitor identities in the persisted Express season mirror without assignment handling. The Eventor UI calls the Express import route; unauthenticated IOF import also uses the Express route, and authenticated IOF import mirrors the Firestore import to Express. These are legacy mirror writers, not canonical Firestore transactions, and their data can feed later snapshot seeding. **High** |
| 4 | Lifecycle path | `src/firebase.ts` `deleteCompetitionFromFirestore` | Deletes child documents in batches but does not include `siCardAssignments` or retire assignments atomically. Competitor deletion rules require a retired assignment, so deletion of active competitors is expected to fail; if a competitor is already deletable, its assignment documents can still be left orphaned. **High** |
| 5 | Administrative path | `server.ts` `/api/system/clear-demo`, `/api/system/reset-seed`, and `DELETE /api/competitions/:id` | These admin operations clear, replace, or delete competitors in the persisted Express mirror without canonical assignment lifecycle operations. They do not directly delete Firestore competitor documents, but can leave the mirror stale or empty and provide an unsafe identity source if subsequently synchronized. **Medium** |
| 6 | Administrative path | `server.ts` `/api/system/restore` | The restore guard rejects competitor additions/removals, competition moves, SI changes, card-series changes, and status changes. It still restores other competitor fields into the Express mirror, so it is a constrained mirror writer rather than a canonical Firestore identity mutation. Keep the guard and distinguish this limited behavior from unrestricted identity restore. **Low / contained** |
| 7 | Validation gap | Firestore rules, mutation diagnostics, and operational evidence | Client rules do not constrain Admin SDK writers; `runCompetitorMutations` diagnostics log intent but do not reject writes. No repository evidence establishes deployed-rule/emulator coverage of import/snapshot assignment ownership, global duplicate reconciliation, or concurrency/retry/rollback behavior. **High, cutover-wide** |

Ranks describe cutover risk, not the order of implementation. The first three rows are active import writers; the lifecycle and administrative rows affect the legacy mirror or fail to provide a complete assignment-aware lifecycle.

## Contained paths and exclusions

- Readout auto-create is migrated to the Firestore transaction flow; the Express readout and online-punch identity-creation branches are removed.
- Legacy `POST /api/competitors`, `PUT /api/competitors/:id`, and `DELETE /api/competitors/:id` return HTTP 410. First-party direct-entry, update, and delete flows use Firestore helpers.
- `updateCompetitorInFirestore`, `saveDirectCompetitionEntryToFirestore`, and `deleteCompetitorFromFirestore` use covered Firestore transaction paths. Their existence does not close the bulk import, snapshot, or competition-deletion paths above.
- Cloud hydrate fences competitor identity changes and preserves omitted local competitions. It is not counted as an active identity writer.
- The Firestore demo-season seed helper updates club settings and returns an empty season snapshot; it does not itself delete Firestore competition or competitor documents.

## Cutover decision

Remain **NO-GO** until the ranked import and lifecycle writers are migrated, disabled, or safely constrained; the Firestore assignment binding is enforced for every competitor create/reassignment; and trusted-writer, uniqueness, concurrency, retry, and rollback validation is evidenced. Passing build/lint or diagnostics alone is not sufficient.

The canonical blocker list and readiness rationale are maintained in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).
