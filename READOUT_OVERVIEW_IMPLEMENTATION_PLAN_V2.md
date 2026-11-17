# Readout Overview Implementation Plan — V2

Date: 2026-11-17

## Status and scope

This plan incorporates the product rule that every physical SI-card readout is a first-class, reopenable record. Result statuses are `OK`, `MP`, `PRELIMINARY_FIN`, `DNF` and `DNS`; unknown cards and matching conflicts are readout/issue states, not result statuses. The latest product decision on MP issue handling is recorded in [READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V3.md](./READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V3.md).

Planning only; no application code is changed.

## Product rules

1. **Read next card immediately.** No result, correction, sync delay, or unresolved issue may gate the next physical read.
2. **Every readout is a primary record.** Do not model history as a list of failures or only as a queue of exceptions.
3. **Every history row is clickable and reopenable.** This includes successfully processed `OK` readouts that may later be found to belong to another runner.
4. **Result status, synchronization and issue state are independent.** Result statuses are `OK`, `MP`, `PRELIMINARY_FIN`, `DNF` and `DNS`. Unknown/unlinked/conflict describe readout matching or issue state, not result status.
5. **MP is not automatically an issue.** `MP` with `issueState=NONE` is valid. An operator may explicitly open an `MP_REVIEW` issue; only then does it count as outstanding.
6. **Outstanding Issues is a filtered subset of history.** It is not a separate source of readout records.
7. Preserve durable offline capture, delayed synchronization, automatic retry, receipt idempotency, and existing Bom calculation behavior.

## Current gaps relevant to this update

- The current dashboard does not create a first-class readout row at capture; it inspects a selected or most recently updated competitor.
- The result handler updates competitor state and selects that competitor when a response arrives. That means a late response to an older readout can displace a newer one.
- There is no complete per-readout history with original card payload and stable capture ordering.
- The current unknown-card state is a single pending object; it cannot represent multiple independent readouts.
- A known `OK` readout is not independently addressable for later correction after a result is associated with the wrong runner.
- The existing Firestore receipt is used for idempotent delivery. It is not currently an operator-facing history/correction model.

The earlier audit is in [READOUT_CAPTURE_ORDER_AUDIT.md](./READOUT_CAPTURE_ORDER_AUDIT.md); the broader current-view audit is in [READOUT_OVERVIEW_REDESIGN.md](./READOUT_OVERVIEW_REDESIGN.md).

## Readout history model

Create one durable readout record for each completed physical card read. The record is created on capture, before delivery, and is the authoritative UI object for Latest Readout and Readout History.

Required fields:

| Field | Meaning |
|---|---|
| `clientReadoutId` | Unique identity for this physical read. Generate once at capture; reuse unchanged for every retry/replay. A second physical read of the same SI card gets a new ID. |
| `captureSequence` | Strictly increasing order assigned at capture within the competition/readout stream. It is persisted and travels with the record through offline replay. |
| `capturedAt` | Client capture timestamp; informational and useful for display, but not a substitute for `captureSequence`. |
| `resultStatus` | Race result: `OK`, `MP`, `PRELIMINARY_FIN`, `DNF` or `DNS`. Unknown/unlinked/conflict are not result statuses. |
| `readoutState` | Capture, matching, validation and delivery state such as pending, unknown SI, unlinked, conflict or processed. |
| `issueType` | Human intervention required, such as `UNKNOWN_CARD`, `WRONG_COMPETITOR`, or an operator-created `MP_REVIEW`. |
| `linkedCompetitor` | Original matching result plus current linked competitor, kept separately so correction never erases original matching evidence. |
| `issueState` | `NONE`, `OPEN`, `IN_PROGRESS`, `RESOLVED` or `DISMISSED`, independent from `resultStatus`. |

The record also retains the original SI number/card series, station and times, complete original punch list/raw card data, validation/matching details, delivery state, and audit references. Store a result-status/matching snapshot so the historical row does not change meaning merely because the competitor's current document changes later.

Valid `resultStatus` values are `OK`, `MP`, `PRELIMINARY_FIN`, `DNF` and `DNS`. Unknown card, unlinked competitor, class conflict and duplicate assignment are readout states/issues, not result statuses. A readout may have no result status until a competitor is safely linked and processed.

Use the existing receipt ID as the readout identity where its constraints allow, but do not change receipt idempotency semantics. Evaluate whether the receipt can safely hold the required readout snapshot; otherwise use a staff-only readout record keyed by the same ID. Correction history may be stored as keyed audit metadata, but it must remain attached to and reopenable from the primary readout record.

### Identity and ordering

- Generate `clientReadoutId` exactly once per physical read at the serial callback. Use a collision-resistant ID and enforce local uniqueness; retain the ID through every direct delivery, queue replay and duplicate-receipt response.
- Assign `captureSequence` before starting asynchronous work. Persist it with the readout. Seed the next sequence from the durable history/queue at startup; use atomic allocation if multiple reader tabs share a competition.
- Sequence determines display order. `capturedAt`, `readoutAt`, Firestore write time, server processing order, selected competitor and response arrival order must never determine Latest Readout.

## Zone 1 — Latest Readout

Keep the latest readout panel driven by the record with the greatest `captureSequence`.

1. On capture, append the readout record and immediately set it as latest, initially displaying SI number and a provisional `Reading`/`Sync pending` state.
2. Use cached competition data for a provisional local match/validation where possible; distinguish this from server confirmation.
3. Display name/class if known, SI number, result status (when available), finish time, placing, Bom and synchronization state. Matching/issue details remain separate from result status.
4. When a delivery response arrives, update only the history record with the matching `clientReadoutId`. It may update Zone 1 only if that record is still the greatest captured sequence; an older record's response cannot move the latest pointer.
5. Never derive Zone 1 from `selectedRunnerId`, `readoutAt`, a mutable competitor document, or whichever response arrived last.

For out-of-order Firestore snapshots, associate each snapshot with the readout ID/sequence and merge it into that record. If competitor-level result fields are written by multiple readouts, prevent stale sequence updates from becoming the current competitor readout state; Zone 1 nevertheless remains sourced from the capture-ordered readout record.

## Zone 3 — Complete Readout History

- Create exactly one row on capture for every physical readout, including result statuses `OK`, `PRELIMINARY_FIN`, `MP`, `DNF`, `DNS`, and readout states unknown, unlinked, conflict and sync-pending.
- Key rows by `clientReadoutId`; update a row in place as local persistence, provisional matching, server confirmation, sync and correction states change.
- Show newest first by `captureSequence`. A delayed response can update its own row only.
- Every row is keyboard accessible, clickable and reopenable, regardless of outcome or issue state.
- Reopening restores the exact original readout details, original punches/raw data, original matching result, current corrected competitor (if any), current issue state and correction workflow.
- Offer visible window/page sizes 20/30/50. These values control how many recent rows are shown at once; they do not delete older readouts. Provide pagination/search or equivalent access to the full retained history.
- Preserve every record across app reload, sync completion, and issue resolution according to the agreed retention policy. Never remove a readout just because it is synced or has no issue.
- An `MP` result always appears in full history and remains reopenable; by default it has `issueState=NONE` and does not increase the Outstanding Issues count.

## Outstanding Issues: filtered history subset

Implement **Outstanding Issues** as a filter over the same readout records:

- Include records whose `issueState` is `OPEN` or `IN_PROGRESS`.
- Derive the outstanding counter from that filter.
- Keep the technical sync queue count separate; a sync failure is not automatically a human issue.
- Selecting an issue opens the same history record and correction view as selecting it from full history.
- Resolving/dismissing an issue removes it from the unresolved filter/counter, but the readout stays in full history and remains reopenable.
- Include `MP_REVIEW` only when an operator explicitly creates that issue for an `MP` readout; never create it automatically from `resultStatus=MP`.

Issue types:

- `UNKNOWN_CARD`
- `UNLINKED_COMPETITOR`
- `CLASS_CONFLICT`
- `DUPLICATE_ASSIGNMENT`
- `MANUAL_FINISH_REVIEW`
- `WRONG_COMPETITOR` (or `RESULT_REASSIGNMENT`)
- `MP_REVIEW` (optional; explicit operator-created issue only)

Result status and issue type are independent. `MP` with `issueState=NONE` is valid and does not count as outstanding. An operator may explicitly create `MP_REVIEW` when investigation is required; that readout then appears in Outstanding Issues. An `OK` readout initially matched to Anna can likewise receive `WRONG_COMPETITOR`.

## Correction workflow for successful readouts

Example: SI card 510123 is assigned to Anna. Erik ran with the card. The card validates successfully and is initially processed as Anna's `OK` result. Later, the operator learns that Erik was the runner.

1. Operator opens the `OK` row from full Readout History (or from the unresolved filter after flagging it).
2. The correction panel displays the original readout ID, capture sequence/time, SI number, full punches, original match to Anna, original validation, time, place and Bom.
3. Operator selects **Wrong competitor / Reassign result**, searches for and chooses Erik, and views a preview calculated against Erik's class/course and start time.
4. Record original matching result (Anna) and current/corrected linked competitor (Erik) as separate values. Keep the original payload and first outcome unchanged.
5. Treat correction of this historical result and reassignment of the card for future reads as separate actions. Do not change future SI-card ownership unless explicitly selected and authorized.
6. On save, perform an authorized, server-validated, idempotent update. Update the readout's current competitor link and any affected result/place/derived fields atomically as required by the existing result model. If the assignment is ambiguous or invalid, leave the issue open and explain the conflict.
7. Mark the issue resolved only after the correction succeeds. The row remains in full history, showing the corrected current link and a link to its audit trail.

The next SI card may be read at every step; opening, previewing, saving or deferring this correction must not block capture.

## Audit trail requirements

Keep an append-only correction history associated with the readout. Each entry must include:

- `clientReadoutId` and `captureSequence`.
- Actor UID/role and server-authoritative timestamp.
- Action and operator reason.
- Previous and new linked competitor IDs (and names/classes as snapshots where useful).
- Whether future SI-card assignment changed; previous/new SI assignment if it did.
- Correction result/transaction reference and any validation outcome.

Preserve the original readout payload, original match, original outcome and all prior correction entries. Do not overwrite or delete the original match to make a correction look as if it had been the initial result. Failed/conflicting correction attempts must not mark the issue resolved. Restrict raw card and audit data to authorized staff; do not expose it through public result projections.

## Data flow and offline/synchronization behavior

1. SPORTident completes and acknowledges the card; the listener synchronously creates ID, sequence and `capturedAt`, appends the history record, and updates Latest Readout.
2. Persist the original payload and ordering fields locally. Only report `Saved locally` after durable commit.
3. Independently show provisional matching/validation; do not write an inferred competitor update before authoritative validation.
4. Deliver the same readout ID and sequence through the existing queue/Firestore path. Wait for neither delivery nor correction in the hardware callback.
5. Merge direct, replay, retry and duplicate-receipt responses into history by ID. Every response includes the original ID/sequence, including unknown outcomes.
6. Keep automatic retry on reconnection. Successful sync removes only the delivery-pending state, not the history record or any open issue.
7. If local persistence fails, surface it; do not claim the readout is durable or start network delivery as a substitute. Keep the reader available for the next competitor and retain the payload in memory for recovery.

For duplicate receipt delivery, upsert the same history row and retain the same sequence. A later physical read of the same SI number creates a new row/new ID/higher sequence. This preserves current receipt idempotency and does not redesign the offline queue.

## Component changes

| File/module | Planned responsibility |
|---|---|
| `src/App.tsx` | Create readout records at capture, maintain latest/history by sequence/ID, pass record details and correction callbacks to the view, merge asynchronous response data only into its matching row. |
| `src/components/ReadoutDashboard.tsx` | Render Latest Readout, complete clickable history, and unresolved-only filtering over the same records. Separate selected historical record from the always-latest panel. |
| `src/services/offlineReadoutQueue.ts` | Preserve ID/sequence and return delivery context for each replay; continue owning technical retries only. |
| `src/firebase.ts` | Preserve receipt semantics; return ID-keyed outcomes; support validated corrections/reassignment and audit recording as needed. Protect current competitor fields from stale sequence updates where required. |
| `src/utils/readoutValidation.ts` | Reuse existing validation/Bom logic for previews and confirmed calculations; do not change the Bom formula in this work. |
| `src/components/EntriesRegistrationView.tsx` | Reuse unknown-card entry/link behavior from the inline correction panel without navigating away. |
| Firestore rules/types | Review and add minimal staff-only readout/correction access if needed. Keep raw readout and audit data out of public projections. |

## Implementation phases

### Phase 0 — Contract and safeguards

- Finalize ID/sequence scope, history retention/search and issue-state semantics. Confirm that MP review is opt-in and never automatically counted as an issue.
- Review receipt schema, rules, retention, SI assignment rules and result/Bom update dependencies.
- Define correction permissions and audit schema; distinguish historical result reassignment from future SI-card ownership changes.
- Add tests for reverse responses, duplicate receipt replay, same-SI repeated reads, multiple unknown/MP records and successful-result reassignment.

### Phase 1 — Capture identity and ordered records

- Assign one durable `clientReadoutId`, `captureSequence` and `capturedAt` at physical capture.
- Create one history record immediately, persist original payload and show it as latest before delivery.
- Pass ordering identity through queue and response paths.
- Verify that lower-sequence direct, replayed and Firestore results can update only their own rows.

### Phase 2 — Full history and correction UI

- Implement full searchable/paginated history and row restoration for all outcomes.
- Keep Latest Readout independent from a selected history row.
- Add inline correction entry points for unknown/unlinked/conflict cases and for any operator-selected successful result.
- Implement **Outstanding Issues** as a filter/counter over the history records.

### Phase 3 — Safe reassignment and audit

- Add `WRONG_COMPETITOR`/`RESULT_REASSIGNMENT`.
- Implement preview, authorization, idempotent server transaction, derived-result recalculation and append-only correction audit.
- Confirm that a corrected `OK` record remains in history, preserves original Anna match, shows Erik as current link, and leaves no open issue only after successful commit.

### Phase 4 — Pilot and rollout

- Test rapid readout traffic, offline/reconnect, delayed responses, duplicate delivery, multiple exceptions, `OK` reassignment and app reload.
- Reconcile physical reads, unique IDs/sequences, history rows, receipts, outstanding filter/count and audit events.
- Keep existing event/registration routes as fallback during pilot; retire duplicate correction entry points only after parity is verified.

## Acceptance criteria

- Every physical card read produces one durable, reopenable history record with the required fields.
- Latest Readout is selected only by greatest capture sequence; responses and Firestore updates cannot move it backward.
- All history rows reopen original details, punches, original matching and correction workflow, including `OK` and `PRELIMINARY_FIN`.
- An `MP` result appears in history and remains reopenable; `MP` with no explicitly created issue does not increase the Outstanding Issues counter.
- An operator can explicitly create `MP_REVIEW` for an `MP`; only then does the readout enter Outstanding Issues.
- Replaying a receipt updates one row; a repeated physical read creates a separate row.
- Outstanding Issues is a filter over history. Resolving a record removes it from the filter/count but never from history.
- An `OK` result can be reassigned from Anna to Erik with the original match retained, the current link corrected, derived results updated safely, and an append-only audit entry.
- Readout capture continues while any row is open, being reviewed, being corrected, or awaiting synchronization.
- Existing validation and Bom behavior remain compatible; public views do not receive raw readout/audit documents.
