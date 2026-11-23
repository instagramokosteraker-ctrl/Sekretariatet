# MP Review Capability Audit

## Executive summary

**Manual punch correction currently implemented? NO.**

“Skapa MP-granskningsärende” creates an open tracking flag on the locally
persisted readout-history record. It does not open a punch editor, call a
Firestore endpoint, or create a server-side MP-review record. After creation,
the button is hidden because the issue state is no longer `NONE`. No
MP-specific edit, revalidation, approval, or close action is exposed.

The expanded row displays the captured punch codes and times as text, not as
editable controls. Other workflows—especially event-wide recalculation and
competitor reassignment—are separate from MP review.

## MP-review workflow

1. The reader processes a card and produces an `OK` or `MP` result from the
   captured readout and course validation.
2. In the expanded timeline row, an operator can select **Skapa
   MP-granskningsärende** when the result is `MP` and the issue state is `NONE`
   ([ReadoutDashboard.tsx](./src/components/ReadoutDashboard.tsx#L1390)).
3. The callback verifies that the history record exists, still has result
   `MP`, and has no current issue. It updates that record to
   `issueType: MP_REVIEW` and `issueState: OPEN`
   ([App.tsx](./src/App.tsx#L1212)).
4. The record is saved in browser IndexedDB. If persistence fails, the callback
   attempts to restore its prior issue fields. Open issues appear in the
   **Kräver åtgärd** filter
   ([readoutHistoryStore.ts](./src/services/readoutHistoryStore.ts#L238)).
5. Once open, the create button is no longer shown. The MP-specific workflow
   ends at the tracking flag: no MP-review action to edit punches, revalidate
   this readout, approve it, or resolve/dismiss the issue was found.

The callback contains no API call. The issue fields live in
`ReadoutHistoryRecord` and are stored in the `readouts` object store of
`PasserSI_ReadoutHistoryDB`, keyed by `clientReadoutId`
([readoutHistoryStore.ts](./src/services/readoutHistoryStore.ts#L42),
[IndexedDB configuration](./src/services/readoutHistoryStore.ts#L163),
[persistence](./src/services/readoutHistoryStore.ts#L340)).

## Operator capability matrix

| Capability after creating MP review | Available? | Findings |
|---|---:|---|
| Add missing punches to this readout | **No** | The row only renders captured punches as text. No per-readout punch-add control or MP endpoint exists. Marking a course control as broken can waive that requirement during recalculation; it does not add a punch to the captured readout. |
| Edit punches on this readout | **No** | No editable punch list or per-readout punch mutation workflow was found. |
| Edit an individual punch time | **No** | Event-wide control-time offsets can adjust times for a control and trigger recalculation, but they are not an edit to one readout’s captured punch time. |
| Revalidate a result | **Not from MP review** | A separate event-wide recalculation revalidates stored readout data after course/emergency-setting changes. Competitor reassignment also recalculates a preview/result for the new competitor, using the existing receipt punches; neither is an MP-review action. |
| Convert MP directly to OK | **No** | The manual-approval workflow accepts only `PRELIMINARY_FIN`, not `MP`. Event-wide recalculation can produce `OK` if the revised validation conditions pass, but this is not an MP approval action. |

The displayed punch list is read-only
([ReadoutDashboard.tsx](./src/components/ReadoutDashboard.tsx#L1005)).
Reassignment recalculates using the receipt’s existing `punchCodes` and
`punchTimes`, then changes ownership and records an audit; it does not edit the
punches
([readoutReassignment.ts](./src/server/readoutReassignment.ts#L581),
[audit and receipt update](./src/server/readoutReassignment.ts#L769)).

## UI entry points and components

- **ReadoutTimeline / ReadoutDashboard:** The timeline expands the selected
  readout. `ReadoutDashboard` renders the MP-review creation button and
  read-only punch details
  ([button](./src/components/ReadoutDashboard.tsx#L1390),
  [punch list](./src/components/ReadoutDashboard.tsx#L1005)).
- **App callback:** Validates the MP result and local issue state, then updates
  local readout history ([App.tsx](./src/App.tsx#L1212)).
- **Draw & Emergency:** Provides separate control status/time-offset settings
  and event-wide recalculation. It is not a per-readout MP-review editor
  ([DrawAndEmergencyView.tsx](./src/components/DrawAndEmergencyView.tsx#L294)).
- **Manual result approval:** A separate form appears only when the linked
  competitor has `PRELIMINARY_FIN` and a finish time
  ([ReadoutDashboard.tsx](./src/components/ReadoutDashboard.tsx#L947)).

## Server endpoints

There is **no MP-review creation or punch-edit endpoint**. Related endpoints
serve other workflows:

- `POST /api/firestore/competitions/:competitionId/readouts/:receiptId/ingest`
  ingests a processed readout
  ([server.ts](./server.ts#L4398)).
- `POST /api/firestore/competitions/:competitionId/readouts/:readoutId/reassignment`
  reassigns the readout to another competitor
  ([server.ts](./server.ts#L4548)).
- `GET /api/firestore/competitions/:competitionId/readouts/:readoutId/corrections`
  returns reassignment audit history
  ([server.ts](./server.ts#L4514)).
- `POST /api/firestore/competitions/:competitionId/competitors/:competitorId/manual-result-approval`
  approves only a `PRELIMINARY_FIN` result as `OK`
  ([server.ts](./server.ts#L4472),
  [manualResultApproval.ts](./src/server/manualResultApproval.ts#L112)).
- `POST /api/emergency/recalculate-all` recalculates event results from archived
  readouts and current event settings; Firestore-backed UI also has a
  `recalculateCompetitionFromFirestore` path
  ([server.ts](./server.ts#L4197),
  [firebase.ts](./src/firebase.ts#L6083)).

## Firestore data structures

- **Readout receipt:** `competitions/{competitionId}/readoutReceipts/{receiptId}`.
  Ingestion stores the receipt status, original/current competitor IDs,
  card/readout metadata, `punchCodes`, `punchTimes`, and `rawHex`
  ([readoutIngestion.ts](./src/server/readoutIngestion.ts#L158),
  [receipt creation](./src/server/readoutIngestion.ts#L344)). The MP-review
  `issueType` and `issueState` are not written here.
- **Competitor result:** `competitions/{competitionId}/competitors/{competitorId}`
  stores the calculated status, times, and punch arrays. A public-results
  projection is also updated during ingestion/recalculation.
- **Reassignment audit:** `competitions/{competitionId}/readoutCorrections/{operationId}`
  records reassignment operations; it is not an MP-review record
  ([readoutReassignment.ts](./src/server/readoutReassignment.ts#L292)).
- **Manual approval audit:** competitor subcollections
  `manualResultApprovals/{operationId}` and `resultAudit/{operationId}` record
  the separate preliminary-finish approval
  ([manualResultApproval.ts](./src/server/manualResultApproval.ts#L67)).
- **MP review:** no Firestore collection/document or server-side issue state
  was found. Its current state is local IndexedDB only.

## Explicit answer

**Is manual punch correction currently implemented? NO.** MP review currently
marks a readout for attention; it does not provide a way to add, edit, or
retime punches.
