# Phase 3 UI availability: wrong competitor / result reassignment

> Status eligibility has since been expanded. This is the original availability
> readout; see [WRONG_COMPETITOR_STATUS_EXPANSION.md](./WRONG_COMPETITOR_STATUS_EXPANSION.md)
> for the current supported statuses and updated UI conditions.

## Finding

**B. Implemented but hidden behind conditions.**

The operator action is **Fel löpare**, and it is an actual UI workflow: it opens
an issue on an eligible readout, then presents a target-runner form and submits
a result reassignment. It is not a permanent/global button. It only appears in
the detail panel after the operator selects a qualifying historical readout.

`WRONG_COMPETITOR` is the implemented issue type. There is no
`RESULT_REASSIGNMENT` identifier in the application source: reassignment is
the correction operation performed from the `WRONG_COMPETITOR` issue. The
correction is therefore not backend-only and is not absent, but its UI access
depends on the readout, issue, tab, and authorization conditions below.

## UI actions and locations

| Action | Component / function | What it does |
| --- | --- | --- |
| **Fel löpare** | `ReadoutDashboard`, selected-readout detail panel; action condition and button at `src/components/ReadoutDashboard.tsx:1225-1248` | If no issue exists, calls `handleCreateWrongCompetitorIssue`; for an open `WRONG_COMPETITOR` issue, the correction form is shown (and selecting that row opens it automatically). |
| Create the issue | `App.tsx`, `createWrongCompetitorIssue` at `src/App.tsx:1220-1250` | Accepts only an uncorrected `OK` readout whose issue state is `NONE`, then sets `issueType: 'WRONG_COMPETITOR'` and `issueState: 'OPEN'`. |
| **Bekräfta korrigering** | `ReadoutDashboard`, same detail panel; form at `src/components/ReadoutDashboard.tsx:1250-1355`; submit handler `handleApplyResultReassignment` at `src/components/ReadoutDashboard.tsx:649-683` | Submits the selected target and reason through `onApplyResultReassignment`. The App handler posts to the reassignment API at `src/App.tsx:1285-1351`. |
| Apply correction | `POST /api/firestore/competitions/:competitionId/readouts/:readoutId/reassignment`, route in `server.ts:4504-4528`; transaction in `src/server/readoutReassignment.ts:241-558` | Validates the actor and source/target data, updates result ownership atomically, and records an audit. |

The readout history is selected by clicking its row: `ReadoutHistoryRow` calls
`onSelect(record)` at `src/components/ReadoutHistoryRow.tsx:32-38`; the dashboard
uses `handleSelectReadout` at `src/components/ReadoutDashboard.tsx:521-545` to
show its detail panel.

## Exact visibility and eligibility conditions

### Tab / component

- The readout tab is allowed in role modes `ALL`, `READOUT`, `FOREST`, and
  `SPEAKER` (`ROLE_ALLOWED_TABS` in `src/App.tsx:243-261`). The navigation is
  filtered through this list at `src/App.tsx:3051-3052`, and the dashboard is
  rendered when `activeTab === 'readout'` at `src/App.tsx:4299-4317`.
- Within the dashboard, the action is rendered only for the **selected**
  history item, and only when all of these are true
  (`src/components/ReadoutDashboard.tsx:1225-1230`):
  1. `selectedReadout.resultStatus === 'OK'`.
  2. `selectedReadout.correctionOperationId` is empty.
  3. Either `issueState === 'NONE'`, or `issueType === 'WRONG_COMPETITOR'`
     **and** `issueState === 'OPEN'`.
- Consequently it is not shown for an unselected row, a non-`OK` result, an
  already-corrected record, an `IN_PROGRESS`/`RESOLVED`/`DISMISSED` issue, or
  an open issue of another type. The “Fel löpare” label is not a top-level
  navigation action.
- **Skapa MP-granskningsärende** is a separate action for an `MP` readout; it
  does not expose reassignment. Its UI condition is
  `selectedReadout.resultStatus === 'MP'` and `issueState === 'NONE'`
  (`src/components/ReadoutDashboard.tsx:1604`).

### Issue creation

- Initial creation requires `resultStatus === 'OK'`,
  `correctionOperationId` absent, and `issueState === 'NONE'` in the UI and is
  rechecked in `createWrongCompetitorIssue` (`src/App.tsx:1220-1249`).
- Creation sets the issue to `WRONG_COMPETITOR` / `OPEN`. Selecting an already
  open `WRONG_COMPETITOR` item automatically opens the correction form;
  cancelling the form leaves the issue open and the **Fel löpare** button can
  reopen it without creating a second issue
  (`src/components/ReadoutDashboard.tsx:521-545,1232-1248`).
- There is no separate `RESULT_REASSIGNMENT` issue state/type that an operator
  must create.

### Reassignment form and data

- A different competitor must be selected. The selector excludes the original
  competitor (`src/components/ReadoutDashboard.tsx:1260-1281`).
- A nonblank reason of at least 3 trimmed characters is required by the
  client; the API accepts 3-500 characters (`src/components/ReadoutDashboard.tsx:1282-1295`,
  `src/server/readoutReassignment.ts:249-267`).
- The preview and enabled confirmation button also require a valid target and
  valid preview (`src/components/ReadoutDashboard.tsx:287-321,1343-1355`).
- Preview accepts target statuses `REGISTERED`, `CHECKED`, or `IN_FOREST`; the
  target must differ from and exist alongside the original competitor, and
  must not already have finish/readout/punch data
  (`src/utils/readoutReassignment.ts:20-89`).
- A valid readout finish time and competition zero time are required to
  calculate a preview. The preview validates the punches/course and calculates
  the target result status, time, Bom, and placing
  (`src/utils/readoutReassignment.ts:59-115`).
- The server independently requires a matching `PROCESSED` receipt, an
  existing original competitor still in `OK` status, no manual-finish source,
  exactly one processed receipt for the source, no processed receipt for the
  target, and no prior applied reassignment for this readout
  (`src/server/readoutReassignment.ts:337-405`). It also rechecks target
  status/readout data and receipt timing/punch validity
  (`src/server/readoutReassignment.ts:416-470`).

### Required role

- The API route allows an admin session or an official with role `READOUT` or
  `FOREST` (`server.ts:4504-4517`).
- The transaction then authorizes `SUPER_ADMIN`, a `RACE_ADMIN` who owns the
  competition, or an assigned `READOUT`/`FOREST` official
  (`src/server/readoutReassignment.ts:299-317`).
- **Visibility and authorization do not fully align:** `SPEAKER` is allowed
  to open the readout tab, so the UI can display the action for an otherwise
  eligible record, but a Speaker-only official is rejected by the reassignment
  endpoint. Thus “visible” does not guarantee that the operator can complete
  the correction. `READOUT`/`FOREST` officials and authorized admins are the
  intended roles.

## Expected operator flow

1. Open **Mål & Avläsning** / the readout tab.
2. Select the historical readout row whose current result is `OK`.
3. In the detail panel, click **Fel löpare**. This creates the open issue and
   opens the correction form. If a `WRONG_COMPETITOR` issue is already open,
   selecting that row opens the correction form directly.
4. Choose a different eligible competitor, enter at least three characters of
   explanation, and review the preview.
5. Click **Bekräfta korrigering**. On success, the reassignment API updates the
   result and the history item is marked resolved with correction/audit data
   (`src/App.tsx:1285-1351`).

## Availability conclusion

The observed missing label is consistent with the implementation if no
qualifying readout is selected, or if the selected readout fails any visibility
condition above. Operators cannot trigger this from the overview or an
unselected row. For an eligible selected `OK` readout, the UI action exists;
the most notable reachability caveat is that Speaker-only sessions can see it
but cannot pass server authorization.
