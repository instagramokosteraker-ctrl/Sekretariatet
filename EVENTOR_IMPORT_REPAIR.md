# Eventor Import Repair

## Result

**PASS — repaired in the client import writer.**

New competitors created through the Eventor import path now include
`rentalReturned: false`, matching the required Firestore competitor schema.
Existing competitors are not given a `rentalReturned` update by the import
path. The SI assignment and competitor writes remain in the same Firestore
transaction.

## Change

`writeImportedCompetitorWithAssignment()` now builds separate create/update
fields through `buildImportedCompetitorWriteFields()`:

- `CREATE` removes any imported `rentalReturned` value and sets it to `false`.
- `UPDATE` removes `rentalReturned` from the update patch, leaving the
  Firestore-owned value unchanged.

The existing ownership checks, duplicate-SI checks, assignment validation, and
transaction sequence are unchanged. See
[firebase.ts](./src/firebase.ts) and
[importedCompetitorWrite.ts](./src/utils/importedCompetitorWrite.ts).

## Tests

- **PASS** `npm run build`
- **PASS** `npm run lint` (`tsc --noEmit`)
- **PASS** Eventor import path tests:
  `npx vitest run src/utils/eventorImportFirestore.test.ts src/server/eventorApiClient.test.ts src/utils/eventorRunnerSync.test.ts`
  — 3 test files, 7 tests passed.
- **PASS** `git diff --check`

The build emitted existing Vite configuration and large-chunk warnings; it
completed successfully.

## Follow-up runtime failure

A later production attempt still failed. Its Firestore `Commit` request contains
only the initial create of `competitions/{id}` with `currentDocument.exists:
false`; it is rejected before classes, RunnerDb, competitors, or SI assignments
are written. The `rentalReturned` fix remains correct, but it does not address
this earlier create denial.

The supplied create payload matches the repository's competition schema. The
remaining repository-rule gates are verified authentication, exact
`ownerUid == request.auth.uid`, and `isAdmin()`. The follow-up code now forces an
ID-token refresh, checks the Firestore admin role and owner UID before the
write, and logs a denied create with operation/path context. See
[competitionCreateAuthorization.ts](./src/utils/competitionCreateAuthorization.ts)
and [firebase.ts](./src/firebase.ts).

## Verification and status

- **PASS** `npm run build`
- **PASS** `npm run lint` (`tsc --noEmit`)
- **PASS** Eventor/import and authorization tests — 4 files, 11 tests passed.
- **PASS** `git diff --check`

The follow-up auth/preflight change has not been published or tested against
production yet. Therefore **competition-ID import is not confirmed working**.
If the create is still denied after that change is deployed, inspect the
active `competitions/{competitionId}` create rule for the named Firestore
database; an app deployment does not itself deploy Firestore rules.
