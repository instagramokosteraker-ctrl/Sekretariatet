# Eventor Identity Preservation — Phase 2

## Result: PASS

Identity preservation is implemented for **new Eventor imports only**. No
historical migration or backfill is performed. Existing competitions can
continue without Eventor IDs.

## What changed

- The Eventor parser retains the event ID, class ID, person ID, and explicit
  per-entry organisation ID. It keeps IDs as strings and rejects values longer
  than the Firestore schema limit rather than silently truncating them.
- The new Eventor competition import maps those IDs onto the corresponding
  `CompetitionMeta`, `CompClass`, and `Competitor` objects. Generated
  PasserSI/Firestore IDs remain the document and relationship IDs.
- `createCompetitionInFirestore()` and the Eventor import persistence path
  write identity fields only when explicitly called with the new-import
  preservation flag. Class IDs are written on class creation; competitor
  person/organisation IDs are written by the existing atomic SI assignment
  transaction when the competitor is created.
- Existing competitor update writes omit Eventor identity fields. Existing
  classes are updated without changing their identity fields. Existing
  competition documents are not backfilled or rewritten by this change.
- Firestore validators accept the optional identity strings, while continuing
  to accept legacy documents where those fields are absent.
- Competition, class, and competitor Firestore reads hydrate the optional
  identities for later application use.
- RunnerDb parsing, reconciliation, and synchronization behavior are
  unchanged. The existing per-runner fallback organisation ID handling
  remains separate from the per-entry competitor identity.
- Atomic SI Matching and the existing import transaction structure are
  unchanged. IOF XML generation and historical imports are out of scope.

## Verification

| Check | Result |
|---|---|
| `npm run build` | PASS |
| `npm run lint` | PASS |
| Eventor import Firestore-field tests | PASS — 3 tests |
| RunnerDb Eventor sync tests | PASS — 4 tests |
| `git diff --check` | PASS |

The Eventor import and RunnerDb tests were run together with:

```text
npx vitest run src/utils/eventorImportFirestore.test.ts src/utils/eventorRunnerSync.test.ts
```

An additional run of the repository's full exported Firestore rules suite
started in the emulator but did not complete: the suite hit Firestore's
1,000-expression evaluation limit during a competitor update. The requested
build, lint, Eventor import, and RunnerDb sync checks all passed.

## Explicit behavior checks

- **Eventor competition-ID import still works:** PASS for the implemented
  import path and its local build/test verification. No live Eventor API call or
  production Firestore write was made during this task.
- **RunnerDb sync still works:** PASS; the existing Eventor runner-sync
  regression tests pass, and its synchronization implementation was not
  changed.
- **Existing Eventor competitions:** left without identities; no backfill or
  name/SI-number inference is performed.
- **Firestore document IDs:** unchanged.
