# Lightweight competitor deletion

## Implemented behavior

Competitor deletion remains a hard delete. Before deletion, the operator sees the
competitor name and class, selects a required reason, and confirms the action.
The available reasons are duplicate registration, incorrect import, test data,
and other; selecting other requires a short explanation.

The confirmation is upgraded to a warning when the competitor appears to have
competition history. The warning calls out the effect on result lists, public
results, and radio passages, and clarifies that readout receipts and historical
readouts are retained.

The history check includes result/participation status, manual finish, readout
fields, Firestore readout receipts, radio and prewarning passages, and local
IndexedDB readout history for the active competition. Firestore receipt and
radio records are also matched by SI number, so reassigned/shared cards may
conservatively show the warning.

Deletion still retires the SI-card assignment, removes the competitor and
public result projection, and updates competition counters atomically. Readout
receipts, station punches, and local readout history are not deleted.

## Audit

Each successful deletion creates an immutable document at
`competitions/{competitionId}/competitorDeletionAudits/{competitorId}` in the
same Firestore transaction as the deletion. It records the server timestamp,
authenticated actor UID, competitor ID and name, reason code, and reason text.
Firestore rules require the audit record to be created with the competitor
deletion and prohibit later audit updates or deletes.

## Eventor and history scope

This change does not add a tombstone, restore flow, retirement lifecycle, or new
Eventor identity model. Hard deletion still removes the local competitor
document and its Eventor identity fields. The audit preserves the local
competitor ID/name/reason, but does not preserve the full Eventor identity or
external Eventor result linkage. Operators should therefore use deletion only
for the intended cleanup cases.

Local readout history is device-local. The active operator's local history is
included in the warning check, but history stored only on another workstation
cannot be discovered by this lightweight design.

## Validation

- `npm run lint` — passed.
- `npm run build` — passed.
- `npx vitest run --exclude firestore.rules.test.ts` — passed: 34 files, 153
  tests; 4 files and 12 tests skipped.
- `npx vitest run src/utils/competitorDeletion.test.ts` — passed: 2 tests.
- `runCompetitorDeletionRulesSuite()` against the Firestore Emulator — passed.
  It verifies that a direct delete and a standalone audit create are denied,
  the paired audit-and-delete succeeds, and an audit cannot be deleted.
- The broader `runFirestoreRulesDirtyDozenSuite()` remains blocked by the
  existing Firestore Rules 1,000-expression evaluation limit in unrelated
  competitor update cases; it fails before reaching the deletion assertions.

## Files changed for this implementation

- `src/components/EntriesRegistrationView.tsx`
- `src/App.tsx`
- `src/firebase.ts`
- `src/utils/competitorDeletion.ts`
- `src/utils/competitorDeletion.test.ts`
- `firestore.rules`
- `firestore.rules.test.ts`
