# Firestore Emulator Rules Test Setup

- Prepared: 2026-11-11.
- Purpose: run repository Firestore Security Rules tests locally before any rules deployment.
- **No production deployment, production connection, or production data change is part of these steps.**

## Repository test inventory

The repository contains one rules test file: [`firestore.rules.test.ts`](./firestore.rules.test.ts). It exports `runFirestoreRulesDirtyDozenSuite()`, which initializes `@firebase/rules-unit-testing`, reads the local `firestore.rules`, and runs its assertions against the Firestore Emulator. This suite is the only rules-related test file found. There is no npm script for it and no Vitest/Jest rule test registration. `npm run lint` is a TypeScript check, not a Security Rules behavior test.

The required test packages are already declared and installed locally:

- `@firebase/rules-unit-testing`
- `tsx`

## Requirements and current environment

Firebase's current documentation states:

- Firebase CLI requires Node.js **18 or later**.
- Local Emulator Suite requires Node.js **16 or later**, Java JDK **11 or later**, and Firebase CLI **8.14.0 or later**.
- Firestore Emulator uses port `8080` by default.

The local environment was checked:

- Node.js: `v26.13.0`.
- npm: `11.20.0`.
- Global `firebase` command: **not installed**.
- Java: **not installed / not on PATH**.
- `@firebase/rules-unit-testing`, `tsx`, and local `node_modules`: present.

Firebase CLI `15.35.0` was previously invoked through temporary `npm exec`; it emitted an engine warning for one dependency under Node 26. Use a currently supported Node LTS version (recommended: Node 24 LTS) for a clean setup. A JDK 11+ is required before starting the emulator. No CLI or Java packages were installed as part of this preparation.

Official references:

- [Firebase CLI installation](https://firebase.google.com/docs/cli#install-cli-windows)
- [Install and configure the Local Emulator Suite](https://firebase.google.com/docs/emulator-suite/install_and_configure)
- [Firestore Rules unit testing](https://firebase.google.com/docs/rules/unit-tests)
- [Firestore Rules emulator setup](https://firebase.google.com/docs/rules/emulator-setup)

## Generated local test configuration

[`firebase.test.json`](./firebase.test.json) is separate from production [`firebase.json`](./firebase.json):

- It configures the Firestore Emulator to load the repository's `firestore.rules`.
- It binds the Firestore Emulator to port `8080` and disables the Emulator UI.
- It enables `singleProjectMode` to catch accidental use of differing project IDs.
- It does not define a production Firebase project, database target, hosting target, or deployment target.

The test suite itself uses the hard-coded emulator-only project ID `demo-passersi-rules-test`. Always pass that same ID to Firebase CLI. Do not pass `ai-studio-applet-webapp-72c01` to emulator commands. The suite loads `firestore.rules` directly into its test environment, so no production database ID or documents are needed.

## Setup commands (Windows PowerShell)

Run commands from the repository root.

### 1. Install/check prerequisites

1. Install a supported Node LTS release (recommended Node 24 LTS) using the organization's approved Windows Node distribution/version manager. Reopen PowerShell and verify:

   ```powershell
   node --version
   npm --version
   ```

2. Install an approved JDK 11 or later. Reopen PowerShell and verify:

   ```powershell
   java -version
   ```

   If `java` is not recognized, set `JAVA_HOME` and add its `bin` directory to `PATH` using the organization's approved environment management, then open a fresh PowerShell session.

3. Install Firebase CLI globally if it is not already installed:

   ```powershell
   npm install --global firebase-tools
   firebase --version
   ```

   Require CLI version `8.14.0` or later. The local rules suite uses emulator-only project `demo-passersi-rules-test`; Firebase account login is not required for this local run.

4. Confirm the repository test dependencies are installed. They are already present in the checked environment; if a clean checkout reports them missing, restore the repository's locked dependencies using the repository-standard package-manager workflow before running the test.

### 2. Validate local-only config and test project ID

```powershell
$testConfig = Get-Content .\firebase.test.json -Raw | ConvertFrom-Json
if ($testConfig.firestore.rules -ne 'firestore.rules') { throw 'Unexpected rules path in emulator config.' }
if ($testConfig.emulators.firestore.port -ne 8080) { throw 'Unexpected Firestore Emulator port.' }
if (-not $testConfig.emulators.singleProjectMode) { throw 'singleProjectMode must be enabled.' }

Select-String -Path .\firestore.rules.test.ts -Pattern "const PROJECT_ID = 'demo-passersi-rules-test'"
```

### 3. Start only the Firestore Emulator

Open PowerShell window 1 at the repository root and run:

```powershell
firebase emulators:start --only firestore --project demo-passersi-rules-test --config .\firebase.test.json
```

Wait for the CLI to report that the Firestore Emulator is listening on `127.0.0.1:8080`. Leave this process running while the suite executes. This command starts only the emulator; it does not deploy rules or connect to the configured production project/database.

### 4. Execute the rules test suite

Open PowerShell window 2 at the repository root and run:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
node --import tsx --input-type=module -e "import('./firestore.rules.test.ts').then(m => m.runFirestoreRulesDirtyDozenSuite()).catch(e => { console.error(e); process.exitCode = 1; })"
```

The test runner must exit with code `0`. It initializes the exported suite, which reads `firestore.rules`, runs the assertions, and cleans up its test environment. If the suite reports a failed assertion, emulator connection error, compilation/import error, or nonzero exit, stop and fix the test/environment before considering deployment.

When finished, stop the emulator in window 1 with `Ctrl+C`. Do not run any `firebase deploy` command during this validation.

### Run all repository rules-related tests

There is currently exactly one rules-related test suite in the repository. Therefore the command in step 4 is also the command to run **all** current repository rules tests. The emulator process in step 3 must be running at the time. No separate `npm test` or Vitest command currently selects this exported suite.

For general project checks, these may also be run separately:

```powershell
npm run lint
npm run build
```

They are supplemental only; neither replaces the Firestore rules emulator suite.

## Required rule assertions before deployment

The full suite must pass all existing positive and negative assertions. Confirm it covers, at minimum:

- valid competitor plus matching active SI assignment in the same commit succeeds;
- standalone assignment create and identity update fail;
- direct `siCardAssignments` delete fails;
- SI-only competitor reassignment fails;
- reassignment without retirement of the old SI fails;
- valid paired reassignment/retirement succeeds;
- owner, competitor ID/document ID, SI, and card-series mismatches fail;
- unauthorized client writes fail;
- valid and spoofed readout auto-create/receipt/counter cases behave as intended.

The repository suite contains many related cases, including standalone assignment-create and delete failures, paired reassignment, mismatch denial, and readout receipt checks. Review the suite output and test source for coverage; add targeted tests if any required positive/negative case is not explicitly asserted. A clean TypeScript build alone is not sufficient.

## PASS / FAIL criteria before deploying

**PASS only when all are true:**

1. Firebase CLI is at least 8.14.0; Node is compatible with the installed CLI; Java JDK 11+ is available.
2. `firebase.test.json` validation succeeds and the emulator runs under `demo-passersi-rules-test` on port 8080.
3. The rules test suite completes with exit code `0`, all assertions pass, and its output is retained with the tested `firestore.rules` Git commit/blob and tool versions.
4. Required assignment create/update/delete, SI reassignment/retirement, identity parity, authorization, and readout positive/negative cases are explicitly covered.
5. No command targets production project `ai-studio-applet-webapp-72c01`; no deployment command is run.

**FAIL / NOT READY if any are true:**

- Java is absent, Firebase CLI is missing/outdated, emulator does not start, or the test runner cannot connect.
- Any assertion fails or a required invariant is not covered.
- Test run uses the production project/database or writes production data.
- The rules source changes after testing and the modified source is not retested.

After PASS, the test evidence is one prerequisite for the separately approved named-database deployment documented in [`DEPLOY_FIRESTORE_RULES_CHECKLIST.md`](./DEPLOY_FIRESTORE_RULES_CHECKLIST.md). It does not itself deploy or attest production rules, close trusted-writer assurance, or resolve remaining cutover blockers.
