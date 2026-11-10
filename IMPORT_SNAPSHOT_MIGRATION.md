# Import and Snapshot Competitor Migration

Assessment date: 2026-11-10.

This document records the completed Firestore import/snapshot migration. The canonical status and remaining blockers are maintained in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).

## Result

Firestore import creates, same-identity updates, and missing-competitor snapshot seeds now use `writeImportedCompetitorWithAssignment` in `src/firebase.ts`. Each competitor and its SI assignment are validated and written in one Firestore transaction through `runAtomicSIAssignmentMutation`.

The transaction guarantees for a newly created competitor are:

- The sanitized competitor ID is both the Firestore competitor document ID and `competitor.competitorId`.
- `assignment.siNumber` and the assignment document ID match `competitor.siNumber`.
- `assignment.competitorId` and `assignment.competitorDocumentId` both match the competitor ID/document ID.
- The competitor and assignment use the same competition ID and owner UID.
- A pre-existing assignment is accepted only when it is active and agrees on SI, competition, competitor ID, card series, and owner. Otherwise the transaction fails.
- Duplicate competitor SI candidates or a failed duplicate query stop the write.

For existing imported competitors, the transaction verifies the document ID, stored `competitorId`, competition ID, owner, SI number, card series, and active assignment owner before updating non-identity fields. Imports cannot change SI number or card series; those changes must use the canonical SI reassignment flow.

## Firestore path inventory

| Path | Creates/imports/restores/hydrates? | Assignment behavior and ownership validation | Transaction boundary | Status |
|---|---|---|---|---|
| `src/firebase.ts` `saveCompetitionImportToFirestore` | Imports competitor creates and updates. The authenticated IOF import path calls it from `src/App.tsx`. | Creates the competitor and active assignment together when no assignment exists; validates an existing assignment before creating; for updates, requires an active assignment whose SI, competition, competitor/document ID, card series, and owner match the competitor. Import-driven SI/card-series changes are rejected. | One transaction per competitor via `runAtomicSIAssignmentMutation`. Courses, classes, and RunnerDb entries remain separate batched writes; the overall import is not all-or-nothing. | **Migrated.** |
| `src/firebase.ts` `syncFullSeasonToFirestore` | Seeds only missing competitor documents from season snapshots. App synchronization callers invoke this path. Existing competitor overwrites and snapshot-driven competitor deletions remain blocked. | Missing seeds use the same assignment-aware writer and atomically create the competitor/assignment pair. Pre-existing conflicting assignment or duplicate SI candidates fail closed. Existing documents are skipped, not snapshot-updated. | One transaction per missing competitor. Competition metadata and other child data are written separately, so a season sync is not globally atomic. | **Migrated.** |
| `src/firebase.ts` `saveDirectCompetitionEntryToFirestore` | Creates competitors from direct entry. | Existing atomic flow writes competitor and assignment with the same competition, competitor/document ID, SI, and owner; Firestore rules enforce the pair. | One Firestore transaction. | Already assignment-aware; not changed here. |
| `src/firebase.ts` `submitReadoutToFirestore` auto-create branch | Creates a competitor from a validated readout/RunnerDb match. | Writes competitor, active assignment, receipt, and counts with matching SI, competition, competitor/document ID, and owner. | One Firestore transaction. | Already migrated; not changed here. |
| `src/firebase.ts` `deleteCompetitionFromFirestore` | Deletes Firestore competitor documents during competition deletion. | Does not retire matching assignments in the same lifecycle operation. | Batched deletion, not an assignment-aware transaction. | **Remaining lifecycle blocker**, not an import/snapshot writer. |
| `/api/system/restore` and `/api/system/cloud-hydrate` in `server.ts` | Restore or hydrate the Express/local mirror; do not directly write Firestore competitor documents. Restore rejects identity/lifecycle changes; cloud hydrate fences identity changes and omissions. | No Firestore SI assignment is written by these endpoints. Any later Firestore snapshot seed is covered by `syncFullSeasonToFirestore` above. | Express/local mirror operations, outside Firestore transactions. | Not direct Firestore competitor writers; maintain the existing identity fences. |
| `seedDemoSeasonToFirestore` and `createCompetitionInFirestore` | Reset/demo-seed or create competition metadata. | Do not create Firestore competitor documents or SI assignments. | Their existing operation boundaries do not affect competitor identity. | Not competitor creation paths. |
| `/api/import/batch` and `/api/eventor/import-event` in `server.ts` | Create or update competitor identity in the persisted Express mirror. | Do not write Firestore competitors or SI assignments. Their data remains a legacy identity source and must not be treated as canonical Firestore ownership. | Express-side persistence, not a Firestore transaction. | **Remaining import-path blocker.** |
| Course/class-only import caller in `src/App.tsx` | Imports courses/classes only. | Now passes `competitors: []`, preventing existing competitors from being resubmitted as identity updates. | Course/class batch writes only. | Corrected as part of this migration. |

## Assignment checks and validation limits

- The migrated import/snapshot helper checks assignment state, competitor/document IDs, SI number, card series, competition ID, and `ownerUid` inside the transaction before updating or creating.
- New assignments and their competitor documents are committed together; Firestore rules independently require their post-write identities and owners to match.
- `resolveCompetitionSICardAssignmentReadOnly` still reports an active SI/document-SI match without checking stored `competitorId` or comparing assignment and competitor owners. It is read-only and does not authorize the migrated writes.
- `runAtomicSIAssignmentMutation` diagnostics are observational, not an authorization boundary. The import/snapshot write callback performs the explicit owner and identity checks, and Firestore rules remain the client-write enforcement layer.
- Firestore rules do not constrain Admin SDK writers. The legacy Express import routes and any trusted server writers still require migration or explicit disabling.
- Per-competitor transactions prevent a competitor from being committed without its matching assignment, but a multi-competitor import/sync can partially complete if a later row fails. Errors are surfaced to the caller; retry/reconciliation behavior for partially completed batches remains an operational validation item.

## Validation

`npm run build` and `npm run lint` pass after the migration. `git diff --check` passes. These checks do not execute Firestore security rules; emulator and deployed-rule verification remain required.

## Next blocker

The next highest-priority blocker is the Eventor/IOF Express import mirror boundary: those routes still create competitor identities outside Firestore assignment transactions. Migrate them to the canonical Firestore import path or disable them and prevent mirror data from becoming an identity source. The full ranked blocker list and readiness verdict are in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).
