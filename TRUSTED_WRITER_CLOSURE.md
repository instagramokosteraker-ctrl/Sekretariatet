# Trusted Writer Closure

- Assessment: 2026-11-11 11:03 CET.
- Verdict: **FAIL — assurance is incomplete and a client bypass remains under the latest identified deployed rules.**
- Scope: repository writer paths and previously captured read-only project IAM/service evidence. No IAM, credentials, deployment, or production data were changed.

## Repository writer inventory

| Capability | Repository writers reviewed | Transaction / boundary status | Closure |
|---|---|---|---|
| Competitor creation | Direct entry, Firestore import/snapshot, readout auto-create, missing-assignment bootstrap in `src/firebase.ts` | Canonical writes pair competitor and assignment in per-competitor transactions; readout receipt/counters share its transaction. Import/bootstrap can partially complete across multiple competitors. | Repository paths reviewed; emulator behavior not verified. |
| Competitor update and SI reassignment | `updateCompetitorInFirestore` | Identity changes re-read and mutate competitor/assignment together; reassignment retires the prior assignment and creates/activates the successor. | Source-level assurance only. |
| SI assignment creation | Direct entry, import/snapshot, readout, bootstrap | The public standalone assignment creation export was removed; repository identity writers use the private atomic mutation boundary. | Source-level assurance only. |
| SI retirement and competitor deletion | `retireCompetitorInFirestore`, `deleteCompetitorFromFirestore` | Retirement and associated competitor transition/deletion are paired; destructive competition deletion/reset routes are disabled. | Source-level assurance only. |
| Legacy Express competitor CRUD / Eventor-IOF mirrors | Legacy handlers and import mirrors in `server.ts` | CRUD/Eventor routes fail closed; IOF competitor writes use the canonical Firestore path. | No active repository bypass found. |
| Server Admin SDK writer | Repository dependencies and server write paths | No `firebase-admin` or `@google-cloud/firestore` dependency or competitor/assignment Admin SDK writer was found. | Does not cover external systems. |

Source-based writer details and locations are in [TRUSTED_WRITER_ASSURANCE.md](./TRUSTED_WRITER_ASSURANCE.md).

## Cloud principals and external writers

The available prior read-only IAM view showed a human principal with **Owner (Legacy)** and a `firebase-adminsdk` identity with Firebase Admin SDK Administrator Service Agent and Service Account Token Creator roles. Those identities are privileged; the captured evidence does not establish whether the service identity is used by a competitor writer.

Prior Cloud Run Services and Jobs views showed no entries. The service-account page did not load. The following remain unverified:

- complete effective project, organization, and folder IAM, including inherited access and deny policies;
- service-account keys, impersonation, and other credential use;
- Cloud Functions, Scheduler, Tasks, scripts, and other runtimes;
- CI/CD deployment identities and external automation;
- Firebase Console write-capable users and Cloud Audit Logs for competitor/assignment writes.

The latest identified deployed Firestore rules allow direct assignment create/update/delete without paired competitor changes. This is a known client-side bypass; Firestore Rules also do not restrict Admin SDK writes. See [DEPLOYED_RULE_CLOSURE.md](./DEPLOYED_RULE_CLOSURE.md).

## Closure decision

**FAIL.** Repository paths are inventoried and routed through the intended boundary, but repository review cannot establish the complete production writer population. The known client bypass remains under the latest identified deployed rules, and privileged external writers are not fully inventoried or constrained. Closure requires a project-wide principal/service/automation register, effective IAM and credential review, audit-log review, named owners for each writer, and evidence that each writer uses the canonical boundary or has no write authority.
