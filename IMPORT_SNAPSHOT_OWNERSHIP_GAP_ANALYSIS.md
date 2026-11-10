# Import and Snapshot Ownership Gap Analysis

Assessment date: 2026-11-10.

Scope: Firestore competitor creation, import, restore, snapshot hydration, and season synchronization. This analysis does not migrate the remaining Express lifecycle/import routes.

## Result

The Firestore competitor create rule previously accepted any `ACTIVE` assignment at the incoming SI-number path. It did not bind the assignment to the competitor document ID, competitor `competitorId`, or owner. The Firestore rules now require the post-write competitor and active assignment to agree on:

- competition ID;
- SI number;
- competitor document ID and `competitorId`;
- assignment `competitorId` and `competitorDocumentId`;
- competitor and assignment `ownerUid`.

The assignment create/update rule also verifies that an active assignment's competitor document has the same owner. Readout's additional assignment check now explicitly verifies that owner as well. A mismatch fails the Firestore write.

This closes the client-rule ownership gap for competitor creates and SI-number reassignments. At the time of this analysis, Firestore import/snapshot writes still did not create assignments. Those paths have since been migrated; see [IMPORT_SNAPSHOT_MIGRATION.md](./IMPORT_SNAPSHOT_MIGRATION.md). Firestore rules do not constrain Admin SDK writers.

## Firestore competitor write-path inventory

| Path | Operation | Competitor ID / document ID | SI assignment relationship | Result |
|---|---|---|---|---|
| `src/firebase.ts` `saveDirectCompetitionEntryToFirestore` | Direct-entry create in one Firestore transaction | Generated `competitorId` is used as the competitor document ID and stored in `competitorId`. | Assignment document ID and `siNumber` use the requested SI; `competitorId` and `competitorDocumentId` use the generated competitor ID; both documents use the same `ownerUid`. The transaction and rules validate the pair. | Guaranteed by code plus rules. |
| `src/firebase.ts` `submitReadoutToFirestore` auto-create branch | Readout auto-create in one Firestore transaction | Sanitized runner ID is used as document ID and stored `competitorId`. | Assignment document ID and `siNumber` use the read SI; both competitor references use the same competitor ID; competitor and assignment use the same `ownerUid`. The receipt is written in the transaction. | Guaranteed by code plus rules. |
| `src/firebase.ts` `saveCompetitionImportToFirestore` | Import create/update; one transaction per competitor | Sanitized imported `competitor.id` is used as the Firestore document ID and stored as `competitorId`. | Creates the active assignment and competitor together when needed. For updates, verifies the existing competitor and active assignment agree on document/competitor ID, SI, competition, card series, and owner; rejects import-driven SI/card-series changes. | Migrated; the overall multi-competitor import is not atomic. See [IMPORT_SNAPSHOT_MIGRATION.md](./IMPORT_SNAPSHOT_MIGRATION.md). |
| `src/firebase.ts` `syncFullSeasonToFirestore` | Season snapshot seeds missing competitor documents | Sanitized snapshot `cmp.id` is used as document ID and stored as `competitorId`. | Missing competitor seed and SI assignment are created together after duplicate and existing-assignment checks. | Migrated; existing competitor overwrites and snapshot-driven deletes remain blocked. Season sync is not globally atomic. |
| `server.ts` `/api/system/restore` and `/api/system/cloud-hydrate` | Legacy local/Express restore or hydration | These mutate the local/Express mirror; neither directly writes Firestore competitor documents. Restore rejects changes to identity/lifecycle fields; cloud hydrate fences identity changes and omissions. | A later `syncFullSeasonToFirestore` seed uses the snapshot rule above. | No direct Firestore creation path. |
| `createCompetitionInFirestore`, `seedDemoSeasonToFirestore` | Competition creation or demo reset | These paths do not create Firestore competitor documents. | No competitor assignment write. | Not competitor create paths. |
| `server.ts` `/api/import/batch`, `/api/eventor/import-event` | Legacy IOF/Eventor imports to persisted Express season state | Creates competitor identities only in the Express mirror. | No Firestore assignment is created here. Any subsequent Firestore snapshot seed is governed by `syncFullSeasonToFirestore`. | Not direct Firestore writers; remain separate legacy mirror blockers. |

## Active-assignment checks audited

| Location | Previous gap | Current enforcement |
|---|---|---|
| `firestore.rules` `hasActiveSIAssignmentAfter`, used by competitor create and SI-changing competitor update | Checked only that the SI assignment existed after the write and was `ACTIVE`; did not compare assignment owner or competitor identity. | Requires assignment/document IDs, SI, competition, and owner to match the post-write competitor. |
| `firestore.rules` `assignmentMatchesCompetitorAfter`, used by assignment create/update | Checked competitor ID and SI, but not competitor owner. | Active (and retained retired) assignment checks now require competitor `ownerUid` to match assignment `ownerUid` and competition. |
| `firestore.rules` `readoutAssignmentMatchesRunnerDb` | Checked active state, runner identity, SI, and card series; owner match was only implicit in the surrounding rules. | Now explicitly compares assignment and competitor owner. |
| `src/firebase.ts` `runAtomicSIAssignmentMutation` | Its assignment consistency result is diagnostic: it compares SI and competitor ID but does not enforce owner equality. | Not an authorization boundary; any resulting client write remains subject to the revised Firestore rules. |
| `src/firebase.ts` `resolveCompetitionSICardAssignmentReadOnly` | Reports `ACTIVE` after checking that the assignment is active and the referenced competitor exists with the same SI; it does not check competitor `ownerUid` or stored `competitorId`. | Read-only resolver, not used by a competitor creation/import/snapshot writer. This remains a separate assignment-read validation limitation; it cannot authorize a Firestore write. |
| Client-side diagnostic/planning utilities: `src/utils/siAssignmentInventory.ts`, `siCardAssignments.ts`, `siAssignmentRuleDiagnostics.ts`, and `siAssignmentWrites.ts` | Compare assignment state, SI, and/or competitor IDs but do not consistently compare assignment `ownerUid` to competitor `ownerUid`. Their reports and plans are observational and do not authorize writes. | Not Firestore write enforcement. Competitor writes are subject to the revised rules; full owner-aware diagnostic reporting remains outside this scoped change. |

## Regression coverage and limits

`firestore.rules.test.ts` now covers matching create success and rejects an active assignment with a different owner, competitor ID, `competitorDocumentId`, or SI number, a competitor field/document-ID mismatch, and an assignment whose owner differs from an existing competitor. It also rejects reusing an assignment for a second competitor.

The rules suite requires the Firestore emulator and is exported as `runFirestoreRulesDirtyDozenSuite`; no emulator endpoint or Firebase CLI is available in this environment. Build and TypeScript lint validate the application sources but do not execute Firestore security rules. Deployed-rule and emulator verification remain required.

## Historical blockers and current status

The first version of this analysis listed Firestore import and snapshot seeding as active blockers. Those Firestore paths are now migrated. Remaining blockers are maintained only in the canonical [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md); they include the separate legacy Eventor/IOF Express import mirrors, competition deletion, administrative mirror lifecycle paths, and trusted-writer/operational validation.

Overall competitor-ownership readiness remains **NO-GO**. This analysis is a historical record of the ownership-rule gap and is superseded for current path status by [IMPORT_SNAPSHOT_MIGRATION.md](./IMPORT_SNAPSHOT_MIGRATION.md).
