# Post-CRUD Readiness Review

Historical assessment date: 2026-11-10.

This review was the inventory immediately after legacy competitor CRUD retirement. It identified Firestore import and snapshot competitor writes as the highest-priority blocker. That blocker has since been addressed with per-competitor assignment-aware transactions; the current assessment and the single canonical blocker list are maintained in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).

## Historical finding

At the time of this review:

- Readout auto-create and the legacy `POST`, `PUT`, and `DELETE /api/competitors` routes had been migrated or disabled.
- `saveCompetitionImportToFirestore` and `syncFullSeasonToFirestore` still wrote competitor documents without creating or validating matching SI assignments.
- Eventor/IOF Express import mirrors, competition deletion, administrative mirror lifecycle paths, and trusted-writer/operational validation remained open.

The Firestore import and snapshot findings are superseded by [IMPORT_SNAPSHOT_MIGRATION.md](./IMPORT_SNAPSHOT_MIGRATION.md). The other items remain subject to the canonical status document; this historical review is not a second active blocker list.
