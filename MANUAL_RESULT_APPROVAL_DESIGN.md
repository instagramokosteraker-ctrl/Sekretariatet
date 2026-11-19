# Manual Result Approval Design

**Status:** Design only; no application code or Firestore rules implementation.

## Decision

Add an explicit operator action for completing a competitor result without an
available SI-card readout:

`MANUAL_RESULT_APPROVAL`

The action converts a `PRELIMINARY_FIN` result to `OK` only after a valid
manual finish time, authorized role and explicit reason are verified.

## Supported scenarios

- lost SI card;
- damaged SI card;
- forgotten readout; and
- reserve timing procedure.

In all cases, `Manuell måltid (Reservklocka vid målet)` creates or confirms a
manual finish time but does not itself approve the final race result.

## Eligibility

Approval requires all of the following:

1. the competitor is in `PRELIMINARY_FIN`;
2. `finishTimeSec` or `manualFinishTimeSec` contains a valid finish time;
3. the actor is authorized for the selected competition;
4. an explicit, non-empty reason is supplied; and
5. the approval operation is still valid against the competitor's current
   state.

Approval is rejected with no result mutation if any requirement fails.

## Result and verification model

Preserve the existing race status `OK` while separating provenance:

| Verification | Meaning |
|---|---|
| `SI_VERIFIED_OK` | OK backed by a matched, valid SI-card readout |
| `MANUALLY_APPROVED_OK` | OK approved explicitly after reserve-clock/manual finish without a usable SI-card readout |

The current status remains `OK` for both. UI may show SI-verified or manually
approved as separate detail text. A result must not derive manual provenance
solely from `manualFinishTimeSec`, `readoutAt` or delivery state.

## Audit trail

Approval is an append-only audit event. It must include:

- approval action ID and operation ID;
- competitor ID, bib and class snapshot;
- previous and new status;
- manual finish source and finish time;
- operator reason;
- actor UID and authorized role;
- server-authoritative timestamp;
- server transaction/result reference;
- whether a usable SI-card readout was available at approval time; and
- a reference to a later SI receipt/readout, if one arrives.

Approval must not overwrite:

- the original `PRELIMINARY_FIN` status;
- the manual finish payload;
- the original/manual finish audit entries;
- existing readout history; or
- a later received SI readout.

Failed approval attempts may be logged as rejected/conflict audit events, but
must not be presented as successful approval or make a result outstanding as
resolved.

## Readout history interaction

Manual approval is not a physical SI-card readout and must not create a
clientReadoutId or captureSequence. It is an append-only result-correction
action associated with the competitor and, when available, the relevant
manual-finish record.

The existing readout-history model remains unchanged:

- SI-readout history rows remain keyed and ordered by capture identity;
- manual approval has no synthetic readout receipt;
- later SI readouts are separate history rows;
- manual approval provenance remains visible in competitor/result details;
- public projections receive no private audit or raw readout data.

## Correction workflow

1. Operator opens a competitor in `PRELIMINARY_FIN`.
2. Operator verifies that a valid reserve-clock finish time exists.
3. Operator chooses **Manuell godkännande av resultat**.
4. UI presents previous status, finish time, and required reason field.
5. Client submits the stable approval operation ID and reason.
6. Server rechecks competition, role, current status and finish time.
7. Server atomically:
   - changes current status from `PRELIMINARY_FIN` to `OK`;
   - stores `MANUALLY_APPROVED_OK` provenance;
   - appends the approval audit event;
   - recomputes the affected official finish/running result as specified by
     the existing result model.
8. UI shows the current green OK result with explicit manual-approval
   provenance.

At every step the operator must remain able to read the next SI card.
No modal workflow may block hardware capture.

## Idempotency

The approval operation uses a stable operation ID independent of a readout
receipt. Reusing the same operation ID:

- returns the same existing outcome;
- applies no second status mutation;
- creates no duplicate audit event;
- rejects changed reason/time/competitor parameters if they conflict.

If a later SI-card readout arrives:

- it creates its normal receipt/history record;
- it does not silently rewrite original manual approval;
- the system may show both evidence sources and any subsequent reconciliation;
- only an authorized, separate correction may change or supersede result data.

## Authorization

Implementation must use an authorized server/trusted backend boundary. A
browser role check is insufficient.

At minimum:

- the server verifies authenticated identity;
- the actor has an approved role;
- the actor may operate on the selected competition;
- the competition is eligible and not completed unless an approved
  super-admin recovery path explicitly exists;
- a valid finish time and explicit reason are present.

No public client receives approval audit data.

## Firestore/Rules shape

Design fields must be separated by responsibility:

- competitor current status/result fields;
- reserve/manual finish fields;
- readout/receipt records;
- append-only manual approval audit records;
- stable approval operation ID.

The implementation must:

- prevent direct client status changes that bypass approval checks;
- keep approval audit append-only;
- scope reads/writes to authorized staff;
- preserve public result projections;
- avoid storing raw card or private audit data in public projections.

Exact collection/path names, field names and rules remain implementation
decisions to finalize in the implementation phase.

## Acceptance criteria

- [ ] Only `PRELIMINARY_FIN` can enter this approval action.
- [ ] Approval is rejected if finish time, authorization or reason is missing.
- [ ] Lost, damaged or forgotten cards and reserve timing all use the same
      explicit approval action.
- [ ] Successful approval changes current status to `OK`.
- [ ] Original `PRELIMINARY_FIN` and manual-finish data remain preserved.
- [ ] History/detail UI distinguishes SI-verified OK from manually approved OK.
- [ ] Approval record is append-only and server-attributed.
- [ ] Replayed approval is idempotent.
- [ ] A later SI-card readout does not erase approval provenance.
- [ ] Public projections expose neither approval reason nor private audit data.
- [ ] Direct client writes cannot bypass `MANUAL_RESULT_APPROVAL` checks.
- [ ] Reading the next card remains independent of approval workflow.
