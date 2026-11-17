# Readout Overview Implementation Plan — V3

Date: 2026-11-17

## Status and scope

V3 is the current authoritative product plan. It updates [READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V2.md](./READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V2.md) with the decision that `MP` is a result status and is not automatically an operator issue.

Planning only; no application code is changed.

## Product rules

1. **Read next card immediately.** No result, correction, sync delay, or unresolved issue may gate the next physical SI-card read.
2. **Every readout is a primary record.** Preserve and reopen every captured readout, including successful results.
3. **Every history row is clickable.** `OK`, `MP`, `PRELIMINARY_FIN`, `DNF`, `DNS`, and readouts with matching/sync problems can all reopen their original details and correction workflow.
4. **Separate result status from issue type.** A race result describes the competitor's result. An issue type describes human intervention needed. Neither determines technical sync state.
5. **Outstanding Issues is a filtered subset of Readout History.** It contains only readouts with an explicitly open human-intervention issue.
6. **MP is not automatically an issue.** `resultStatus=MP` and `issueState=NONE` is valid. An operator may explicitly create `MP_REVIEW` if investigation is warranted.
7. Preserve durable offline capture, delayed synchronization, automatic retry, receipt idempotency, and existing Bom calculation behavior.

## Result, readout and issue model

Each physical readout creates one durable history record at capture. Required fields:

| Field | Definition |
|---|---|
| `clientReadoutId` | Unique identity for one physical read. Generate once at capture and reuse for delivery/retries/replays. A second physical read gets a new ID. |
| `captureSequence` | Strictly increasing sequence assigned at capture within the competition/readout stream; persisted and reused on replay. |
| `capturedAt` | Capture timestamp for display/audit; not the source of ordering. |
| `resultStatus` | One of `OK`, `MP`, `PRELIMINARY_FIN`, `DNF`, `DNS`, or unset until a result can safely be assigned. |
| `readoutState` | Processing/matching state such as captured, unknown SI, unlinked, conflict, validation complete, or processed. |
| `linkedCompetitor` | Original matching result plus current/corrected linked competitor, kept separately. |
| `issueType` | The specific human-intervention issue, when one has been explicitly raised. |
| `issueState` | `NONE`, `OPEN`, `IN_PROGRESS`, `RESOLVED` or `DISMISSED`, independent from result status. |

### Result statuses

- `OK`
- `MP`
- `PRELIMINARY_FIN`
- `DNF`
- `DNS`

Unknown SI, unlinked competitor, class conflict, duplicate assignment and sync-pending are not result statuses. They belong to `readoutState`, technical delivery state, or an issue.

### Issue types

- `UNKNOWN_CARD`
- `UNLINKED_COMPETITOR`
- `CLASS_CONFLICT`
- `DUPLICATE_ASSIGNMENT`
- `MANUAL_FINISH_REVIEW`
- `WRONG_COMPETITOR` (or `RESULT_REASSIGNMENT`)
- `MP_REVIEW` — optional, created only by an explicit operator action for an MP result.

`MP` alone never sets an issue type, never changes `issueState` from `NONE`, and never increases the Outstanding Issues count. If an operator chooses **Review MP**, create `MP_REVIEW` and set `issueState=OPEN`; only then is it outstanding.

Keep the original SI number/card series, station/times, complete original punches/raw data, validation and original matching snapshot on the readout record. Preserve original and current competitor links separately. Keep delivery state separate from result and issue state.

## Zone 1 — Latest Readout

- Always show the readout with the greatest `captureSequence`.
- Create and display the record immediately at capture, before Firestore delivery or response.
- Initially show SI number and a provisional processing/sync state; use cached competition data for a provisional match/result where possible, clearly marked as provisional.
- Show competitor name/class if known, result status if assigned, finish time, placing, Bom, and separate sync state.
- Merge every async response by `clientReadoutId`. It may update that record's history data; it can affect Zone 1 only when it is still the greatest captured sequence.
- Never choose Latest Readout by response arrival, Firestore processing/write time, `readoutAt`, selected competitor, or current mutable competitor document.

Out-of-order Firestore updates must be associated with the relevant readout ID/sequence and merged into that record. If competitor-level result fields are updated by multiple readouts, prevent an older capture from overwriting newer current result fields. Zone 1 remains sourced from the capture-ordered readout record.

## Zone 3 — Complete Readout History

- Create exactly one row per physical readout at capture.
- Include all result statuses (`OK`, `MP`, `PRELIMINARY_FIN`, `DNF`, `DNS`) and all processing states (unknown, unlinked, conflict, sync pending).
- Key and update rows by `clientReadoutId`; order newest first by `captureSequence`.
- Make **every** row keyboard accessible, clickable and reopenable, regardless of result or issue state.
- Reopening restores the original readout details/punches, original matching result, current corrected competitor, result status, delivery state, issue state and correction workflow.
- Allow visible page/window sizes 20/30/50. This limits rows shown at once, not retained records; older history remains searchable/paginatable and is not deleted when synced or resolved.
- Preserve all records across reload, delivery completion and issue resolution according to the agreed retention policy.

An MP readout is always visible in full history and can always be reopened. The default is `resultStatus=MP`, `issueType` unset, `issueState=NONE`. It is not included in Outstanding Issues unless an operator explicitly creates `MP_REVIEW`.

## Outstanding Issues — filtered history

Outstanding Issues is a filtered view/counter derived from the same history records:

- Count only readouts with a human-intervention issue in `OPEN` or `IN_PROGRESS`.
- Do not count result statuses by themselves. In particular, MP with `issueState=NONE` is not outstanding.
- An explicitly created `MP_REVIEW` with an open issue state is outstanding.
- Keep technical sync failures and the offline-delivery queue count separate from human issues.
- Selecting an issue opens the same history record and correction workflow as selecting it from the full history.
- Resolving/dismissing the issue removes it from the unresolved filter/counter, but never removes the readout from full history.

An `OK` readout may later acquire `WRONG_COMPETITOR`; an `MP` readout may acquire `MP_REVIEW` only by explicit operator action. Issue creation does not rewrite the race result.

## Correction workflow, including successful readouts

Example: SI card 510123 is assigned to Anna. Erik ran with Anna's card. The card validates successfully and initially produces an `OK` result linked to Anna. The operator discovers the mistake later.

1. Open the `OK` readout from full history. All results, not just unresolved ones, can be opened.
2. Restore the original ID, sequence, timestamp, SI number, original punches, original match to Anna, original validation, time, place and Bom.
3. Choose **Wrong competitor / Reassign result**, select Erik, and preview validation/result/place/Bom consequences using Erik's class/course and start time.
4. Preserve Anna as the original match; store Erik as the corrected current link. Preserve the raw payload and original result snapshot.
5. Treat historical result reassignment and future SI-card ownership as separate operations. Change future card ownership only if explicitly selected and authorized.
6. Save through an authorized, server-validated, idempotent operation. Update the linked result and affected derived fields safely. Leave the issue open with a clear error if the correction is ambiguous or invalid.
7. Mark `WRONG_COMPETITOR` resolved only after success. Keep the readout clickable in full history, showing its corrected link and audit trail.

At every step, the operator can read the next SI card. The correction panel must not be modal, force navigation, or take control of the reader.

For MP, provide an optional **Create review issue** action. Until selected, retain `issueState=NONE` and do not increment the outstanding counter. If selected, create `MP_REVIEW`, preserve `resultStatus=MP`, and include the readout in the filtered issues view until resolved/dismissed.

## Audit trail

Keep append-only correction history associated with the readout. Each entry records:

- `clientReadoutId` and `captureSequence`.
- Actor UID/role and server-authoritative timestamp.
- Action and operator-provided reason.
- Previous and new linked competitor IDs (plus useful name/class snapshots).
- Whether future SI-card assignment changed and its previous/new value, if applicable.
- Correction transaction/result reference and validation outcome.

Never overwrite the original payload, original match or original result to make a correction appear initial. Preserve failed/conflicting attempts without marking the issue resolved. Restrict raw card and audit data to authorized staff; do not expose these records through public result projections.

## Capture, offline and synchronization flow

1. SPORTident completes and acknowledges the card. The listener synchronously creates ID, sequence and capture time, creates one history record, and makes it Latest Readout.
2. Persist the original payload and sequence locally; show `Saved locally` only after durable commit.
3. Show provisional matching/result independently of the server request; do not commit a competitor mutation based only on client inference.
4. Deliver the same ID and sequence through the existing offline queue/Firestore path without waiting in the hardware callback.
5. Merge direct/replay/retry/duplicate-receipt responses into the matching history row by ID. Unknown, MP and successful responses all retain their readout identity.
6. On reconnect, preserve automatic retry. Sync completion updates delivery state only; it does not delete the history row or resolve an issue.
7. If local persistence fails, surface the failure; do not claim the readout is durable or start network delivery as a substitute. Retain the payload for recovery while keeping the reader available for the next card.

Duplicate delivery of one readout reuses its ID/sequence and updates one history row. A new physical read—even of the same SI card—gets a new ID and higher sequence.

## Component changes

| File/module | Responsibility |
|---|---|
| `src/App.tsx` | Create the record at capture; own latest/history ordering; merge responses by ID; preserve current history selection separately from Latest Readout. |
| `src/components/ReadoutDashboard.tsx` | Render latest record, full clickable history, and unresolved-only filter/counter over the same records. |
| `src/services/offlineReadoutQueue.ts` | Preserve ID/sequence and delivery context across replay; continue to own technical retries only. |
| `src/firebase.ts` | Preserve receipt semantics; return ID-keyed outcomes; support validated corrections/reassignment and audit recording; guard against stale current-result updates if needed. |
| `src/utils/readoutValidation.ts` | Reuse existing validation and Bom calculations; do not alter Bom behavior. |
| `src/components/EntriesRegistrationView.tsx` | Reuse unknown-card linking inside the inline correction workflow without navigating away. |
| Firestore rules/types | Review and add minimal staff-only readout/correction access if needed. Keep raw records private from public projections. |

## Implementation phases

### Phase 0 — Contract

- Finalize ID/sequence allocation, retention/search and issue-state transitions.
- Confirm MP remains non-outstanding by default and `MP_REVIEW` requires an explicit operator action.
- Review receipt schema/rules, SI assignment rules, result/Bom update dependencies, and correction permissions.
- Define the append-only audit schema and separate historical reassignment from future SI-card ownership changes.

### Phase 1 — Capture identity and ordered history

- Assign one ID, capture sequence and capturedAt per physical read.
- Create/persist the readout record immediately and display it as latest before delivery.
- Pass ordering identity through queue/replay and all response types.
- Verify out-of-order direct, replayed and Firestore responses can update only their own rows.

### Phase 2 — Full history and issue filter

- Implement full searchable/paginated history and row restoration for all result statuses.
- Keep Latest Readout independent from a selected historical row.
- Derive the outstanding count/filter from readout records with open human issues.
- Add optional manual `MP_REVIEW`; verify ordinary MP remains `issueState=NONE`.

### Phase 3 — Corrections and audit

- Implement unknown/unlinked/conflict correction and `WRONG_COMPETITOR`/`RESULT_REASSIGNMENT`.
- Add the successful-readout reassignment preview and authorized idempotent transaction.
- Retain original matching, corrected current link and append-only audit; update derived results safely.

### Phase 4 — Pilot

- Test rapid reads, offline/reconnect, reverse response order, duplicate delivery, multiple unknown cards, multiple MPs and an `OK` reassignment.
- Reconcile physical reads, IDs/sequences, history rows, receipts, outstanding issues and audit records.
- Keep existing event/registration routes as fallback until parity is confirmed.

## Acceptance criteria

- Every physical SI-card readout has one durable, reopenable history row with ID, sequence, capture time, result status/readout state, linked competitor and issue state.
- `OK`, `MP`, `PRELIMINARY_FIN`, `DNF` and `DNS` rows are visible and reopenable.
- An MP result with `issueState=NONE` appears in history and does **not** increase Outstanding Issues.
- Explicitly creating `MP_REVIEW` for an MP preserves `resultStatus=MP` and makes that record count as outstanding until resolution/dismissal.
- Outstanding Issues is a filtered subset of history; resolving an issue removes it from the filter/count, never from history.
- A delayed response cannot move Latest Readout backward; rows are updated by ID and latest is determined only by capture sequence.
- Replaying a receipt updates one row; a new physical read creates a new row.
- Correcting an `OK` result from Anna to Erik preserves the original match, updates the current link/derived result safely, appends an audit record, and leaves the readout in history.
- Reading the next card remains possible while any readout is syncing, being reviewed or being corrected.
- Existing validation/Bom behavior is preserved and public views receive no raw readout/audit documents.
