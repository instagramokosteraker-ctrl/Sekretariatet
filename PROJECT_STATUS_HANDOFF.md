# PasserSI — project status handoff

**Prepared:** 2026-11-13 12:33 CET
**Repository:** `instagramokosteraker-ctrl/Sekretariatet`  
**Branch / HEAD:** `main` / `3062f59`
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
- Cloud hydration and restore fence competitor identity changes. Unsafe legacy competitor CRUD and Eventor event import remain disabled; single-competition deletion now uses an authenticated owner/SUPER_ADMIN transaction that removes direct child records and SI assignments atomically. Bulk reset and demo-clear remain disabled.
- Repository Firestore Rules encode paired competitor/assignment changes and parity checks. READOUT competitor updates use narrow field allowlists; competition list permissions were tightened in later work.
- Google authentication replaces PIN/offline-code login.
- Admin UI includes the read-only V2 integrity monitor, periodic scans, individual and bulk alert dismissal, and handling for the six previously reported ownerUid cases. Dismissed alert keys now persist in browser `localStorage`. Suppressing an alert in UI is **not** evidence that the underlying data discrepancy was corrected or formally dispositioned.

Detailed implementation references: [ASSIGNMENT_BOUNDARY_HARDENING.md](./ASSIGNMENT_BOUNDARY_HARDENING.md), [SERVER_SIDE_ENFORCEMENT_PHASE2_COMPETITOR_CREATE.md](./SERVER_SIDE_ENFORCEMENT_PHASE2_COMPETITOR_CREATE.md), [SERVER_SIDE_ENFORCEMENT_PHASE3_READOUT.md](./SERVER_SIDE_ENFORCEMENT_PHASE3_READOUT.md), [READOUT_FIELD_PERMISSION_REMEDIATION.md](./READOUT_FIELD_PERMISSION_REMEDIATION.md), [EVENTOR_IOF_IMPORT_MIGRATION.md](./EVENTOR_IOF_IMPORT_MIGRATION.md), and [COMPETITION_DELETION_MIGRATION.md](./COMPETITION_DELETION_MIGRATION.md).

## Outstanding production and assurance blockers

### 1. Deployed Firestore Rules — highest immediate blocker

The 2026-11-11 Console review found the latest identified release allowed independent assignment create/update/delete and lacked repository parity/reassignment checks. No immutable release ID/hash or evidence that the repository rules were deployed was recorded. No production deployment is authorized by this handoff.

See [DEPLOYED_RULE_CLOSURE.md](./DEPLOYED_RULE_CLOSURE.md), [DEPLOYED_RULE_DIFF.md](./DEPLOYED_RULE_DIFF.md), [DEPLOYED_RULE_ASSURANCE.md](./DEPLOYED_RULE_ASSURANCE.md), and [DEPLOYED_RULE_REMEDIATION_PLAN.md](./DEPLOYED_RULE_REMEDIATION_PLAN.md).

### 2. Firestore Rules regression suite — not green

The latest recorded run of `runFirestoreRulesDirtyDozenSuite()` exited `0`, and the standalone SI-number update assertion passed. A focused assertion verifies that this update is denied by the Rules condition rather than by the expression ceiling. However, the run still logged **18 Rules expression-limit diagnostics on other paths**. Therefore the suite is not clean and must not be presented as a fully trustworthy, warning-free PASS. Older analysis files refer to earlier failures (assignment retirement, READOUT fields, or competition listing) and have been superseded by later changes.

The user-provided environment report said Java 21, Firebase CLI 15.35.0, Firebase configs, and a working emulator were available. Older readiness documents say the emulator/CLI were unavailable on their assessment date. Previous emulator runs also encountered Rules expression-limit errors on some paths.

Rules test artifacts include [firestore.rules.test.ts](./firestore.rules.test.ts), [FIRESTORE_RULES_FAILURE_ANALYSIS_NEXT2.md](./FIRESTORE_RULES_FAILURE_ANALYSIS_NEXT2.md), and [READOUT_FIELD_PERMISSION_REMEDIATION.md](./READOUT_FIELD_PERMISSION_REMEDIATION.md). They have different dates and describe different stages; inspect current test source and run output before selecting the next fix.

### 3. Owner and inventory findings

The last V2 production snapshot (2026-11-10 21:52 UTC) covered four returned competitions: 14 competitors and 20 assignments. It found six active assignment/competitor `ownerUid` parity mismatches: four in Reflexcup#2 and two in Lång-TM. Four are consistent with an early bootstrap path; the two Lång-TM records have unresolved writer provenance. No orphan or duplicate-SI ownership findings were reported in that snapshot.

This is not proof of complete production coverage: there was no independent expected-competition register. A later standard UI scan was not a V2 owner/parity audit and did not prove the six cases changed or were resolved. Keep these findings unresolved until ownership, provenance, scope, and any approved correction are evidenced and the V2 scan is rerun.

See [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md), [INVENTORY_COVERAGE_REPORT.md](./INVENTORY_COVERAGE_REPORT.md), [OWNERUID_DISPOSITION.md](./OWNERUID_DISPOSITION.md), and [OWNERUID_REMEDIATION_PLAN.md](./OWNERUID_REMEDIATION_PLAN.md).

### 4. Trusted writers and transaction behavior

Repository writers are substantially inventoried and routed through intended boundaries, but external/Admin SDK writers are not. Prior IAM evidence showed privileged human and Firebase service identities; effective inherited IAM, service-account keys/impersonation, Cloud Functions and scheduled jobs, CI identities, and Cloud Audit Logs remain incomplete or unverified.

No evidence is recorded for the required concurrency, retry, timeout, rollback, bootstrap-race, and partial-import recovery tests. Rules do not constrain Admin SDK writers. See [TRUSTED_WRITER_CLOSURE.md](./TRUSTED_WRITER_CLOSURE.md), [CONCURRENCY_VALIDATION.md](./CONCURRENCY_VALIDATION.md), [RECOVERY_VALIDATION.md](./RECOVERY_VALIDATION.md), and [READINESS_EXECUTION_PLAN.md](./READINESS_EXECUTION_PLAN.md).

## Recent application work and current worktree

### Committed

- Eventor API key, organization ID, and base URL are managed in browser `localStorage`; Eventor requests send them to authenticated backend routes. The Eventor integration no longer depends on a private Firestore config document. Existing legacy Firestore documents were not deleted.
- The Drift-larm has five-minute read-only scans, individual/bulk alert dismissal, a “show dismissed” toggle, and persistence of dismissed finding keys across reloads.
- These are client/repository changes, not evidence that production data was changed or audited.

The separate Club Profile `eventorOrgId` field remains part of existing club settings/workflows. Do not change that shared field without clarifying scope.

### Uncommitted Eventor connection-test change

Current worktree modifications are limited to `server.ts` and `src/components/EventorIntegrationSettingsView.tsx`.

- The “Testa anslutning” action now reads the saved local configuration and sends `{ apiKey, orgId, baseUrl }` to `/api/eventor/test`; unsaved edits are not silently tested.
- The backend test route reads configuration from `req.body`, calls Eventor `/organisation/apiKey` with the `ApiKey` header, returns a success/message on an HTTP-success response, still checks a parsed organization ID when available, and reports network errors clearly.
- **Verification after these edits:** `npm run build` PASS and `npm run lint` PASS. Build reported the existing Vite `__dirname` notice and large-chunk warning. The Rules suite was not rerun for this UI/server-only change.

## Recent deployment attempt

A user-authorized `firebase deploy --only firestore:rules --project ai-studio-applet-webapp-72c01` attempt stopped before publishing because Firebase CLI was not authenticated (`Failed to authenticate, have you run firebase login?`). No production Rules were deployed. Do not retry unless separately authorized and authenticated; the Rules suite still has expression-limit diagnostics.

## Recommended next actions for the next AI

1. If further Eventor connection-test changes are made, rerun build/lint and exercise the endpoint with a saved local configuration; do not log API-key values.
2. Diagnose the 18 Rules expression-limit diagnostics. Keep the Rules suite marked unclean until these are resolved and negative assertions are not passing solely because of evaluation limits.
3. Keep production readiness **NO-GO**. A prior deployment attempt was authorized but failed authentication before publishing; do not assume production changed.
4. Complete external writer/IAM review and reconcile the six ownerUid findings with authorized evidence. Reconcile competition coverage against an independent expected set.
5. Run concurrency/retry/recovery tests in the emulator. Keep readiness NO-GO until every required gate in [READINESS_EXECUTION_PLAN.md](./READINESS_EXECUTION_PLAN.md) passes.
6. Preserve the local Eventor key boundary; do not reintroduce Firestore credential persistence or delete legacy Firestore data without explicit authorization.

## Source-of-truth note

The canonical blocker order is [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md), but that report was last assessed 2026-11-11. [MIGRATION-STATUS.md](./MIGRATION-STATUS.md) contains useful implementation history and explicitly marks some older phase notes as superseded. This handoff is newer, but does not replace live verification, the current emulator output, a production rules attestation, or authorized data-owner decisions.
