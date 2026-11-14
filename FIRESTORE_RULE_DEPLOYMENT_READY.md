# Firestore Rules Deployment Preparation

## Status

**Preparation only. No deployment, production write, or rules change was
performed.**

The target and database-scoped command are identified. Do not deploy until the
current target source is reviewed and the pre-deployment gates below pass.

## Target

| Item | Value |
|---|---|
| Firebase project ID | `ai-studio-applet-webapp-72c01` |
| Firestore database ID | `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df` |
| Rules source | `firestore.rules` |
| Firebase config | `firebase.json` |
| Configured Firestore targets | One; explicitly maps the target database ID to `firestore.rules` |
| Candidate commit at preparation time | `f452aefed06446014376e24458339cd4c6d22304` |
| Candidate Git blob | `c6aac73394f7066d084cc66fe428c54de70ce2c2` |
| Candidate file SHA-256 | `7C261D162AAC9F3C0FF33980D2BBA0C111F7E36FB91D99FD76247363F017DFE8` |

The worktree `firestore.rules` matched `HEAD` when checked. Recompute the commit
and file hashes immediately before any deployment and stop if they differ.

### Source-review gate

Earlier deployment documents identify commit `90f0e9f` and blob
`ec58bae9f5d83b7b1b9cea3ba5efeeccb2bd365e` as the reviewed target. The current
candidate is `f452aef` and its `firestore.rules` differs substantially from
that older blob (295 insertions and 403 deletions in the comparison). The
current create rule has the expected fix, but the older review must not be
treated as approval of the entire current file. Review and test the complete
candidate source before publication.

The `firebase.json` target was verified to contain exactly one Firestore
entry:

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

## Why deploy

The current star-marked production source requires
`incoming().keys().hasAll(['feeTrackingEnabled'])`. The captured Eventor
competition document has no `feeTrackingEnabled` field, so production rejects
the create. The repository rule instead rejects both fee keys, and the exact
captured document passed that rule and all isolated create predicates in the
Firestore Emulator.

The deployment target is the repository's current `firestore.rules`, not a
manual edit to production rules and not a copy of the active source.

## Pre-deployment checklist

Complete and record each item under the approved change request:

- [ ] Production owner approves the project, named database, source commit,
      deployment window, operator, approver, monitoring period, and rollback
      authority.
- [ ] Reconfirm the Console project ID and selected database ID match the
      target table above.
- [ ] Review the complete current `firestore.rules` at the selected commit.
      In particular, review all changes since `90f0e9f`; do not rely only on
      the competition-create fix.
- [ ] Confirm the worktree rules file is identical to the approved commit and
      record its Git blob and SHA-256.
- [ ] Confirm `firebase.json` contains only the intended database-to-rules
      mapping. Do not use a config targeting any other database or service.
- [ ] Export and preserve the complete currently active source and its
      displayed release metadata in the access-controlled change record. This
      is the emergency rollback artifact; it contains the known
      `feeTrackingEnabled` requirement and other stale rules.
- [ ] Run the full Firestore rules test suite and required focused cases
      against an isolated emulator loaded with the exact candidate file.
      Preserve the command, emulator version, output, and exit code.
- [ ] Confirm Eventor competition import and other supported application
      writes are compatible with the complete candidate rules.
- [ ] Confirm the production Firebase CLI operator is authorized. The local
      Firebase CLI was not authenticated during this preparation.
- [ ] Obtain explicit deployment approval. This document and its commands do
      not authorize deployment.

## Emulator verification

Use an isolated demo project and a test-only Firebase config; never point the
test emulator at production. The exact captured competition payload already
passed the repository create rule in an emulator. Before publication, also run
the full exported rules suite and all required regression cases for the
candidate source.

The existing suite is exported as
`runFirestoreRulesDirtyDozenSuite()` from `firestore.rules.test.ts`. The
existing `firebase.test.json` maps only the rules file to an isolated local
Firestore Emulator and disables the emulator UI. Start it in PowerShell
terminal 1:

```powershell
firebase emulators:start --only firestore --project demo-passersi-rules-test --config .\firebase.test.json
```

Then run the suite in PowerShell terminal 2:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
node --import tsx --input-type=module -e 'import("./firestore.rules.test.ts").then(m => m.runFirestoreRulesDirtyDozenSuite()).catch(e => { console.error(e); process.exitCode = 1; })'
```

The test config and emulator must use a demo project ID and the isolated
Firestore Emulator. A passing competition-create probe alone is not a
substitute for the complete rules suite.

## Deployment command

Run only after every pre-deployment item passes, from the repository root in
PowerShell. Re-enter and verify both IDs in the deployment window:

```powershell
$projectId = 'ai-studio-applet-webapp-72c01'
$databaseId = 'ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df'

firebase deploy --only "firestore:$databaseId" --project $projectId --config .\firebase.json
```

This is the database-scoped command for the single database mapped in
`firebase.json`. Do not substitute `--only firestore` or
`--only firestore:rules`; do not deploy Hosting, Functions, or other services.
**The command is provided for the approved future change only and was not run.**

## Rollback command

Before deployment, save the full pre-deployment active source as
`firestore.predeploy.rules` in the approved access-controlled change artifact.
Create a separate `firebase.rollback.json` mapping only the target database to
that saved source:

```json
{
  "firestore": [
    {
      "database": "ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df",
      "rules": "firestore.predeploy.rules"
    }
  ]
}
```

If rollback is approved by the change owner, run:

```powershell
$projectId = 'ai-studio-applet-webapp-72c01'
$databaseId = 'ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df'

firebase deploy --only "firestore:$databaseId" --project $projectId --config .\firebase.rollback.json
```

This restores the prior active rules, including the `feeTrackingEnabled`
requirement that denies the current Eventor payload and previously identified
rule gaps. Rollback is emergency-only, not an acceptable steady state. It does
not reverse documents already written. Re-attest the active source and keep
readiness closed until a reviewed forward fix is published.

## Post-deployment verification

1. **Deployment scope:** retain CLI output and confirm only Firestore rules for
   the exact named database were published.
2. **Active source:** in Firebase Console, confirm the selected project and
   named database, then confirm the newly published version is the
   star-marked/current version. Retrieve its source and compare it with the
   approved `firestore.rules` artifact and recorded SHA-256. Do not rely only
   on a successful deploy message.
3. **Rule predicate:** verify the active competition create rule contains
   `!incoming().keys().hasAny(['feeTrackingEnabled', 'enableFeesAndSwish'])`
   and does not require `feeTrackingEnabled` with `hasAll`.
4. **Simulation:** perform read-only Rules Playground simulations for the
   exact current competition payload and relevant denied cases. Do not use
   simulation as a substitute for source identity or emulator tests.
5. **Eventor import:** after deployment and separate production-test approval,
   perform one controlled import using a suitable Eventor competition ID.
   The import writes production competition and competitor documents. Confirm
   before the attempt that the test event and generated competition will not
   create an unwanted duplicate; record the source Eventor ID and generated
   `competitions/{id}`. Do not delete test documents unless separately
   approved.
6. Confirm the UI reports import success, the competition document exists in
   the target database with the expected owner and timestamps, imported
   competitors are present, and no `Missing or insufficient permissions`
   error occurs. Record the result and any generated document IDs.
7. Monitor the agreed window for unexpected permission denials or changes to
   other Firestore flows. Stop and invoke the approved rollback process if
   there is an unexpected production regression.

## Expected Eventor result

**Yes.** If the current repository `firestore.rules` is deployed successfully
to the exact target database, the current captured competition payload should
pass competition creation: the repository rule passed the exact payload in the
emulator, while the active-only `feeTrackingEnabled` presence requirement is
removed.

This is a reasoned expectation, not a claim that a production end-to-end import
has already been run. Successful full import also depends on the subsequent
competitor writes and any other transaction steps satisfying the same
deployed candidate rules. Verify those in the emulator and then perform the
controlled post-deployment import above.

## Execution record

- Deployment performed: **No**
- Production write performed: **No**
- Active source changed: **No**
- Planning/verification performed: target config and candidate source identity
  checked; exact competition create payload previously passed the emulator.
