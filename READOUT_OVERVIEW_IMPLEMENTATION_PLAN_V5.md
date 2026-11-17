# Readout Overview Implementation Plan — V5

Date: 2026-11-17

## Status and scope

V5 is the current authoritative product plan. It carries forward [READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V4.md](./READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V4.md) and adds the decision that the Competition Overview KPI panel belongs **below the complete Readout History section**. The finish-line workstation priority is Latest Readout, Outstanding Issues/actions, Readout History, then Competition Overview.

Planning only; no application code is changed by this plan update.

## Product rules

1. **Read next card immediately.** No result, correction, sync delay, or unresolved issue may gate the next physical SI-card read.
2. **Every readout is a primary record.** Preserve and reopen every captured readout, including successful results.
3. **Every history row is clickable.** `OK`, `MP`, `PRELIMINARY_FIN`, `DNF`, `DNS`, and readouts with matching/sync problems can all reopen their original details and correction workflow.
4. **Separate result status from issue type.** A race result describes the competitor's result. An issue type describes human intervention needed. Neither determines technical sync state.
5. **Outstanding Issues is a filtered subset of Readout History.** It contains only readouts with an explicitly open human-intervention issue.
6. **MP is not automatically an issue.** `resultStatus=MP` and `issueState=NONE` is valid. An operator may explicitly create `MP_REVIEW` if investigation is warranted.
7. Preserve durable offline capture, delayed synchronization, automatic retry, receipt idempotency, and existing Bom calculation behavior.
8. **Keep diagnostics off the finish-line workstation.** Move the existing SPORTident Hårdvarutestbänk without removing or reducing its functionality.
9. **Keep the operational information ahead of overview metrics.** Order the workstation as Latest Readout, Outstanding Issues/actions, Readout History, then Competition Overview. Keep every current KPI and action intact.

## Workstation layout

### Avläsning och översikt — finish-line workstation

Use this top-to-bottom order:

```text
Avläsning och översikt
┌─────────────────────────────────────────────┐
│ 1. Latest Readout                           │
│    Newest captured readout; result + sync   │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ 2. Outstanding Issues / operator actions    │
│    Open/in-progress issues; non-blocking     │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ 3. Readout History                          │
│    Complete, searchable, reopenable history │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ 4. Competition Overview — KPI panel         │
│    Anmälda · I mål · Kvar i skogen          │
│    Felstämplade · Hyrbrickor                │
└─────────────────────────────────────────────┘
```

The Competition Overview is useful context but is secondary to finish-line readout work. Move the **entire existing KPI panel below the entire Readout History section**, including its search/filter controls, rows, pagination, and any associated selected-readout detail. Do not place any KPI tile above Latest Readout, Outstanding Issues/actions, or Readout History.

Keep all current KPI values and semantics:

- **Anmälda deltagare** — total registered competitors.
- **I mål** — existing finished/approved count and preliminary count display.
- **Kvar i skogen** — current in-forest count.
- **Säkerhetslista** — keep the existing action available from the Kvar i skogen KPI.
- **Felstämplade** — current MP count.
- **Hyrbrickor** — keep the current unreturned rental-card count.

The panel may retain its existing tile grouping and calculations; this is a placement change, not a metric or behavior change. Keep the primary readout and issue actions available while the operator reads the next card.

The SPORTident Hårdvarutestbänk is not displayed on this page. Its absence must not remove or alter the reader connection, operating mode, station beep, status, or other controls required for normal live readout. Keep those operational controls available in their appropriate location; move the testbench itself as specified below.

### Sportident, ROC och USB — setup/troubleshooting

Keep all current SPORTident Hårdvarutestbänk scenarios, controls, outputs and behavior. Relocate the testbench to the **bottom of the Sportident, ROC och USB page**, inside a collapsed-by-default section labeled **Diagnostik och verktyg**. The section must be explicitly collapsible/expandable and identified as diagnostics/tools, so it remains discoverable without competing with routine finish-line work.

This is a layout/ownership change only: preserve the testbench's existing functionality and do not make access to it a prerequisite for connecting or using the reader.

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

## Zone 2 — Outstanding Issues and operator actions

- Place open/in-progress human-intervention work after Latest Readout and before the complete history surface in the workstation hierarchy.
- Derive the issue count and items from the same Readout History records; this is not a second source of truth.
- Keep actions non-blocking so the next physical SI card can be read while an issue is open or being handled.
- Selecting an issue opens the same `clientReadoutId`-keyed record and correction/review context as selecting it from full history.
- Keep technical sync failures and the offline-delivery queue count separate from human issues.

## Zone 3 — Complete Readout History

- Create exactly one row per physical readout at capture.
- Include all result statuses (`OK`, `MP`, `PRELIMINARY_FIN`, `DNF`, `DNS`) and all processing states (unknown, unlinked, conflict, sync pending).
- Key and update rows by `clientReadoutId`; order newest first by `captureSequence`.
- Make **every** row keyboard accessible, clickable and reopenable, regardless of result or issue state.
- Reopening restores the original readout details/punches, original matching result, current corrected competitor, result status, delivery state, issue state and correction workflow.
- Allow visible page/window sizes 20/30/50. This limits rows shown at once, not retained records; older history remains searchable/paginatable and is not deleted when synced or resolved.
- Preserve all records across reload, delivery completion and issue resolution according to the agreed retention policy.

An MP readout is always visible in full history and can always be reopened. The default is `resultStatus=MP`, `issueType` unset, `issueState=NONE`. It is not included in Outstanding Issues unless an operator explicitly creates `MP_REVIEW`.

## Zone 4 — Competition Overview KPI panel

Render the existing overview panel **after Zone 3**, below the complete Readout History section. Keep every KPI, label, count calculation, and action currently present:

- Registered participants.
- Finish count, including the existing preliminary count display.
- Competitors remaining in the forest, with **Säkerhetslista**.
- MP/felstämplade count.
- Unreturned rental cards.

Do not delete, recalculate, or move an individual KPI elsewhere as part of this layout change. Keep this panel below history on all supported viewport sizes; it must not precede or interrupt the readout workflow.

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

| File/module or page area | Responsibility |
|---|---|
| `src/App.tsx` | Create the record at capture; own latest/history ordering; merge responses by ID; preserve current history selection separately from Latest Readout. Keep readout capture independent from hardware diagnostics UI. |
| `src/components/ReadoutDashboard.tsx` | Render the finish-line workstation in V5 order: latest record, Outstanding Issues/actions, full clickable history, and the unchanged Competition Overview KPI panel below history. Do not render SPORTident Hårdvarutestbänk here. |
| **Competition Overview KPI panel** | Retain all current counts and the **Säkerhetslista** action; render the complete panel below Readout History without changing calculations. |
| **Sportident, ROC och USB page** | Own setup and troubleshooting controls, including the relocated testbench section at the bottom of the page. |
| **SPORTident Hårdvarutestbänk** | Preserve existing test scenarios, controls and outputs; render inside a collapsed-by-default **Diagnostik och verktyg** section on the Sportident, ROC och USB page. This is placement only, not a feature reduction. |
| `src/services/offlineReadoutQueue.ts` | Preserve ID/sequence and delivery context across replay; continue to own technical retries only. |
| `src/firebase.ts` | Preserve receipt semantics; return ID-keyed outcomes; support validated corrections/reassignment and audit recording; guard against stale current-result updates if needed. |
| `src/utils/readoutValidation.ts` | Reuse existing validation and Bom calculations; do not alter Bom behavior. |
| `src/components/EntriesRegistrationView.tsx` | Reuse unknown-card linking inside the inline correction workflow without navigating away. |
| Firestore rules/types | Review and add minimal staff-only readout/correction access if needed. Keep raw records private from public projections. |

## Implementation phases

### Phase 0 — Contract and workstation boundaries

- Finalize ID/sequence allocation, retention/search and issue-state transitions.
- Confirm MP remains non-outstanding by default and `MP_REVIEW` requires an explicit operator action.
- Review receipt schema/rules, SI assignment rules, result/Bom update dependencies, and correction permissions.
- Define the append-only audit schema and separate historical reassignment from future SI-card ownership changes.
- Confirm the page responsibilities and V5 order: Latest Readout → Outstanding Issues/actions → Readout History → Competition Overview.
- Confirm all existing KPI names, values, grouping, calculations, and **Säkerhetslista** behavior are preserved.
- Specify the testbench destination, bottom-of-page placement, collapsed-by-default behavior, **Diagnostik och verktyg** label, and a parity checklist for its existing functionality and adjacent reader controls.

### Phase 1 — Workstation separation and capture identity

- Move SPORTident Hårdvarutestbänk out of Avläsning och översikt and into the bottom of Sportident, ROC och USB, inside the collapsible **Diagnostik och verktyg** section.
- Preserve and verify all current testbench scenarios, controls and outputs. Ensure the section is discoverable and its initial collapsed state does not interfere with ordinary reader setup/use.
- Arrange the Avläsning och översikt workstation as Latest Readout, Outstanding Issues/actions, Readout History, then the complete Competition Overview KPI panel.
- Move the entire KPI panel below the complete Readout History section; preserve every count, existing grouping, and **Säkerhetslista** action without changing calculations.
- Assign one ID, capture sequence and capturedAt per physical read.
- Create/persist the readout record immediately and display it as latest before delivery.
- Pass ordering identity through queue/replay and all response types.
- Verify out-of-order direct, replayed and Firestore responses can update only their own rows.

### Phase 2 — Full history and issue filter

- Implement full searchable/paginated history and row restoration for all result statuses.
- Keep Latest Readout independent from a selected historical row.
- Derive the outstanding count/filter from readout records with open human issues; keep issue actions ahead of the complete history surface.
- Add optional manual `MP_REVIEW`; verify ordinary MP remains `issueState=NONE`.
- Verify that the Competition Overview remains below all history controls and rows on the page and that the KPI values and **Säkerhetslista** remain available.

### Phase 3 — Corrections and audit

- Implement unknown/unlinked/conflict correction and `WRONG_COMPETITOR`/`RESULT_REASSIGNMENT`.
- Add the successful-readout reassignment preview and authorized idempotent transaction.
- Retain original matching, corrected current link and append-only audit; update derived results safely.
- Keep the V5 workstation ordering and do not move the KPI panel above readout or issue work.

### Phase 4 — Pilot

- Test rapid reads, offline/reconnect, reverse response order, duplicate delivery, multiple unknown cards, multiple MPs and an `OK` reassignment.
- Reconcile physical reads, IDs/sequences, history rows, receipts, outstanding issues and audit records.
- Verify the testbench remains fully functional at its new location and that the readout workstation no longer contains it.
- Verify the KPI panel appears below the complete history, all values remain correct, and **Säkerhetslista** still opens the safety view.
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
- **The workstation sections appear in this order:** Latest Readout; Outstanding Issues/actions; Readout History; Competition Overview.
- The entire Competition Overview KPI panel is below the complete Readout History section on supported viewport sizes; no KPI appears ahead of operational readout information.
- All current KPI values and calculations remain unchanged, including registered participants, finish/preliminary counts, in-forest count, MP count, and unreturned rental-card count.
- **Säkerhetslista** remains available from the Kvar i skogen KPI and continues to open the existing safety view.
- SPORTident Hårdvarutestbänk is absent from Avläsning och översikt and is located at the bottom of Sportident, ROC och USB inside a collapsible section labeled **Diagnostik och verktyg**.
- All SPORTident Hårdvarutestbänk functionality remains available after relocation; the move does not block normal reader connection or use.
