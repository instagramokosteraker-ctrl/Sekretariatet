# Firebase Deployment Setup

Prepared: 2026-11-11.

This setup configures Firebase CLI to associate the repository's Firestore rules with the requested named Firestore database and sets the default Firebase project. **No deployment was run and no production rules or data were changed.**

## Generated files

- [`firebase.json`](./firebase.json) maps only database `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df` to [`firestore.rules`](./firestore.rules). The explicit database ID ensures a database-scoped CLI deployment selects the requested named database rather than relying on a default database.
- [`.firebaserc`](./.firebaserc) sets project alias `default` to `ai-studio-applet-webapp-72c01`. This lets Firebase CLI commands use the intended project when run from this repository; operators should still specify and verify the project explicitly for production changes.

The configuration intentionally contains no Hosting, Functions, Storage, emulator, or other database targets. It does not publish rules by itself.

## Configuration validation

From the repository root, validate the JSON and target mapping without deploying:

```powershell
$firebaseConfig = Get-Content .\firebase.json -Raw | ConvertFrom-Json
$projectConfig = Get-Content .\.firebaserc -Raw | ConvertFrom-Json

$firebaseConfig.firestore.Count -eq 1
$firebaseConfig.firestore[0].database
$firebaseConfig.firestore[0].rules
$projectConfig.projects.default
```

Expected values:

```text
True
ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df
firestore.rules
ai-studio-applet-webapp-72c01
```

Deployment is deliberately out of scope. Before any future deployment, follow [`DEPLOY_FIRESTORE_RULES_CHECKLIST.md`](./DEPLOY_FIRESTORE_RULES_CHECKLIST.md), repeat the project/database and source-hash checks, run the isolated emulator rules tests, and obtain the required change approval.
