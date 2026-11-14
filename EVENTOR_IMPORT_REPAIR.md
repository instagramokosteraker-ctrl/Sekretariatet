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

## Does competition-ID import work afterward?

**PASS for the identified Firestore schema failure:** the new competitor
transaction now supplies the required field, so this `rentalReturned` rule
denial is repaired.

A live Eventor-to-production-Firestore import was not run. The build and tests
verify the client payload behavior, not deployment or a production end-to-end
import.
