# Trusted Writer Assurance

- Assessment date: 2026-11-11.
- Scope: repository writers and read-only project-level evidence for principals and deployed services.
- Production data and rules were not changed.

## Verdict

**INCOMPLETE; a bypass path remains.** The repository-local review found the competitor/SI-assignment mutation paths concentrated in `src/firebase.ts`, with identity mutations routed through transaction boundaries. The production rules release inspected in the Firebase Console is materially older than the repository rules and permits assignment mutations without a paired competitor write. In addition, the available IAM view is not a complete inventory of every effective principal, key, job, CI identity, or audit-log writer.

## Repository writer inventory

| Operation / path | Repository entry point | Atomic SI Matching | Assignment Boundary Hardening | Current repository rules | Observed deployed rules |
|---|---|---|---|---|---|
| Missing-assignment bootstrap | [`generateMissingSIAssignmentsFromFirestore`](./src/firebase.ts#L968) | Per-competitor transaction rereads competitor and assignment; creates the assignment and touches the competitor together. | Yes; validates path identity, SI, card series, owner, and fails closed. Earlier successful candidates are not rolled back if a later candidate fails. | Requires a paired competitor mutation. | No paired-write predicate in the inspected release; direct assignment creation is permitted to admins. |
| Direct competitor entry | [`saveDirectCompetitionEntryToFirestore`](./src/firebase.ts#L6310) | Yes; competitor, assignment, and competition counters share a transaction through the private mutation boundary. | Yes; duplicate-query and assignment conflicts fail before commit. | Requires matching competitor and assignment post-state. | The older rules do not require the paired assignment/competitor state. |
| Import and snapshot seed | [`writeImportedCompetitorWithAssignment`](./src/firebase.ts#L1907), called by import/snapshot flows | Yes for new competitors; existing records are revalidated transactionally and import cannot change SI/card series. | Yes; per competitor, fail-closed. Batch import is not all-or-nothing. | Requires a paired write for identity creation and validates assignment parity. | Not equivalent to repository rules; independent assignment writes are allowed. |
| Admin competitor identity update / SI reassignment | [`updateCompetitorInFirestore`](./src/firebase.ts#L4441) | Yes; SI/card-series identity changes use the private assignment mutation transaction. | Yes; validates current and target assignments and aborts on conflicts or invalid state. | Requires matching assignment state for identity changes. | Older competitor rules lack the corresponding after-state assignment checks. |
| Competitor delete / retirement | [`deleteCompetitorFromFirestore`](./src/firebase.ts#L4928), [`retireCompetitorInFirestore`](./src/firebase.ts#L5002) | Yes; assignment retirement and competitor deletion/status change commit together. | Yes; invalid or incomplete retirement aborts the transaction. | Direct assignment deletion is denied; the paired lifecycle change is validated. | Assignment deletion is explicitly allowed to admins in the inspected release. |
| Readout auto-create | [`submitReadoutToFirestore`](./src/firebase.ts#L5714) | Yes; competitor, assignment, receipt, and counters are written in one transaction. Idempotent receipt replay is checked. | Yes; identity conflicts and failed duplicate checks do not create an identity. | Requires matching competitor/assignment state. | Older rules do not enforce the paired state. |
| Existing-competitor result/status updates | `updateCompetitorInFirestore` and Firestore readout/result flows | Not an SI-identity mutation; role-limited updates preserve identity fields. | Yes, by restricting these paths to non-identity fields; SI/card-series changes take the atomic path. | Preserves identity and assignment invariants. | The inspected release predates those paired-write checks; no full field-by-field equivalence is asserted. |
| Legacy Express competitor CRUD | [`server.ts`](./server.ts#L4710) | Disabled: terminal HTTP 410 handlers are registered before the old POST/PUT/DELETE bodies. | No active route write; old bodies remain dormant in source. | Not applicable. | Not applicable to Firestore rules. |
| Eventor/IOF Express mirrors; reset/restore/deletion | [`server.ts`](./server.ts#L5435), [`server.ts`](./server.ts#L6042), [`server.ts`](./server.ts#L3699), [`server.ts`](./server.ts#L4133), [`server.ts`](./server.ts#L6102), [`server.ts`](./server.ts#L6183) | Eventor competitor import and destructive/reset paths are disabled; IOF competitor writes use the canonical Firestore import path. | Disabled or redirected; restore fences protected identities. | Competition deletion and direct assignment deletion are denied. | Stale rule release permits direct assignment deletion; Express fail-closed guards do not close this Firestore client path. |
| Server Firestore REST access | [`server.ts`](./server.ts#L481) | Eventor configuration REST reads/writes have been removed; admin-role and role-assignment calls remain reads. No competitor or assignment REST writer was found. | Not a competitor/assignment writer. | Rules apply to these user-token requests. | Not a competitor/assignment write path. |

The UI, offline readout queue, and inventory view do not contain independent competitor/assignment SDK write calls; they call the `src/firebase.ts` mutation functions or perform read-only inventory work. The Firebase SDK instance, assignment references, and `runAtomicSIAssignmentMutation` are private to that module. The repository has no `firebase-admin` or `@google-cloud/firestore` dependency. These findings are source-based and do not rule out code or scripts outside this repository.

## Read-only project evidence

- The Google Cloud IAM project “Allow” view showed a human principal with **Owner (Legacy)** and a `firebase-adminsdk` service identity with the **Firebase Admin SDK Administrator Service Agent** and **Service Account Token Creator** roles. These are privileged administrative identities; the view alone does not establish that the service identity is used by a running competitor writer.
- Cloud Run Services and Cloud Run Jobs views showed no deployed entries at the time checked.
- The Service Accounts page failed to load. Service-account keys/impersonation, Cloud Functions or other runtimes, Cloud Scheduler, audit logs, organization/folder inheritance and deny policies, and external CI/deployment identities were not verified. The IAM view had Google-provided grants excluded, so it is not a complete effective-access inventory.
- Firebase Security Rules are a separate client-write control. The inspected latest/star-marked Console release allows assignment create/update/delete without paired competitor validation; see [DEPLOYED_RULE_ASSURANCE.md](./DEPLOYED_RULE_ASSURANCE.md).

## Bypass assessment

**Yes.** A client principal authorized by the inspected deployed rules can directly create or update an SI assignment, or delete one, without the corresponding atomic competitor mutation. The current repository rules close this client path, but they are not the rules shown in the latest Console release. Project-level privileged identities and out-of-repository writers remain unverified. No reachable in-repository Express CRUD bypass was found; the old route bodies are unreachable behind the earlier 410 handlers.

## Required closure evidence

1. Deploy the reviewed `firestore.rules` through the approved production change process and verify the active release/revision and source hash. No deployment was performed in this assessment.
2. Complete effective IAM, service-account/key and impersonation, Cloud Functions/Run/Scheduler, CI/CD, and Cloud Audit Logs inventories. Name an owner for every principal that can write competitor or assignment documents; constrain any Admin SDK writer to an approved implementation or remove its write authority.
3. Execute the rules regression suite and assignment-specific positive/negative cases in an isolated emulator.
4. After those controls pass, reconcile the full competition scope and run the concurrency, retry, and recovery validations. The six existing `ownerUid` parity findings remain a separate unresolved data/provenance blocker.
