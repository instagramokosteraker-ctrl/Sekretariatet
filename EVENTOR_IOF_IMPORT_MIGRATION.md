# Eventor and IOF Import Migration

Assessment date: 2026-11-10.

The canonical readiness verdict and single remaining blocker list are maintained in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).

## Result

Eventor/IOF Express routes no longer create or update competitor documents in `seasonDb`.

- Authenticated IOF entry imports in `src/App.tsx` create/update competitors through `saveCompetitionImportToFirestore`. That helper validates identity ownership and writes each competitor with its SI assignment in the same Firestore transaction.
- The authenticated IOF compatibility request to `/api/import/batch` now sends an empty `entries` list. It may mirror courses, classes, and RunnerDb records, but not competitor identities.
- `/api/import/batch` returns HTTP 410 for any non-empty `entries` list before loading or mutating the active season. Course/class/RunnerDb-only compatibility imports remain available.
- `/api/eventor/import-event` returns HTTP 410 before Eventor network requests or any season/configuration writes. Eventor competitor import is disabled; it is not redirected because the former server route did not return a canonical import payload suitable for the Firestore client transaction.
- Eventor club synchronization remains available for RunnerDb records. It does not create competitors or SI assignments.

## Flow inventory and classification

| Flow | Competitor create/update | Assignment create/mutation | Direct competitor writes / `seasonDb` effects | Classification |
|---|---|---|---|---|
| Authenticated IOF EntryList/CompetitorList import in `src/App.tsx` | Builds imported competitor records in client memory, then calls `saveCompetitionImportToFirestore`; same-SI records can receive non-identity updates after identity and owner validation. SI/card-series changes are rejected. | `writeImportedCompetitorWithAssignment` validates or creates the active assignment atomically with the competitor. | No direct Express competitor write. Local React state is updated after Firestore save succeeds. | **Canonical.** |
| Authenticated IOF mirror request from `src/App.tsx` to `/api/import/batch` | Sends `entries: []`; cannot create or update competitors. | None. | Mirrors only courses, classes, and the merged RunnerDb list. Class replacement is rejected before mutation if it would remove a class still referenced by an Express competitor; the route no longer rewrites competitor `classId`. | **Redirectable non-identity compatibility path.** |
| Unauthenticated IOF batch request to `/api/import/batch` with entries | Previously created Express competitors and RunnerDb rows in `seasonDb`; now rejected with HTTP 410 before any writes. | Previously none; no SI assignment was created or changed. | No competitor `push`, `update`, or `saveSeasonDatabase` occurs for a request with entries. | **Disable-only.** Competitor entry imports require the authenticated canonical Firestore flow. |
| IOF batch request with courses/classes/RunnerDb only | No competitor create or update. | None. | Express mirror persists only those supported domains. Competitor class remapping was removed; unsafe class replacement is rejected. | **Redirectable non-identity compatibility path.** |
| Eventor event import: `CompetitionSettingsView` → `src/App.tsx` → `/api/eventor/import-event` | Previously created classes and competitors in the active Express event, and changed competition metadata. The route now returns HTTP 410 before fetching Eventor data or mutating state. | Previously none. | The previous direct competitor push, class/metadata changes, runnerDb upserts, and `saveSeasonDatabase` call have been removed from this route. The client surfaces the endpoint error. | **Disable-only.** No Eventor-to-Firestore payload adapter exists; use authenticated IOF import instead. |
| Eventor club sync: `/api/eventor/sync-club` | No competitor create or update. | None. | Updates RunnerDb in Express `seasonDb`; the UI also saves returned RunnerDb entries with `saveRunnerDbEntriesToFirestore`. | **Redirectable non-identity directory sync.** |
| Eventor settings/configuration endpoints | No competitor create or update. | None. | Read/write Eventor configuration metadata, not competitor or assignment documents. | **Non-identity; unchanged.** |
| Firestore IOF import helper `saveCompetitionImportToFirestore` | Creates and same-identity updates competitors. | Creates a matching assignment for a new valid SI or verifies the existing active assignment. | Does not use Express `seasonDb` for competitor identity. | **Canonical transaction path.** |

## Invariants and enforcement

For authenticated IOF competitor creation, the canonical Firestore helper guarantees the competitor document ID and stored `competitorId` agree; the assignment document ID and SI number agree; both assignment competitor references match that competitor ID; and competition and `ownerUid` match. Duplicate-SI candidates, malformed/conflicting assignments, ownership mismatches, and failed duplicate checks fail the transaction.

The Express compatibility endpoints do not create SI assignments. They cannot be treated as canonical fallbacks. `runCompetitorMutation` diagnostics were not enforcement; the migration removes the underlying legacy writes instead.

IOF multi-competitor import remains per-competitor transactional rather than globally atomic. A later competitor failure can occur after earlier competitor transactions have committed; callers receive the error and must reconcile/retry. This does not allow an unpaired competitor/assignment write.

## Validation and limits

- `npm run build` and `npm run lint` pass after the change.
- `git diff --check` passes.
- No HTTP route test harness is configured in the repository. Route behavior was verified by inspecting the guards and confirming competitor writes are absent from the disabled Eventor path and IOF import path.
- These checks do not execute Firestore rules or establish deployed trusted-writer enforcement.

## Next blocker

Eventor/IOF competitor identity writes are no longer active blockers. The highest-priority remaining blocker is assignment-aware competition deletion: `deleteCompetitionFromFirestore` must resolve/retire SI assignments atomically with competitor deletion. See the canonical blocker list in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).
