# Readout OK Row Gap Analysis

## Decision

The reported row-reopen gap belongs to **Phase 2 — Full history and issue filter**, not Phase 3. V5 requires every readout row, including `OK`, to be keyboard-accessible, clickable and reopenable (product rules and Phase 2, especially the history requirements and acceptance criteria in [READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V5.md](./READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V5.md)).

The current source already has a selection button and a detail panel that are not conditional on result status. The most direct implementation gap visible in source is narrower: the green row background extends beyond the button's hit area, so clicking the padded row surface does nothing. If an operator clicks the button's text/content and still cannot open an `OK` readout, that behavior is not explained by the checked source; the current implementation has no `OK` exclusion. Confirm the running bundle/version and reproduce against the button before attributing that symptom to another code path.

The ability to **create and execute** `WRONG_COMPETITOR` / `RESULT_REASSIGNMENT` corrections is separately and explicitly deferred to Phase 3. It is not a prerequisite for reopening an `OK` readout to inspect it.

## Why the green row can appear not clickable

In [src/components/ReadoutDashboard.tsx](./src/components/ReadoutDashboard.tsx), the history list maps every `visibleReadouts` record into a colored `<li>`. The status color is applied to that `<li>`, but the click handler is attached only to an inner `<button>`. The `<li>` has its own horizontal and vertical padding, and the button does not fill that outer padded area. Consequently, the visible colored row is larger than its interactive target: clicks on the exposed row background/padding do not select it.

For clicks that land on the button, the handler calls `handleSelectReadout(record)`. It selects the record by `clientReadoutId`; `selectedReadout` is then looked up from history and its details panel is rendered without checking `resultStatus` or `issueState`. The same path handles `OK`, `MP`, and other statuses. Clicking the already-selected button toggles the panel closed; it does not prevent the initial selection.

Thus, the code does **not** show a missing `OK`-specific handler or condition. The gap is that the full visible row is not a full-row click target, despite the V5 contract and the Phase 2 report's claim that every row has a button.

## Files and elements involved

| File | Current responsibility / gap |
|---|---|
| [src/components/ReadoutDashboard.tsx](./src/components/ReadoutDashboard.tsx) | Renders status-colored history rows and their selection button; owns `handleSelectReadout` and the selected-readout details. The outer `<li>` has no click handler, and the inner button does not cover the whole colored row. The selected panel shows original/current match and result, delivery/issue state, and captured readout details/punches. Its only result-specific issue action is **Skapa MP-granskningsärende** for MP. There is no `OK` **Fel löpare** / reassignment action. |
| [src/App.tsx](./src/App.tsx) | Supplies the history and `onCreateMpReviewIssue` callback. That callback creates `MP_REVIEW`; there is no corresponding `WRONG_COMPETITOR` or `RESULT_REASSIGNMENT` correction callback. |
| [src/services/readoutHistoryStore.ts](./src/services/readoutHistoryStore.ts) | Stores the original/current match and readout data and includes `WRONG_COMPETITOR` in the issue-type union. A type entry is not a correction workflow: this store does not itself implement a reassignment transaction or audit trail. |
| [READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V5.md](./READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V5.md) | Defines all-row reopenability as a Phase 2 requirement; assigns the correction/reassignment workflow to Phase 3. |
| [READOUT_OVERVIEW_PHASE2_IMPLEMENTATION.md](./READOUT_OVERVIEW_PHASE2_IMPLEMENTATION.md) | Reports a button for every row and restoration of captured details. Source agrees for clicks on the button, but does not make the entire colored row a hit target. |
| [READOUT_OVERVIEW_PHASE2_5_IMPLEMENTATION.md](./READOUT_OVERVIEW_PHASE2_5_IMPLEMENTATION.md) and [READOUT_OVERVIEW_V5_IMPLEMENTATION.md](./READOUT_OVERVIEW_V5_IMPLEMENTATION.md) | Describe the detached selected-readout panel and explicitly state that correction/reassignment workflows were not implemented. |

## UI and handler gaps

- **Missing for full-row reopenability:** an interactive hit target covering the complete colored row, including its padding. The current row's button handler exists and works for any record selected through that button.
- **Not missing:** the `OK` detail view. The selected-readout panel is status-independent and displays the saved original/current context and readout punches.
- **Missing, but Phase 3 scope:** an `OK`-specific **Fel löpare** / reassignment entry point, candidate selection and preview, authorized save/validation, and correction audit. The current source has no such action or handler.

## Minimum implementation to reopen an OK readout

Without implementing reassignment, Phase 2 needs only to make the existing selection path reliably available across the whole row:

1. Make the row's accessible selection button fill the complete visible row surface (including current padding), or attach equivalent keyboard-accessible activation to the row without nesting buttons. Keep the existing **Anmäl** button as a separate action.
2. Keep selection keyed by `clientReadoutId` and leave the selected detail panel independent of status and issue state. No result or issue mutation is needed to open an `OK` record.
3. Add a focused regression test with an `OK` history record: activating its row opens the selected panel and exposes original match/result details and captured punches. Verify that clicks on the padded row surface are included in the interactive target.

Do not add correction transactions, change a competitor link, resolve/create `WRONG_COMPETITOR`, update derived results, or write correction audit records for this minimum. Those belong to Phase 3. The operator can reopen and inspect the `OK` readout now; support for acting on a suspected wrong competitor must wait for that workflow.
