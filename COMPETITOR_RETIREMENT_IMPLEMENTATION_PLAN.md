# Competitor Retirement Implementation Plan

**Status:** Design and implementation planning only. No application behavior,
Firestore rules, data or production state was changed.

## Product decision

Use two distinct operations:

1. **Delete competitor** — hard-delete only when the system can establish that
   the competitor has no competition history or external result linkage.
2. **Retire competitor** — retain the competitor and all linked evidence, but
   remove it from active registration and draw workflows. This is mandatory
   whenever history exists or its absence cannot be established.

Do not silently turn a historical result into an absent competitor. Do not
offer permanent deletion as a routine alternative for a competitor with
history. The design's **Avancerat: Ta bort permanent** must be disabled when
any history exists; a future exceptional purge, if ever required, is a separate
privacy/retention operation with explicit authorization and audit, not this
ordinary UI action.

## Current implementation compared with the decision

### Current delete workflow

- The registration list has an inline **Radera** confirmation and cancel
  button; it does not show competitor history, ask for a reason, or distinguish
  ordinary competitors from competitors with results/readouts.
- `App.tsx` calls `deleteCompetitorFromFirestore`.
- That Firebase client-SDK transaction retires/creates the SI assignment,
  hard-deletes the competitor document and public result projection, adjusts
  competition counters, then removes the competitor from local React state.
- It does not check readout receipts or station-punch dependencies before
  deletion and does not create a deletion audit record.
- The legacy `DELETE /api/competitors/:id` endpoint is fenced with HTTP 410;
  its old handler body is inactive.

### Current retirement workflow

- A trusted Admin SDK route
  `POST /api/firestore/competitions/:competitionId/competitors/:competitorId/retire`
  exists and validates administrator role, ownership, competitor identity and
  assignment identity in a transaction.
- It changes status to `DNF` for `IN_FOREST`/`PRELIMINARY_FIN`, to `DNS` for
  other non-finished states, and preserves `OK`, `MP` and `DNF`.
- It retires the SI assignment and updates the public result projection. It
  does not add an explicit competitor lifecycle field or deletion/retirement
  audit record.
- The route does not decrement `competitorCount`; the competitor document
  continues to be returned by competition listeners and may still appear in
  registration/draw selectors. The underlying draw eligibility function
  explicitly accepts `DNS`, so status alone does not reliably remove a retired
  competitor from draw workflows.
- The client wrapper `retireCompetitorInFirestore` exists, but the current
  registration deletion action uses the hard-delete function. Retirement is
  not presently the ordinary UI path.

Relevant code:

- [EntriesRegistrationView.tsx](./src/components/EntriesRegistrationView.tsx)
- [App.tsx](./src/App.tsx)
- [firebase.ts](./src/firebase.ts)
- [server.ts](./server.ts)
- [siAssignmentRetirement.ts](./src/server/siAssignmentRetirement.ts)
- [startListDraw.ts](./src/utils/startListDraw.ts)
- [readoutHistoryStore.ts](./src/services/readoutHistoryStore.ts)
- [firestore.rules](./firestore.rules)

## Definition of competition history

History evidence means any evidence that the competitor took part in, was
processed for, or was externally linked to this competition. The classifier
must consider all available sources, not only the current competitor status.

Treat any of the following as history:

- one or more readout receipts linked to the competitor;
- readout-derived fields or raw readout payload on the competitor, including
  punches, `readoutAtIso`, finish/readout data or an original/current readout
  match;
- one or more station-punch documents linked by `competitorId` or SI number;
- a manual finish time or other official result override;
- any result-bearing status, including `PRELIMINARY_FIN`, `OK`, `MP`, `DNF`
  and `DNS`;
- an Eventor result/publication linkage or an externally confirmed result
  identity;
- an existing correction, reassignment, manual approval or audit record; or
- a prior retirement/tombstone record.

`REGISTERED`, `CHECKED` or `IN_FOREST` without any of the evidence above is not
by itself historical result evidence, but the presence of a start/readout or
live activity must be inspected before allowing hard delete. A live status
with radio punches is history.

### Important limitation: workstation-local history

`ReadoutHistoryStore` currently stores complete capture records in browser
IndexedDB, intentionally local to each workstation. A different browser/device
cannot query that history. A readout can therefore exist locally while it is
offline and not yet represented by a Firestore receipt or competitor update.

The server cannot prove “no history anywhere” by checking Firestore alone.
Until a durable shared history index or an equivalent reliable capture
registration exists, the delete classifier must fail safe:

- if the caller's current workstation has a related local readout, offer
  retirement;
- if server checks find history, offer retirement;
- if any required dependency check fails or history absence is uncertain,
  disable permanent delete and offer retirement; and
- never claim that a Firestore-only check proves absence of all physical
  readouts.

This limitation is a release blocker for fully reliable Mode 1 hard delete.
Options are to make `readoutReceipts`/a minimal capture index available
durably across clients before enabling destructive delete, or to use
retirement for uncertain cases.

## Required data/schema changes

### Competitor lifecycle

Add a first-class lifecycle independent of race result status:

| Field | Proposed meaning |
|---|---|
| `lifecycleState` | `ACTIVE` or `RETIRED`; default legacy/missing values to `ACTIVE` during migration. |
| `retiredAt` | Server timestamp for the transition to retired. |
| `retiredByUid` / `retiredByRole` | Authenticated operator identity and role. |
| `retirementReasonCode` | Stable reason such as duplicate registration, erroneous import, test data, withdrawal, or other. |
| `retirementReasonText` | Required bounded operator text when reason code is `OTHER`; preserve exact approved reason in audit. |
| `retirementOperationId` | Stable idempotency key for replay/retry. |
| `priorLifecycleState` | Previous lifecycle snapshot for audit/restore policy. |

Keep `status` as the race status. Retirement must not rewrite a real `OK`,
`MP`, `DNF` or `DNS` into a different race outcome merely to hide the person
from operational screens. If the person was still in forest, require an
explicit race-status decision (e.g. record DNF if justified) separate from the
retirement operation.

### Audit and deletion evidence

Create append-only, staff-only audit events for both hard delete and
retirement. Each event should record:

- operation ID, action, competition and competitor IDs;
- actor UID/role and server-authoritative timestamp;
- reason code and reason text;
- prior competitor snapshot needed to identify the person/result;
- prior lifecycle and result status;
- SI number/card-series identity snapshot;
- Eventor person/org IDs and linkage state;
- readout receipt, station punch and correction/audit dependency counts;
- assignment prior state/version and resulting state/version;
- public result projection prior state and resulting disposition; and
- outcome, including replay/rejection reason where applicable.

Audit records are immutable to clients and not included in public projections.
A hard delete must not erase the only retained competitor identity; the
deletion audit/tombstone must preserve the minimum data needed for
traceability, subject to the club's retention/privacy policy.

### History preflight result

The trusted server preflight should return a typed impact summary, not an
unstructured boolean:

- `hasHistory`;
- `historyReasons[]`;
- `readoutReceiptCount`;
- `stationPunchCount`;
- `manualFinishPresent`;
- `resultStatus`;
- `eventorResultLinked`;
- `assignmentState` and version;
- `publicResultExists`;
- `localHistoryKnown` and its scope (current workstation only); and
- whether hard delete is currently eligible.

Never treat a failed query as zero dependencies.

## Mode 1 — Delete competitor

### Eligibility

Hard delete may be offered only when all trusted-server checks establish:

- no readout receipt;
- no readout-derived competitor fields/raw payload;
- no station punches;
- no manual finish or official result override;
- no result-bearing status;
- no Eventor result linkage/publication;
- no correction, approval, audit or prior-retirement history;
- no dependent operation that references the competitor; and
- no uncertainty from unavailable data or failed preflight.

Eventor identity fields alone need a deliberate distinction. A mere imported
identity on an unstarted, unpublished record may represent a bad import; an
Eventor result/publication link is history and forces retirement. Preserve
the identity snapshot in the deletion audit even for a permitted erroneous
import removal.

On eligible delete:

- retire the SI assignment; do not erase assignment history or reuse its
  version;
- delete the competitor and active public projection atomically;
- remove it from active competitor/registration counts;
- append the immutable deletion audit/tombstone;
- retain shared RunnerDb identity records; and
- return an idempotent result.

Do not expose permanent delete for completed competitions through the normal
registration UI. Any exception belongs to an explicitly authorized,
separately audited purge workflow.

## Mode 2 — Retire competitor

Retirement is mandatory if any history exists or the preflight cannot prove
there is none.

Retirement must:

- keep the competitor document with `lifecycleState=RETIRED`;
- retain the original race status and result values;
- retain SI assignment history and ensure no active assignment remains for
  that retired competitor;
- retain readout receipts, station punches, Eventor identifiers and audit;
- append the retirement audit event;
- remove the competitor from active registration, participant counts and new
  draw allocations;
- ensure existing result/history and staff views can still resolve the
  competitor identity; and
- retain public result rows only according to actual result/publication
  policy. A historical public result should not be silently erased; a
  pre-start, never-participated competitor should not remain as a false result.

Prevent future SI assignment to the retired competitor. Reusing the SI card
for a different competitor must go through the existing explicit
reassignment/retirement model; do not mutate old receipts or change their
historical competitor ID.

Provide a separately authorized **Restore** workflow only if product rules
allow reactivation. Restore must be audited and must not automatically
reactivate a retired SI assignment or overwrite race history.

## UI changes

### Registration list

- Replace the inline delete/cancel buttons with an impact-aware confirmation
  dialog.
- Active lists default to `lifecycleState=ACTIVE`; add a staff-only
  **Pensionerade** filter/list to inspect retired records.
- Retired records are read-only by default and cannot be selected for draw,
  new assignment, direct entry matching or normal result mutations.
- Keep retired records accessible in result, readout-history, radio-passage
  and audit details.

### Ordinary no-history competitor

Show:

```text
Ta bort deltagare
Namn: …
Klass: …
Orsak: Dublettregistrering | Felaktig import | Testdata | Annan
[Avbryt] [Ta bort]
```

For `Annan`, require reason text. Disable confirmation while impact preflight
is pending or if eligibility is false/unknown. Prevent duplicate submit and
show completion only after trusted-server confirmation.

### Competitor with history

Show:

```text
Denna deltagare har tävlingshistorik.
Orsak: …
[Avbryt] [Pensionera deltagare]
```

Display the history reasons/counts (readouts, receipts, radio passages,
manual finish/results, Eventor result linkage), current result, SI assignment
and what remains. Explain that the competitor is removed from active
registration/draw, but retained for results/history/audit. Do not show
permanent delete as a routine alternative.

### Advanced permanent delete

The decision's proposed `[Ta bort permanent]` must not be enabled merely
because a user selects **Avancerat**. It is not available if any history
exists or history is uncertain. If product later authorizes a purge despite
history, design it as a different restricted retention workflow, with
independent approval and legal/privacy review.

## Firestore and trusted backend changes

1. Move both mode decisions behind trusted Admin SDK operations:
   - preflight impact check;
   - eligible hard delete;
   - retirement.
2. Recheck all dependencies and authorization in the mutation transaction.
   The client preflight is display-only and can become stale.
3. Use a stable operation ID; same-input retries return the stored outcome,
   while a changed request with the same ID is rejected.
4. For permanent delete, fail closed if any dependency exists or any
   dependency read/query fails. Keep the audit/tombstone outside the deleted
   competitor document (e.g. a competition-level audit collection).
5. For retirement, atomically update competitor lifecycle, assignment state,
   relevant counts/projections and append-only audit.
6. Preserve direct-delete Rules protections and add rules for lifecycle fields
   and append-only staff-only audit. Rules must prevent clients from directly
   setting `lifecycleState=RETIRED`, deleting competitors with history, or
   changing audit documents.
7. Keep identity/assignment parity checks and version increments in the same
   trusted transaction.
8. Recalculate counters from active lifecycle membership, not collection size.
   Define separately which results contribute to `finishedCount`.
9. Keep public projections data-minimized. Do not expose retirement reason,
   raw readout content, Eventor person IDs, or private audit fields.
10. Ensure selected-competition listeners and cached clients remove retired
    records from operational lists without deleting their local readout-history
    rows.

Firestore does not cascade-delete subcollections. Hard-delete implementation
must enumerate every dependency and must not assume deleting a competitor
document removes its nested documents.

## Eventor implications

- Preserve competition `eventorEventId`, class `eventorClassId`, competitor
  `eventorPersonId`/`eventorOrgId` and RunnerDb identities on retirement.
- A competitor with an Eventor result/publication linkage is history and must
  be retired, not hard-deleted.
- An unstarted import mistake may qualify for Mode 1 only when no external
  result has been published/linked; retain its identity snapshot and import
  source in the deletion audit.
- Retirement must not silently unpublish or rewrite an already published
  Eventor result. Result correction/unpublication is a distinct, explicitly
  approved workflow requiring confirmation of Eventor's supported contract.
- Future result exports should exclude retired pre-start records without a
  result, but preserve historically valid result rows and IDs for retired
  participants.
- Do not delete shared RunnerDb entries as a side effect of competition
  competitor deletion.

## Readout History implications

- Readout history rows remain immutable physical-capture records keyed by
  `clientReadoutId`; retirement or deletion must not remove them.
- Readout receipts and original/current competitor matching references remain
  unchanged. Add a tombstone-aware name/status resolution so a retired
  competitor still appears with its historical identity.
- Existing local IndexedDB histories remain device-local; retirement must not
  claim to synchronize or erase them.
- The local readout view should show “Pensionerad deltagare” for the current
  link while preserving original name, class, result and punches.
- Any open readout correction/reassignment blocks Mode 1 deletion and requires
  resolution or retirement.
- Do not count local-only history as globally known absence. Until a shared
  capture index exists, uncertain cases must retire.

## Audit implications

- Retirement and Mode 1 deletion each produce exactly one logical audit event
  per operation ID.
- Audit stores actor, reason, timestamp, previous state, dependency summary
  and outcome.
- Failed/denied attempts may be logged as rejected security/operations events,
  but must not be represented as committed deletion.
- Audit cannot be stored only as a subcollection of the competitor if the
  competitor may be hard-deleted; use a stable competition-level audit
  location keyed by operation ID.
- Do not put audit details in anonymous/public reads.
- Establish retention, access, export and privacy handling before production
  rollout.

## Implementation phases

### Phase 0 — Contract and evidence model

- Finalize lifecycle/status semantics and the authoritative definition of
  history.
- Decide the shared capture-index approach or confirm retirement-on-uncertainty
  as the safety rule.
- Define Eventor result linkage and import-only identity distinctions.
- Define active/finished counters and historical public-result policy.
- Define audit schema, retention and authorization.

### Phase 1 — Trusted preflight and schema

- Add lifecycle and retirement fields with legacy default `ACTIVE`.
- Implement trusted impact preflight and typed dependency summary.
- Add tests for each individual history source and fail-closed query errors.
- Keep hard deletion disabled until preflight coverage is complete.

### Phase 2 — Trusted retirement

- Implement idempotent Admin SDK retirement transaction and immutable audit.
- Retain competitor/result evidence while filtering retired records from
  registration and draw paths.
- Retain public historical results as policy requires; never delete projections
  implicitly.
- Add restore/read-only archive behavior if approved.

### Phase 3 — Conditional hard delete

- Implement hard delete only for fully verified no-history competitors.
- Retire SI assignment, write an external audit/tombstone and remove active
  public projection in the same operation.
- Block deletion on any dependency, unknown status, missing index coverage or
  query error.

### Phase 4 — Cutover and cleanup

- Replace `deleteCompetitorFromFirestore` UI use with preflight plus trusted
  mode-specific operations.
- Remove or disable legacy/client hard-delete entry points.
- Audit Rules and external writers; verify deployed Rules before enabling.
- Reconcile existing records and counters before production rollout.
- Monitor rejected deletions and retirement usage.

## Testing and rollout acceptance criteria

- Ordinary no-history registrations can be deleted with a required reason.
- Each history source independently makes the competitor ineligible for hard
  delete.
- Query failure, timeout, malformed evidence or uncertain local history never
  falls through to permanent deletion.
- Historical competitors are retired without changing their race result or
  deleting readout receipts, station punches, Eventor linkage or audit.
- Retired competitors disappear from registration counts, draw class counts,
  start lists and new assignment choices.
- Retired competitors remain resolvable in result, readout, radio and audit
  history.
- SI assignment is retired atomically and cannot remain active for a retired
  competitor.
- Public result projection behavior matches the approved historical-result
  policy and leaks no private fields.
- Same operation ID replay is idempotent; reuse with a different payload is
  rejected.
- Audit identifies actor/role, timestamp, reason, prior state, dependency
  summary and committed outcome.
- Existing result counters remain correct and re-computable after both modes.
- Eventor identity and result publication are preserved; no automatic
  unpublish occurs.
- Confirm that permanent deletion is offered only for records proven to have
  no competition history; otherwise the UI offers retirement only.
- Confirm no production deployment or permanent purge occurs before Rules,
  migration, data-reconciliation and recovery sign-off.
