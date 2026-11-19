# Competitor Deletion Analysis

**Status:** Analysis only. No implementation, deletion behavior change or data mutation.

## Executive conclusion

The individual-competitor deletion implemented by the current Firestore path is
**primarily a hard delete**:

- the `competitions/{competitionId}/competitors/{competitorId}` document is deleted;
- the matching public-result projection document is deleted;
- the local UI removes the competitor from its state; and
- competition counters are adjusted.

It is not a pure hard delete of the entire competitor domain. The SI assignment
is retained as a `RETIRED` document, and several historical records are not
deleted:

- `readoutReceipts` are retained;
- `stationPunches` are retained;
- workstation-local `ReadoutHistoryStore` rows are retained;
- RunnerDb/Eventor person and organisation identities outside the competitor
  document are retained; and
- no dedicated competitor-deletion audit record is currently written.

Classification: **hybrid hard delete** of the current competitor record, with
soft/retirement treatment for SI assignment and retained operational history.

## Workflow traced

### Current UI workflow

1. `EntriesRegistrationView` enters its inline `deletingId` state.
2. The operator sees a red **Radera** button and a cancel button.
3. The UI calls `onDeleteCompetitor(c.id)`.
4. `App.tsx` calls `deleteCompetitorFromFirestore(activeEventId, id)`.
5. `deleteCompetitorFromFirestore` calls the private Firestore transaction
   boundary `runAtomicSIAssignmentMutation`.
6. The transaction:
   - reads competition and competitor context;
   - verifies competition ownership and lifecycle;
   - validates the SI assignment identity;
   - retires or creates a retired SI assignment;
   - deletes the competitor document;
   - deletes the public result projection;
   - decrements `competitorCount`;
   - decrements `finishedCount` when the deleted status was finished; and
   - commits or aborts all writes together.
7. After the committed transaction, `App.tsx` removes the competitor from
   React state.

Relevant code:

- [EntriesRegistrationView.tsx](./src/components/EntriesRegistrationView.tsx)
- [App.tsx](./src/App.tsx)
- [firebase.ts](./src/firebase.ts)
- [firestore.rules](./firestore.rules)
- [siAssignmentRetirement.ts](./src/server/siAssignmentRetirement.ts)

### Trusted retirement route

The server route
`POST /api/firestore/competitions/:competitionId/competitors/:competitorId/retire`
is implemented for retirement rather than hard deletion. It:

- requires an administrator session;
- re-reads the caller's admin role;
- verifies competition ownership;
- rejects retirement from a completed competition for non-super-admins;
- validates competitor and assignment identity; and
- updates competitor status and retires the matching assignment atomically.

Its status transition is:

- `IN_FOREST` or `PRELIMINARY_FIN` → `DNF`;
- `OK`, `MP` or `DNF` → unchanged; and
- all other states → `DNS`.

The trusted retirement route does not delete the competitor or public
projection; it converts the record into a non-participant status.

### Legacy route

`DELETE /api/competitors/:id` is disabled and returns HTTP 410. There is a
commented-out legacy implementation below that terminal handler, but the active
route rejects it before the legacy body. No normal UI path should reach
legacy deletion.

The active Express route must not be used as evidence of Firestore deletion:
legacy state is separate from the canonical Firestore document.

## Impact by data area

### Result lists

For an individual deletion:

- the canonical competitor document disappears;
- `finishedCount` and `competitorCount` are decremented appropriately;
- the public per-competitor result document is deleted;
- class/result/list queries that read raw competitors lose the competitor;
- public result lists lose it when the projection listener sees the deletion;
- any already displayed UI snapshot remains until listener/reload reconciliation;
- re-calculation or later snapshot hydration may not have enough historical
  identity to restore it as the same competitor.

If only retirement is used instead, the competitor remains and the public
projection remains with `DNF` or `DNS`, preserving the result-list row.

### Radio passages

Individual competitor deletion does **not** delete
`competitions/{competitionId}/stationPunches`.

The punch documents keep their historical fields, including SI number,
`competitorId`, station function and punch time. Later result processing or
radio views may:

- keep displaying an orphaned passage associated with a deleted ID;
- fail to match it to a current competitor; or
- show no runner name while the raw passage remains available to staff.

The radio listener can continue to deliver the historical passage. Deletion
should therefore detach and reconcile radio passages explicitly rather than
assume cascade deletion.

### SI assignments

The canonical assignment document is the primary convergence point.

Individual hard deletion:

- validates the assignment belongs to the competitor;
- creates a `RETIRED` assignment if none exists;
- changes an existing `ACTIVE` assignment to `RETIRED`;
- increments `assignmentVersion`;
- preserves `competitorId`, `competitorDocumentId`, card series and owner in
  the retained assignment record;
- records `retirementReason: 'competitor_deleted'`; and
- commits together with competitor/public-result deletion.

This prevents normal reuse as an active assignment. It does not erase
historical SI ownership and supports forensic reconstruction.

Direct standalone deletion of an assignment is denied by the assignment rule,
subject to the known local deployed-rules caveat. An assignment must change
through a paired mutation or trusted server boundary.

### Readout history

The workstation browser retains readout history in its IndexedDB
`ReadoutHistoryStore`. Individual competitor deletion does not:

- delete that browser history;
- delete the `clientReadoutId`/`captureSequence` record;
- remove original punches or original result snapshots; or
- remove the workstation's local row.

The row may remain locally with a stale or deleted
`competitorId`/`competitorSnapshot`. The UI should mark the current competitor
link as unavailable and preserve the original history/audit evidence.

Firestore `readoutReceipts` are separate immutable records. Individual
deletion does not delete them. They remain in
`competitions/{competitionId}/readoutReceipts/{clientReadoutId}` and preserve
SI payload, matching status and competitor ID.

The readout history is therefore not a result-list backup and must not be
used as a reason to hard-delete the canonical audit evidence.

### Eventor identities

Individual deletion removes Eventor person/organisation identifiers from the
competitor document only. It does not delete:

- competition-level `eventorEventId`;
- class-level `eventorClassId`;
- RunnerDb `eventorPersonId`;
- RunnerDb `eventorOrgId`; or
- any historical ResultList/export evidence.

The deleted competitor may therefore disappear from race results and result
projections while its identity remains in a RunnerDb record or historical
receipt. A later re-entry with the same Eventor identity can be a distinct
competitor unless the operation explicitly performs identity reconciliation.

This is not enough for a safe audit trail if the deleted competitor's identity
is later reused without retaining a tombstone.

### Public result projections

The individual Firestore deletion transaction deletes
`competitions/{competitionId}/publicResults/{competitorId}`.

Consequences:

- the public portal stops receiving the result row;
- public ranking/count calculations can be affected;
- the public result is not retained as a tombstone;
- deletion is not accompanied by a public audit or deletion reason;
- listener/reconnect timing determines whether a stale projected result remains
  visible until the next snapshot.

Public result projections must not keep private SI or raw readout fields.
They should be removed or replaced by an explicit public tombstone only in a
future, deliberate design.

### Audit records

No general append-only competitor-deletion audit record is written by the
current individual deletion path.

The only deletion-related evidence is dispersed:

- retired SI assignment: `retirementReason`, `retiredAt`, assignment version;
- public and competitor deletion: no dedicated reason/actor record;
- local readout history: remains, but is workstation-local and not
  competition-wide;
- readout receipts: are immutable and identify a submitted operation;
- legacy live-event records: separate and not an immutable audit source.

The transaction does not currently record:

- actor UID;
- actor role;
- deletion reason;
- server timestamp;
- previous competitor snapshot;
- previous status/result;
- previous/public-result snapshot;
- dependent radio/readout counts; or
- operation ID/replay outcome.

This fails the audit requirements needed for a controlled race administration
workflow.

## Hard delete or soft delete?

The state of each relevant object differs:

| Object | Current treatment |
|---|---|
| Competitor document | Hard deleted |
| Public result projection | Hard deleted |
| SI assignment | Retained and retired |
| Readout receipts | Retained |
| Radio punch receipts | Retained |
| Workstation readout history | Retained locally |
| RunnerDb/Eventor identity | Retained globally/locally |
| Deletion audit record | Missing |

Therefore, the individual competitor operation is neither a complete hard
delete nor a fully implemented soft delete.

The safer product-level classification should be:

> Competitor deactivated and tombstoned; operational and historical evidence
> retained.

## Safest recommended approach

Recommend a **soft delete/tombstone model**, not immediate permanent deletion.

The final implementation should retain the competitor document but mark it
explicitly with fields such as:

- lifecycle state `ACTIVE` or `RETIRED`;
- retirement/deletion reason;
- `deletedAt`;
- `deletedByUid`;
- `deletedByRole`;
- original status and result snapshot;
- stable operation ID;
- tombstone/public-retirement policy.

Keep these records:

- competitor tombstone;
- SI assignment in `RETIRED` state;
- readout receipts;
- radio punch receipts;
- local readout-history records;
- append-only audit and deletion event;
- RunnerDb/Eventor identity records.

Remove or detach only presentation data that is unsafe or misleading:

- active public result row;
- active result placement/cache;
- active SI assignment;
- active UI registration eligibility.

Preserve historical result/export evidence when it is intentionally linked to
the tombstone. A later full purge should be a separate, highly restricted
retention-policy operation, never ordinary competitor deletion.

The server/trusted transaction must be the only implementation boundary.
Direct Firestore competitor deletion should remain denied or route to the
validated tombstone operation.

## Confirmation dialog requirements

### Ordinary competitor

For a competitor with no meaningful result or readout history:

- title: `Ta bort deltagare`;
- show competitor name, bib and class;
- explain that the registration and active SI assignment will be retired;
- require a reason;
- provide `Avbryt` and `Ta bort`;
- make the destructive action explicit and not the default keyboard action;
- show success only after server confirmation;
- keep the row stable during pending; prevent duplicate submit.

Recommended reason choices:

- duplicate registration;
- erroneous entry;
- runner withdrew before start; or
- other, with required text.

### Competitor with results

For `OK`, `MP`, `PRELIMINARY_FIN`, `DNF` or `DNS` with a finish/status/result:

- show a stronger warning;
- show bib, name, class, current status and finish/result data;
- explain that the result disappears from active/public result lists;
- explain that it may affect placing, counts and result exports;
- require explicit acknowledgment of those consequences;
- require an operator reason;
- require retyping or separate confirmation for completed competitions;
- recommend admin-only execution for an official or completed result;
- show exactly what will remain in history and audit.

The dialog must not imply that all historical evidence is deleted.

### Competitor with readout history

For a competitor linked to one or more readout receipts or workstation history:

- show readout count, latest card/readout timestamp and linked SI number;
- classify whether there are:
  - matched readouts;
  - unknown-card resolutions;
  - radio passages; or
  - correction/audit entries;
- explain that readout receipts, radio passages and local history are retained;
- explain that future matching will use a retired SI assignment;
- require explicit acknowledgment;
- require reason and authorization;
- warn that the display may preserve raw-card evidence only for staff;
- preview whether SI ownership will be reused, retired or reassigned.

No ordinary close/cancel action should trigger deletion.

## Safest workflow

Before mutation, the trusted operation should load and return:

- competitor and status snapshot;
- finish time and result state;
- active assignment state;
- readout receipt count;
- station-punch count;
- public-projection state;
- Eventor identity presence;
- audit/dependency count.

It should then atomically:

1. validate authorization and competition state;
2. create the tombstone/retirement record;
3. append the deletion audit event;
4. retire or reassign the SI assignment;
5. update active result/status and public projections;
6. preserve receipts/punches/readout evidence;
7. remove active UI/registration eligibility;
8. return an idempotent operation result.

## Non-goals

This analysis does not approve:

- deleting readout receipts;
- deleting station-punch receipts;
- deleting RunnerDb/Eventor identities;
- erasing audit records;
- direct client-side hard deletion;
- deletion from completed competitions without a dedicated recovery policy;
- permanent purge of race evidence through the normal UI.
