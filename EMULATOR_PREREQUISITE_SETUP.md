# Firestore Emulator Prerequisite Setup

- Prepared: 2026-11-11.
- Purpose: prepare Windows to run `firestore.rules.test.ts` against the local Firestore Emulator.
- **Preparation only: no software was installed, no emulator was started, and no production deployment or data operation was performed.**

## Detected machine state

| Prerequisite | Detected | Assessment |
|---|---|---|
| Node.js | `v26.13.0`, at `C:\Program Files\nodejs\node.exe` | Meets Firebase CLI documented Node.js >=18 and Emulator Suite >=16 minimums. A prior temporary Firebase CLI 15.35.0 invocation worked but emitted a dependency engine warning that one dependency listed Node 20/22/24. If warnings persist with global install, use a supported Node 24 LTS installation for the test session. |
| npm | `11.20.0` | Available. |
| Java/JDK | `java` not found; `JAVA_HOME` unset | **Blocking.** Firestore Emulator requires JDK 11 or later. Recommend JDK 21 LTS. |
| Firebase CLI | `firebase` command not found | **Blocking.** Local Emulator Suite requires Firebase CLI 8.14.0 or later. A prior `npm exec` check ran CLI 15.35.0 without installing it globally. |
| npm global prefix | `C:\Users\M\AppData\Roaming\npm` | The prefix directory does not exist; `npm list --global` fails with `ENOENT`. Create it and add it to the current/user PATH before global CLI installation. |
| Rules test dependencies | `node_modules`, `tsx`, and `@firebase/rules-unit-testing` present | Ready; no dependency manifest change or package restore is needed. |
| Emulator config | `firebase.test.json` present and validates | Loads `firestore.rules`, uses Firestore Emulator port 8080, disables Emulator UI, and enables single-project mode. |
| Test suite | `firestore.rules.test.ts` imports and exports `runFirestoreRulesDirtyDozenSuite()` | Import check passed without connecting to Firebase. It has not yet been executed against an emulator. |
| Production isolation | `.firebaserc` defaults to production, but test CLI commands pass `--project demo-passersi-rules-test` | Always preserve the explicit demo project ID. Never run emulator tests with the production project ID. |

## Compatibility requirements

The current Firebase documentation lists:

- Firebase CLI: Node.js 18.0.0 or later.
- Local Emulator Suite: Node.js 16.0 or later, Java JDK 11 or later, and Firebase CLI 8.14.0 or later.
- Firestore Emulator default port: 8080.

The installed Node `v26.13.0` meets the published minimum. However, the prior CLI 15.35.0 run emitted an engine warning for a transitive package that listed Node 20, 22, and 24. This warning did not prevent the CLI from starting, but a Node 24 LTS session is the safer option if the installed CLI emits that warning again. Java JDK 21 satisfies the documented JDK 11+ requirement.

Official references:

- [Firebase CLI installation for Windows](https://firebase.google.com/docs/cli#install-cli-windows)
- [Local Emulator Suite installation and configuration](https://firebase.google.com/docs/emulator-suite/install_and_configure)
- [Firestore Rules unit testing](https://firebase.google.com/docs/rules/unit-tests)
- [Firestore Rules emulator setup](https://firebase.google.com/docs/rules/emulator-setup)

## Install prerequisites on Windows

Run these commands in **PowerShell**. Installing tools changes the local machine only; none of these commands deploy rules or access production Firestore data.

### 1. Install Java JDK 21

Install the Winget package identified during this machine check:

```powershell
winget install --exact --id EclipseAdoptium.Temurin.21.JDK --accept-package-agreements --accept-source-agreements
```

Close and reopen PowerShell after installation. Verify:

```powershell
java -version
Get-Command java | Select-Object -ExpandProperty Source
```

The Java version must be 11 or later. If `JAVA_HOME` is not set by the installation, inspect the resolved executable and set it for the user:

```powershell
$javaExe = (Get-Command java).Source
$javaHome = Split-Path (Split-Path $javaExe -Parent) -Parent
Write-Output "Detected JAVA_HOME candidate: $javaHome"
Test-Path (Join-Path $javaHome 'bin\java.exe')
```

If that test returns `True`, persist and activate it:

```powershell
[Environment]::SetEnvironmentVariable('JAVA_HOME', $javaHome, 'User')
$env:JAVA_HOME = $javaHome
```

If `java` is not found after installing, reopen a new shell or add the JDK `bin` folder to PATH using the organization's approved environment management. Do not guess `JAVA_HOME`; confirm the executable path first.

### 2. Confirm Node and npm

Node is already installed. Verify in a fresh shell:

```powershell
node --version
npm --version
```

The documented minimums are Node 18+ for Firebase CLI and Node 16+ for Emulator Suite. This machine's Node 26 meets those minimums. If Firebase CLI emits the previously observed dependency engine warning, use an approved Node 24 LTS installation for this test session and verify again. Do not change project dependencies just to install the CLI.

### 3. Repair npm global command path and install Firebase CLI

The detected npm global prefix is `C:\Users\M\AppData\Roaming\npm`, but that directory does not exist. Create it, add it to the current and user PATH, then install Firebase CLI:

```powershell
$npmPrefix = (npm config get prefix).Trim()
New-Item -ItemType Directory -Force -Path $npmPrefix | Out-Null

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathEntries = @($userPath -split ';' | Where-Object { $_ })
if ($pathEntries -notcontains $npmPrefix) {
    $newUserPath = (@($pathEntries) + $npmPrefix) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
}
$env:Path = "$npmPrefix;$env:Path"

npm install --global firebase-tools
```

Verify:

```powershell
Get-Command firebase | Select-Object -ExpandProperty Source
firebase --version
```

Require Firebase CLI 8.14.0 or later. The previously observed current CLI version was 15.35.0. If npm reports an engine warning or install error, preserve the output and resolve the Node/npm environment before testing.

Firebase CLI account login is not required for this local emulator run. Do **not** run `firebase login` as a prerequisite to the rules suite; no production project access is needed.

### 4. Verify repository setup

Run from the repository root:

```powershell
$testConfig = Get-Content .\firebase.test.json -Raw | ConvertFrom-Json
if ($testConfig.firestore.rules -ne 'firestore.rules') { throw 'Unexpected rules path.' }
if ($testConfig.emulators.firestore.port -ne 8080) { throw 'Unexpected emulator port.' }
if (-not $testConfig.emulators.singleProjectMode) { throw 'singleProjectMode must be enabled.' }

if (-not (Test-Path .\node_modules\.bin\tsx.cmd)) { throw 'Local tsx dependency is missing.' }
if (-not (Test-Path .\node_modules\@firebase\rules-unit-testing)) { throw 'Rules unit testing dependency is missing.' }
Select-String -Path .\firestore.rules.test.ts -Pattern "const PROJECT_ID = 'demo-passersi-rules-test'"
```

No `firebase init` wizard is needed: project, production deployment, and emulator configs already exist. Do not overwrite `firebase.json`, `.firebaserc`, or `firebase.test.json` with wizard defaults.

## Start the emulator and execute the repository rules suite

Use two PowerShell windows opened at the repository root. The test project ID is `demo-passersi-rules-test`; the production project is intentionally not used.

### Window 1 — start Firestore Emulator

```powershell
firebase emulators:start --only firestore --project demo-passersi-rules-test --config .\firebase.test.json
```

Wait for the CLI to confirm Firestore Emulator is ready on port 8080. The CLI downloads the emulator binary on first start. Keep the process running while tests execute. This starts only the local Firestore Emulator; it is not a deploy command.

### Window 2 — run `firestore.rules.test.ts`

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
node --import tsx --input-type=module -e "import('./firestore.rules.test.ts').then(m => m.runFirestoreRulesDirtyDozenSuite()).catch(e => { console.error(e); process.exitCode = 1; })"
```

The exported function reads `firestore.rules`, initializes the rules test environment, runs the assertions, and cleans up. Require process exit code `0`. If an emulator connection error occurs, verify Window 1 is ready and port 8080 is not occupied. Stop the emulator with `Ctrl+C` after test completion.

### Run all repository rules-related tests

Repository search found exactly one rules-related test file and no other registered rules test command. The command above is therefore the exact command to execute **all current repository Firestore Rules tests**. It must be run while the emulator is active.

Optional supplemental checks:

```powershell
npm run lint
npm run build
```

These are not substitutes for the emulator suite.

## PASS criteria before production deployment

Do not deploy rules until all criteria are met:

1. `java -version` confirms JDK 11 or later, Firebase CLI is 8.14.0 or later, and Node meets documented requirements without unresolved runtime errors.
2. The Firestore Emulator starts successfully with `firebase.test.json` under `demo-passersi-rules-test` on port 8080. No production project or database is supplied to the test commands.
3. `runFirestoreRulesDirtyDozenSuite()` completes with exit code `0`; no skipped/failing assertions, import errors, or emulator connection errors.
4. The rules suite explicitly verifies valid paired competitor/assignment creation and reassignment, standalone assignment create/update denial, direct assignment delete denial, retirement-required reassignment, identity/owner/card-series mismatch denial, role authorization, and readout receipt/counter flows. Add focused tests if any required positive or negative case is absent.
5. Test evidence records date, CLI/JDK/Node versions, target rules Git commit/blob or digest, exact command, and successful exit status.
6. The tested `firestore.rules` file is unchanged between testing and the later approved deployment. The test pass does not itself authorize or perform deployment.

Any failed assertion, missing required case, emulator startup error, or production target in a test command is **FAIL / NOT READY**. Keep production rules unchanged and resolve the issue before requesting deployment approval. The production cutover remains **NO-GO** until the separately documented deployed-rule, trusted-writer, inventory, concurrency, retry, and recovery gates are satisfied.
