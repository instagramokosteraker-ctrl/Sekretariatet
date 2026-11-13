# PasserSI — project status handoff

**Prepared:** 2026-11-13  
**Repository:** `instagramokosteraker-ctrl/Sekretariatet`  
**Branch / HEAD:** `main` / `e0e5744`  
**Purpose:** Give a new AI a concise, evidence-based picture of implementation and operational readiness.

## Executive status

**Competitor identity cutover and system-wide enforcement of per-competition SI uniqueness remain NO-GO.**

The repository has substantial transaction and Rules hardening, but that is not proof of production enforcement. The latest recorded Firebase Console inspection (2026-11-11) found the identified active Firestore Rules release materially behind repository `firestore.rules`, with assignment create/update/delete and SI-reassignment bypasses. The active release could not be immutably identified or attested. Do not treat source rules as deployed rules.

There are also six unresolved active `ownerUid` parity findings in the last V2 production scan, incomplete production inventory and trusted-writer assurance, and no recorded concurrency/retry/recovery validation. No production rules or data changes were made in the latest recorded assurance work.

## System at a glance

- **Client:** React, TypeScript, Vite.
- **Identity:** Google sign-in with Firebase Auth; Firestore roles include `SUPER_ADMIN`, `RACE_ADMIN`, `START`, `READOUT`, `FOREST`, and `SPEAKER`.
- **Data:** Firestore is canonical for roles, club settings, runner records, competition metadata, courses/classes, and key competitor identity workflows. Some legacy Express/JSON mirrors remain.
- **Backend:** Express (`server.ts`) still handles API routes, Eventor/ROC integration, and WebSocket state distribution. Migration to Firebase Functions and replacement of WebSockets are not complete.
- **Architecture goal:** Vercel + Firebase Auth/Firestore/Functions, with Express retired only after its remaining responsibilities are migrated and validated.

## Implemented protections and migrations

The following are **repository-level implementation claims**, not production deployment attestations:

- Atomic SI assignment/competitor mutations cover create, reassignment, card-series changes, retirement, and deletion. Standalone assignment create/retire exports were removed; relevant paths reread and validate competitor/assignment identity and ownership within transactions.
- Trusted backend transaction paths were added for competitor creation and READOUT auto-create. READOUT auto-create pairs competitor, assignment, receipt, and counters. Assignment retirement is required to pair with the competitor lifecycle change.
- Import/snapshot creation uses assignment-aware per-competitor transactions; identity-changing imports are rejected or redirected to canonical paths. These multi-record operations are atomic per competitor, not as one whole batch.
- Cloud hydration and restore fence competitor identity changes. Unsafe legacy competitor CRUD, Eventor event import, competition deletion, reset, and demo-clear paths are disabled or return HTTP 410.
- Repository Firestore Rules encode paired competitor/assignment changes and parity checks. READOUT competitor updates use narrow field allowlists; competition list permissions were tightened in later work.
- Google authentication replaces PIN/offline-code login.
- Admin UI includes the read-only V2 integrity monitor, periodic scans, alert dismissal/clear controls, and handling for the six previously reported ownerUid cases. Alert dismissal is component state (not durable across remounts). Suppressing an alert in UI is **not** evidence that the underlying data discrepancy was corrected or formally dispositioned.

Detailed implementation references: [ASSIGNMENT_BOUNDARY_HARDENING.md](./ASSIGNMENT_BOUNDARY_HARDENING.md), [SERVER_SIDE_ENFORCEMENT_PHASE2_COMPETITOR_CREATE.md](./SERVER_SIDE_ENFORCEMENT_PHASE2_COMPETITOR_CREATE.md), [SERVER_SIDE_ENFORCEMENT_PHASE3_READOUT.md](./SERVER_SIDE_ENFORCEMENT_PHASE3_READOUT.md), [READOUT_FIELD_PERMISSION_REMEDIATION.md](./READOUT_FIELD_PERMISSION_REMEDIATION.md), and [EVENTOR_IOF_IMPORT_MIGRATION.md](./EVENTOR_IOF_IMPORT_MIGRATION.md).

## Outstanding production and assurance blockers

### 1. Deployed Firestore Rules — highest immediate blocker

The 2026-11-11 Console review found the latest identified release allowed independent assignment create/update/delete and lacked repository parity/reassignment checks. No immutable release ID/hash or evidence that the repository rules were deployed was recorded. No production deployment is authorized by this handoff.

See [DEPLOYED_RULE_CLOSURE.md](./DEPLOYED_RULE_CLOSURE.md), [DEPLOYED_RULE_DIFF.md](./DEPLOYED_RULE_DIFF.md), [DEPLOYED_RULE_ASSURANCE.md](./DEPLOYED_RULE_ASSURANCE.md), and [DEPLOYED_RULE_REMEDIATION_PLAN.md](./DEPLOYED_RULE_REMEDIATION_PLAN.md).

### 2. Firestore Rules regression suite — not green

The latest task handoff reports that the suite progressed through earlier assertion failures and still failed at a **standalone SI-number update denial assertion** (the current test source has a corresponding assertion near `firestore.rules.test.ts` line 1320). This was not rerun for this handoff; treat it as the last reported failure, not a freshly verified result. Some older analysis files refer to earlier failures (assignment retirement, READOUT fields, or competition listing) and have been superseded by later changes.

The user-provided environment report said Java 21, Firebase CLI 15.35.0, Firebase configs, and a working emulator were available. Older readiness documents say the emulator/CLI were unavailable on their assessment date. The suite's present result and current environment should be verified before relying on either set of claims. Previous emulator runs also encountered Rules expression-limit errors on some paths.

Rules test artifacts include [firestore.rules.test.ts](./firestore.rules.test.ts), [FIRESTORE_RULES_FAILURE_ANALYSIS_NEXT2.md](./FIRESTORE_RULES_FAILURE_ANALYSIS_NEXT2.md), and [READOUT_FIELD_PERMISSION_REMEDIATION.md](./READOUT_FIELD_PERMISSION_REMEDIATION.md). They have different dates and describe different stages; inspect current test source and run output before selecting the next fix.

### 3. Owner and inventory findings

The last V2 production snapshot (2026-11-10 21:52 UTC) covered four returned competitions: 14 competitors and 20 assignments. It found six active assignment/competitor `ownerUid` parity mismatches: four in Reflexcup#2 and two in Lång-TM. Four are consistent with an early bootstrap path; the two Lång-TM records have unresolved writer provenance. No orphan or duplicate-SI ownership findings were reported in that snapshot.

This is not proof of complete production coverage: there was no independent expected-competition register. A later standard UI scan was not a V2 owner/parity audit and did not prove the six cases changed or were resolved. Keep these findings unresolved until ownership, provenance, scope, and any approved correction are evidenced and the V2 scan is rerun.

See [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md), [INVENTORY_COVERAGE_REPORT.md](./INVENTORY_COVERAGE_REPORT.md), [OWNERUID_DISPOSITION.md](./OWNERUID_DISPOSITION.md), and [OWNERUID_REMEDIATION_PLAN.md](./OWNERUID_REMEDIATION_PLAN.md).

### 4. Trusted writers and transaction behavior

Repository writers are substantially inventoried and routed through intended boundaries, but external/Admin SDK writers are not. Prior IAM evidence showed privileged human and Firebase service identities; effective inherited IAM, service-account keys/impersonation, Cloud Functions and scheduled jobs, CI identities, and Cloud Audit Logs remain incomplete or unverified.

No evidence is recorded for the required concurrency, retry, timeout, rollback, bootstrap-race, and partial-import recovery tests. Rules do not constrain Admin SDK writers. See [TRUSTED_WRITER_CLOSURE.md](./TRUSTED_WRITER_CLOSURE.md), [CONCURRENCY_VALIDATION.md](./CONCURRENCY_VALIDATION.md), [RECOVERY_VALIDATION.md](./RECOVERY_VALIDATION.md), and [READINESS_EXECUTION_PLAN.md](./READINESS_EXECUTION_PLAN.md).

## Latest worktree change: Eventor settings local to device

The current worktree contains uncommitted Eventor settings changes:

- API key, organization ID, and base URL are loaded/saved in browser `localStorage`.
- Explicit connection-test and club-sync requests send the local settings to the authenticated backend; backend Eventor config Firestore read/write and migration routes were removed.
- Existing legacy Firestore documents were not deleted; no production deployment or migration was performed.
- Related docs and `.env.example` were updated.
- **Latest verification:** `npm run build` PASS; `npm run lint` PASS. Build emitted existing Vite `__dirname` and large-chunk warnings. Blueprint JSON and `git diff --check` passed.

These changes are in the working tree, not committed. Current modified/untracked files at handoff time:

`.env.example`, `EVENTOR_IOF_IMPORT_MIGRATION.md`, `MIGRATION-STATUS.md`, `README.md`, `SEASONDB_RETIREMENT_PLAN.md`, `TRUSTED_WRITER_ASSURANCE.md`, `firebase-blueprint.json`, `server.ts`, `src/App.tsx`, `src/components/AccessControlView.tsx`, `src/components/EventorIntegrationSettingsView.tsx`, and new `src/utils/eventorLocalConfig.ts`.

The separate Club Profile `eventorOrgId` field remains part of existing club settings and workflows; the Eventor integration view no longer writes it. Clarify before broadening scope or changing that shared field.

## Recommended next actions for the next AI

1. **Do not deploy or mutate production.** First confirm whether the owner has separately authorized a production Rules change.
2. Verify current source and test harness; run the Rules suite only with an isolated emulator. Capture the exact first failing assertion and distinguish Rules logic from stale fixtures or expression limits.
3. Fix the remaining suite failure minimally, then rerun the complete suite; do not infer suite success from build/lint.
4. Prepare an approved Rules-only deployment and active-release attestation as a separate, explicitly authorized operation.
5. Complete external writer/IAM review and reconcile the six ownerUid findings with authorized evidence. Reconcile competition coverage against an independent expected set.
6. Run concurrency/retry/recovery tests in the emulator. Keep readiness NO-GO until every required gate in [READINESS_EXECUTION_PLAN.md](./READINESS_EXECUTION_PLAN.md) passes.
7. Reassess the uncommitted Eventor change and its local-vs-club-profile organization ID boundary; do not delete legacy Firestore data without explicit authorization.

## Source-of-truth note

The canonical blocker order is [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md), but that report was last assessed 2026-11-11. [MIGRATION-STATUS.md](./MIGRATION-STATUS.md) contains useful implementation history and explicitly marks some older phase notes as superseded. This handoff is newer, but does not replace live verification, the current emulator output, a production rules attestation, or authorized data-owner decisions.
