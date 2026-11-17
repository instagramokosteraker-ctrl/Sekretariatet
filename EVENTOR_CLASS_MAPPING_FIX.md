# Eventor class mapping fix

## Result

**PASS** — the active Eventor UI import now uses the existing `/api/eventor/import-event` route, which fetches the event, dedicated `eventclasses` resource, and entries separately. The active UI no longer passes `classesXml: eventXml`.

Class definitions for API imports are built only from the dedicated class list. Entry class IDs are retained and used to map competitors to those definitions. An entry that cannot be matched to the dedicated list now fails explicitly instead of creating an extra API-import class or silently falling back to the first class.

## Firestore compatibility

The class mapping test verifies the exact `CompClass` data passed to the existing Firestore import call:

| Class name | `eventorClassId` |
|---|---|
| Vit | `class-vit` |
| Gul | `class-gul` |
| Orange | `class-orange` |
| Svart | `class-svart` |

The existing Firestore writer remains unchanged: it writes each class to `competitions/{competitionId}/classes/{internalClassId}`, stores the class name, and preserves `eventorClassId` when `preserveEventorIdentities` is enabled. Competitor class IDs resolve to the corresponding internal class IDs.

## Changes

- `src/App.tsx`: routes active Eventor import through `/api/eventor/import-event`; delegates class creation and competitor mapping to the tested helper.
- `server.ts`: rejects an empty dedicated class list.
- `src/server/eventorXml.ts`: includes class, person, organization, and birth-year identity fields in parsed entries.
- `src/utils/eventorImport.ts`: validates the endpoint response and builds class definitions/mappings; API imports do not infer new class definitions from entries.
- `src/utils/eventorXml.ts`: allows optional birth-year data on parsed entries.
- `src/utils/eventorImport.test.ts`: adds regression coverage for Vit, Gul, Orange, Svart, preserved Eventor IDs, competitor mappings, and unmapped entries.

## Verification

- `npm run build` — **PASS**
- `npm run lint` — **PASS**
- `npx vitest run src/utils/eventorImport.test.ts src/utils/eventorImportFirestore.test.ts src/server/eventorApiClient.test.ts` — **PASS**, 3 test files / 6 tests
- `git diff --check` — **PASS**

No live Eventor request or Firestore emulator write was run. The regression test verifies the class payload passed to the unchanged Firestore writer and the class-to-competitor mapping; production Eventor credentials and Firestore deployment were not part of local verification.
