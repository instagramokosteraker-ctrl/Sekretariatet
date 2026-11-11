# Firestore Rules Deployment Checklist

- Prepared: 2026-11-11.
- Status: **Preparation only. No production rules or data were changed.**
- Target Firebase project: `ai-studio-applet-webapp-72c01`.
- Target Firestore database: `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`.

## Authoritative rules version

The deployment target is the reviewed repository file [`firestore.rules`](./firestore.rules) at commit:

```text
90f0e9f62244af679bed3e6ff5807466974beb7f
```

The commit is “Implement assignment boundary hardening with transaction safety and identity validation” (2026-11-10). Its Git blob ID for `firestore.rules` is:

```text
ec58bae9f5d83b7b1b9cea3ba5efeeccb2bd365e
```

The current worktree file was verified to have the same Git blob ID as the commit. The deploy operator must repeat the check immediately before deployment; deploy no unreviewed working-tree changes. Do not copy rules from the older Console release. The target includes paired assignment/competitor checks, retirement-aware reassignment, denied direct assignment deletion, and readout receipt/counter checks. The rationale and complete prior comparison are in [`DEPLOYED_RULE_DIFF.md`](./DEPLOYED_RULE_DIFF.md).

## Verified target and deployment route

- Project ID: `ai-studio-applet-webapp-72c01`, as shown in the Firebase Console URL/project selector and prior project inspection.
- Database ID: `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`, as shown in the Firestore Console database selector/URL.
- The database ID is not `(default)`. Confirm in the Console that this exact ID is the intended production database immediately before deployment.
- Repository inspection found **no `firebase.json` and no `.firebaserc`**. A database-specific Firebase CLI config is therefore required before the CLI command below can target this database.
- Google’s Firestore Security Rules deployment guide documents `firebase deploy --only firestore:<databaseId>` for a database configured in `firebase.json`; this deploys rules for the named configured database. The config must use the exact database ID above and point to `firestore.rules`. Do not run `firebase deploy --only firestore:rules` for this change: that selector targets rules for all configured databases.
- Firebase Console rules deployment supports the default database, not additional named databases. For this named database use the Firebase CLI route (or an independently approved supported deployment pipeline), not the Firebase Console Publish button.

Official references:

- [Manage and deploy Firebase Security Rules](https://firebase.google.com/docs/rules/manage-deploy)
- [Firebase CLI reference](https://firebase.google.com/docs/cli)
- [Test Security Rules with the Emulator](https://firebase.google.com/docs/rules/emulator-setup)
- [Firestore Security Rules overview and deployment](https://firebase.google.com/docs/firestore/security/get-started)

## Prerequisites

- [ ] Change request approved by the production Firebase/project owner; named operator, approver, change window, monitoring owner, and rollback authority recorded.
- [ ] Confirm project ID, database ID, environment, and database selector immediately before every command. Stop if the IDs do not match.
- [ ] Save the complete currently active rules source, displayed current release/time, and a digest in the access-controlled change record. Prior assessment found material bypasses in the current release; preserve it only as a rollback artifact, never as the target.
- [ ] Reconfirm target commit and working-tree equality using the commands below. Freeze edits to `firestore.rules` after verification.
- [ ] Add/prepare a Firebase CLI config that explicitly maps the named database ID to `firestore.rules`; see the configuration example below. Review it before any deploy command.
- [ ] Complete the local rules regression tests against an isolated emulator using the exact target file. Resolve all failures before production deployment.
- [ ] Verify compatibility for paired create/reassignment/retirement, import seed, readout receipt/counters, direct entry, and result/status updates. Use emulator fixtures only.
- [ ] Agree the emergency rollback artifact and process in advance. A rollback to the identified older rules restores known direct assignment bypasses, so it is emergency availability recovery only and leaves readiness **NO-GO**.

## Required tooling and permissions

### Tooling

- Firebase CLI (`firebase-tools`) with multi-database deployment support.
- Node.js supported by the installed Firebase CLI. The previously observed machine had Node `v26.13.0`, and Firebase CLI 15.35.0 emitted a dependency engine warning; use a supported Node LTS release (for example Node 24 LTS) for the deployment/test session rather than relying on that warning-prone runtime.
- Java runtime supported by the Firestore Emulator. Java was not available on PATH in the prior environment check; install/use an approved JDK before emulator testing.
- Repository dependencies `@firebase/rules-unit-testing` and `tsx` are already declared in `package.json`. The exported suite is `runFirestoreRulesDirtyDozenSuite()` in `firestore.rules.test.ts`; there is no dedicated npm test script.
- Git and PowerShell for source identity, hashes, and the documented commands.

### Permissions

Use a named production operator authorized to publish Firestore rules for the target Firebase project. Grant only the approved least-privilege role/custom role needed for the planned operations. The rule management permissions documented for editing/publishing and simulation include:

- `firebaserules.rulesets.create`
- `firebaserules.rulesets.list`
- `firebaserules.rulesets.test` (for the Console simulator)
- `firebaserules.releases.create`
- `firebaserules.releases.update`

The Google Cloud Console rules editor also lists `firebaserules.rulesets.delete` and `firebaserules.releases.delete` for its full management feature set; do not grant deletion permissions unless the organization requires them for the selected workflow. The Firebase CLI may also require project discovery/selection permissions. Have the project IAM owner verify the operator’s effective permissions before the change window; do not infer access from being able to view the project.

## Console pages to verify before deployment

Use these pages for read-only identity/source verification; do not click Publish during preparation:

1. **Firebase project settings / General**  
   `https://console.firebase.google.com/project/ai-studio-applet-webapp-72c01/settings/general`  
   Confirm **Project ID** is exactly `ai-studio-applet-webapp-72c01`.
2. **Firebase Console Firestore database selector and Rules page**  
   `https://console.firebase.google.com/project/ai-studio-applet-webapp-72c01/firestore/databases/ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df/security/rules`  
   Confirm the selected database ID, current active/starred release and displayed timestamp; save the complete pre-deploy source. Do not use this page to publish rules for the named database.
3. **Google Cloud Console > Firestore > Databases**  
   `https://console.cloud.google.com/firestore/databases?project=ai-studio-applet-webapp-72c01`  
   Confirm that the exact target database exists and is the intended production database, not another database in the project.
4. **Google Cloud Console > IAM & Admin > IAM**  
   `https://console.cloud.google.com/iam-admin/iam?project=ai-studio-applet-webapp-72c01`  
   Have the project IAM owner verify the operator’s effective rules deployment permissions and the change approver. This checklist does not authorize IAM changes.
5. **Cloud Console database Security page (if available for the named database)**  
   Navigate from the database row to its Security / Firestore Rules view. Confirm current release/source. The documented CLI remains the deployment route for this named database.

The Console pages must agree with the IDs in the CLI commands and config. A project display name is not a substitute for confirming the exact project ID and database ID.

## Exact commands

Run from the repository root in PowerShell. These commands are preparation/verification commands; **do not run the deploy command until the approval and pre-deploy gates below are complete**.

### 1. Confirm identity, target commit, and source

```powershell
$projectId = 'ai-studio-applet-webapp-72c01'
$databaseId = 'ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df'

firebase --version
firebase projects:list
git show -s --format="%H %cs %s" 90f0e9f
git rev-parse 90f0e9f:firestore.rules
git diff --exit-code 90f0e9f -- firestore.rules
Get-FileHash .\firestore.rules -Algorithm SHA256
```

Expected source verification:

- `git show` resolves to commit `90f0e9f62244af679bed3e6ff5807466974beb7f`.
- `git rev-parse 90f0e9f:firestore.rules` returns `ec58bae9f5d83b7b1b9cea3ba5efeeccb2bd365e`.
- `git diff --exit-code 90f0e9f -- firestore.rules` exits `0` with no diff.
- Record the file SHA-256 output in addition to the Git blob ID.
- `firebase projects:list` includes the target project and the authenticated operator has approved access.

### 2. Configure the named database

The repository currently has no Firebase config. Before invoking the CLI deploy command, create and review a versioned or change-controlled `firebase.json` with this Firestore target:

```json
{
  "firestore": [
    {
      "database": "ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df",
      "rules": "firestore.rules"
    }
  ]
}
```

If the organization requires that no deployment config be committed, use an approved temporary config file and pass it with `--config <path>`. In either case, inspect the final config and confirm it contains only the intended named database mapping. Do not use a config that also targets another production database.

### 3. Run rules tests in the emulator

Create a separate local-only `firebase.test.json` so the emulator uses the default emulator database and never targets production:

```json
{
  "firestore": {
    "rules": "firestore.rules"
  },
  "emulators": {
    "firestore": {
      "host": "127.0.0.1",
      "port": 8080
    },
    "ui": {
      "enabled": false
    }
  }
}
```

Start the emulator in PowerShell window 1:

```powershell
firebase emulators:start --only firestore --project demo-passersi-rules-test --config .\firebase.test.json
```

Then run the exported suite in PowerShell window 2:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
node --import tsx --input-type=module -e 'import("./firestore.rules.test.ts").then(m => m.runFirestoreRulesDirtyDozenSuite()).catch(e => { console.error(e); process.exitCode = 1; })'
```

The emulator suite must finish with exit code `0`. If the current Node/tsx combination rejects this invocation, add a small tracked test-runner script and npm script, then record and use that exact command; do not mark the rules gate passed without actually invoking the exported suite. Add/verify focused cases for any invariant not covered by the suite before deployment, especially assignment update alone, direct assignment delete, missing-retirement reassignment, and supported readout/import flows.

### 4. Deploy only the intended named database rules

Only after all pre-deployment checks and approvals pass:

```powershell
firebase deploy --only "firestore:$databaseId" --project $projectId --config .\firebase.json
```

This command is scoped to the named database configured in `firebase.json`. Do not substitute `--only firestore` or `--only firestore:rules`, which can deploy across configured databases.

### 5. Rollback command (emergency only)

Before deployment, preserve the complete old active rules source as `firestore.predeploy.rules` in an access-controlled change artifact. If emergency rollback is approved, use a separate config that maps only the same database ID to that saved old source, for example `firebase.rollback.json`, then run:

```powershell
firebase deploy --only "firestore:$databaseId" --project $projectId --config .\firebase.rollback.json
```

Verify the rollback release is active and stop/disable high-risk identity mutation where an existing control allows. This rollback reinstates the known assignment create/update/delete and SI-reassignment bypasses; it is not a successful cutover state. Rules rollback does not revert any documents. Preserve logs, keep readiness **NO-GO**, and use a separately approved forward fix.

## Pass/fail after deployment

### Pass only if every item is true

- [ ] CLI output reports deployment of Firestore rules for exactly the named target database; no other services or database rules were deployed.
- [ ] The active production release for the target project/database is identifiable by current marker/release timestamp or identifier, operator, and deployment record.
- [ ] The active source is re-read and verified against the tested target artifact (record file SHA-256 and source/commit; do not rely on “deploy succeeded” alone).
- [ ] Emulator tests pass for valid paired create/reassignment/retirement and supported readout/import/direct-entry cases.
- [ ] Emulator tests deny standalone assignment create/update, direct assignment delete, mismatched owner/IDs/SI/card series, SI-only reassignment, and reassignment without retirement of the old SI.
- [ ] Simulation-only production checks against the active release deny the specified bypass attempts. Simulations do not write production data.
- [ ] No unexpected permission-denied/application errors occur during the agreed monitoring window; no production data writes were made for testing.

### Fail or incomplete if any item is true

- Any project/database ID mismatch, unintended database/service target, missing approval, or inability to prove the active rules source.
- Emulator test fails, is skipped, or cannot run; a required paired-write positive or bypass negative case is absent.
- The deployed active release differs from the tested repository artifact or source cannot be retrieved/attested.
- Production simulation allows a direct mutation bypass or denies an expected supported flow.
- Unexpected application errors, unexplained rules denials/allows, or any unplanned data mutation.

On failure, stop the cutover; do not use a stale rollback as a steady state. Readiness remains **NO-GO** pending a reviewed forward fix and complete re-verification.

## Is repository work required before deployment?

**Yes, limited deployment/test setup is required; the rules source itself does not need another change based on the reviewed evidence.**

1. Add or prepare Firebase CLI config explicitly mapping the named database ID to `firestore.rules`. Neither `firebase.json` nor `.firebaserc` currently exists. A config may be temporary if organizational policy prohibits committing it, but it must be inspected and passed explicitly to CLI.
2. Make the exported test suite reproducibly runnable. `package.json` already declares `tsx` and `@firebase/rules-unit-testing`, and `firestore.rules.test.ts` exports `runFirestoreRulesDirtyDozenSuite()`, but there is no npm script/test runner. The direct invocation above may work; add a small test runner/script if it does not.
3. Execute the full rules suite and targeted paired-write cases. This is a gate, not optional repository cleanup. Do not deploy merely because build/lint passed.
4. Use a supported Node LTS and JDK for Firebase CLI/emulator. The previous environment lacked Java and its Node 26 runtime caused a Firebase CLI dependency engine warning.

No application-code or production-data change is identified as a prerequisite to **publishing the rules artifact**. However, the rules deployment does not by itself close the six ownerUid parity findings, trusted-writer assurance, full inventory coverage, or concurrency/retry/recovery gates; canonical cutover readiness remains **NO-GO** until those are separately resolved.
