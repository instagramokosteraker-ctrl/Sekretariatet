# Competition Deletion Migration

Status: competition deletion and destructive season reset paths are disabled until assignment-aware lifecycle deletion is implemented.

## Decision

**Deletion is not safe to migrate with the current assignment rules and transaction model.** Competition deletion, clear-all, and demo reset now fail closed. The Firestore helper rejects deletion, Firestore rules deny deletion of competition parent documents, Express endpoints return HTTP 410, and the administration UI no longer offers delete or clear-all actions.

This closes the deletion bypass by disablement; it does not implement competition deletion or resolve existing orphaned data.

## Path inventory

| Path | Previous behavior and risk | Current behavior | Assignment/transaction result |
|---|---|---|---|
| `src/firebase.ts` `deleteCompetitionFromFirestore` | Listed courses, classes, competitors, stations, punches, and receipts, deleted them in batches, then deleted the parent separately. It omitted `siCardAssignments`. A failed batch could leave partial cleanup; deleting the parent does not cascade to subcollections. | Always rejects with an explicit disabled error. | No writes. The previous path did not retire assignments, validate each competitor/assignment owner pair, or use one atomic lifecycle operation. |
| Firestore `/competitions/{id}` parent delete rule | Admins could delete the parent independently. | `allow delete: if false`; rules tests assert race-admin deletion fails. | Prevents client parent deletion from stranding active assignment and child documents. Admin SDK writers bypass rules and remain in the trusted-writer blocker. |
| Firestore `siCardAssignments` delete | Assignment deletion is explicitly denied; assignment lifecycle changes use the transactional retire/reassign workflow. | Unchanged; direct assignment delete remains denied. | A bulk competition deletion cannot safely delete assignment docs. A future design must preserve retirement history or otherwise resolve each ownership reference transactionally before cleanup. |
| Firestore competitor delete | Rules require a corresponding retired assignment mutation; the former bulk helper did not perform that retirement. | No UI call path; protected parent delete is denied. | The former sequence was not a valid paired competitor/assignment lifecycle transaction. |
| Administration UI per-competition delete | Called the Firestore helper and, on success, deleted the Express mirror. Without Firestore sign-in it called the Express DELETE route directly. | Delete action removed; UI explains that deletion is temporarily disabled. | No client-side deletion path remains. |
| Express `DELETE /api/competitions/:id` | Removed the event and competitor mirror from `seasonDb`, selected another active event, and persisted. Did not touch Firestore assignments or RunnerDb. | Returns HTTP 410 before mutation. | No SI assignment writes or transaction boundaries existed. |
| Express `POST /api/system/clear-demo` | Removed all `seasonDb` events and competitor mirrors. RunnerDb was retained for the UI's `clearRunnerDb: false` request, but could also be cleared when requested. A subsequent snapshot push did not delete omitted Firestore competitions. | Returns HTTP 410 before mutation; the UI clear-all action was removed. | Previously bypassed assignment retirement in the legacy mirror. The Firestore snapshot path does not cascade-delete omitted competitions, so it could also create a misleading divergence rather than safely delete cloud data. |
| Express `POST /api/system/reset-seed` | Replaced `seasonDb` with a fresh seed; did not clean up Firestore assignment/subcollection documents. | Returns HTTP 410 before mutation. | No assignment-aware transaction. The old UI fallback to Firestore demo seeding was removed with the unused reset handler. |
| Express `POST /api/system/restore` | Replaced the legacy season state. It already rejects competitor identity, SI number, card-series, or lifecycle changes, but could add/remove competition IDs when no protected competitor tuple changed (for example, an empty competition). It replaces RunnerDb from the backup. | Rejects any competition-ID-set change with HTTP 409, in addition to the existing competitor-identity guard. | No Firestore writes or assignment mutations. Restoring a backup remains a legacy mirror operation; it cannot remove Firestore competitions or assignments. |
| `src/firebase.ts` full-season snapshot sync | Seeds missing competitor records and matching assignments transactionally; existing identity overwrites/deletions are blocked. Omitted competitions are not deleted. | Unchanged; omission does not delete Firestore competitions. | Snapshot competitor creates use matching competitor/assignment transaction writes. There is no snapshot-driven deletion transaction. |

## Side effects and ownership findings

- **Competitor documents:** The former Firestore helper attempted child deletion without retiring SI assignments in the same transaction. The Express delete and clear/reset paths removed only legacy `seasonDb` competitors.
- **SI assignments:** Assignment documents were not included in the Firestore delete query. Direct assignment deletion is denied, and active assignments could therefore have remained behind if a parent or competitor document were removed through a privileged writer.
- **Orphaned references:** Firestore does not cascade-delete nested collections when a competition parent is deleted. Partial batch completion could leave some competition subcollections behind; omitting `siCardAssignments` could leave active ownership documents without competitor documents. The client rules now deny parent deletion, but they cannot constrain Admin SDK writers.
- **Snapshot behavior:** A full-season snapshot that omits an event does not delete that Firestore competition. Clearing the Express mirror and then pushing a snapshot could therefore leave cloud competitions intact while the local mirror appeared empty.
- **RunnerDb:** Single competition deletion did not touch RunnerDb. Clear-all retained it in the first-party request but supported a `clearRunnerDb` option; reset-seed replaced the season seed. RunnerDb is a shared runner directory, not competition-owned identity data, so deletion must not infer RunnerDb cleanup from competition ownership.
- **Transaction boundaries:** The old Firestore deletion was a sequence of collection reads, multiple write batches, parent deletion, and a later club-settings update. It was neither atomic across the lifecycle nor assignment-aware. The Express paths persisted legacy state without SI assignment transactions.

## Validation and remaining work

`npm run build`, `npm run lint`, and `git diff --check` pass. The build reports existing Vite configuration and large-chunk warnings. Firestore rules regression tests require the Firestore emulator; Firebase CLI/emulator tooling is not available in this environment, so the new rule assertions were not executed here.

Competition deletion must remain disabled until a trusted lifecycle operation can enumerate all competitors and assignments, validate ownership and identity pairing, preserve assignment retirement history, and handle large subcollections and retry/partial-failure behavior without leaving active or dangling ownership references.

The canonical readiness verdict and remaining blocker list are maintained in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md). After deletion paths were disabled, the highest-priority remaining blocker is trusted-writer enforcement and production-wide uniqueness validation.
