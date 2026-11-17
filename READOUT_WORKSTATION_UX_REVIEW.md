# Readout Workstation UX Review

Date: 2026-11-17

## Review basis

Reviewed [READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V4.md](./READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V4.md), [READOUT_OVERVIEW_PHASE1_IMPLEMENTATION.md](./READOUT_OVERVIEW_PHASE1_IMPLEMENTATION.md), [READOUT_OVERVIEW_PHASE2_IMPLEMENTATION.md](./READOUT_OVERVIEW_PHASE2_IMPLEMENTATION.md), and the current [ReadoutDashboard.tsx](./src/components/ReadoutDashboard.tsx) and [App.tsx](./src/App.tsx) flows.

The workflow below is a code-based operator walkthrough, not a live test with a SPORTident station.

## Simulated finish-line workflow

1. **Start the workstation.** The operator sees the station controls, an offline/sync banner, and—if the queue has items—the full retry queue before the competition KPIs, Latest Readout, and History. A long queue can push the primary readout view well below the fold.
2. **Read a known card.** Capture creates a row and advances Latest Readout by sequence. Before matching finishes, the operator mainly sees the SI number and capture/sync state. Once the response arrives, the competitor, class, result, finish time, and running time are shown.
3. **Read the next card immediately.** The latest panel advances to the newer capture while the earlier response updates its own row. This is a strong part of the current interaction: the selected history record does not become Latest Readout.
4. **Handle an unknown card.** The result appears in History as an unknown card and becomes an open issue. To act, the operator selects Outstanding Issues, expands the row, and clicks **Anmäl**. That action navigates to Entries, away from the finish-line workstation.
5. **Review an MP.** MP remains out of Outstanding Issues by default. To create an `MP_REVIEW`, the operator returns to All, finds and expands the MP row, then selects the review action. It is explicit, but not immediately discoverable from the collapsed row.
6. **Find an earlier readout.** The operator searches or pages through the active competition’s history, then expands the matching row to review its original punches, result/match snapshots, and issue state. Search is useful for SI number, competitor name, sequence, ID, result status, and issue type, but not class or station.

## Findings

### Must fix before Phase 3

#### M1 — The primary readout and issue work are below variable-height utility content

The offline queue and all of its retry-item details render before the KPI strip and Latest Readout. With a busy/offline event, this list can become long and push the latest card and its operator action out of the initial viewport. Latest Readout and History are then shown as equal side-by-side panels, while Outstanding Issues is only a toggle inside the History panel; there is no dedicated action area as described in V4.

**Risk:** The operator must scroll past queue/competition administration to confirm the most recent card or find an exception. Queue volume can obscure the next-card workflow.

**Recommendation:** Put the station status and a compact Latest Readout immediately first. Keep queue details collapsed behind a summary when not actively being managed. Give open issues a dedicated, compact action area directly beside/below Latest Readout, with History remaining the complete archive.

#### M2 — Unknown-card handling leaves the finish-line workstation

The unknown-card **Anmäl** action calls the App handler that switches to the Entries tab. The operator loses the readout workstation and its issue/history context to complete an existing linking workflow.

**Risk:** This is a high-frequency exception path that competes with reading the next card and conflicts with V4’s non-modal, non-navigation correction model.

**Recommendation:** Before adding the broader Phase 3 correction set, make unknown-card linking available in a non-modal, inline issue panel keyed to the selected `clientReadoutId`. Keep the reader ready and retain the record context after save or defer.

#### M3 — Expanded readout details are attached to a paginated row

The selected readout’s details render inside its list item. If the operator changes page/filter, or rapid captures push the selected row onto another page, the detail/action context is no longer visible even though the selected ID remains in component state.

**Risk:** A correction or review started in Phase 3 could disappear while new cards arrive, creating uncertainty about which readout is being handled.

**Recommendation:** Separate the focused-readout detail/action panel from the paginated list. Keep it anchored to `clientReadoutId` while the list continues to reorder and the Latest Readout advances independently.

#### M4 — Latest Readout omits key decision information in the V4 contract

The latest panel shows finish time and, when available, running time, but not placing, Bom, or an MP explanation. Before matching completes it does not show a provisional competitor match even when cached data could provide one.

**Risk:** The operator cannot quickly verify the result or understand why an MP needs attention from the primary panel; they must open another view or wait for deeper review.

**Recommendation:** Show the available V4 summary fields—competitor/class, result, finish time, place, Bom, and a concise MP reason—with provisional values explicitly marked. Keep delivery state visually separate from result state.

### Nice to have

#### N1 — Search omits common operator lookup fields

The current search covers SI number, readout ID/sequence, current/original competitor name, result status, and issue type. Class, station, club, delivery state, and readout state are not searchable.

**Recommendation:** Add class and station at minimum, then include delivery/readout state if operators use them to diagnose a missing or delayed result. Keep the search applied within either History or Outstanding Issues.

#### N2 — The interface mixes Swedish and English status labels

Examples include **Outstanding Issues**, **Unknown card**, **Captured**, and **Synced** alongside Swedish controls and result details. This makes the distinction between result, issue, and delivery state harder to scan consistently.

**Recommendation:** Localize labels consistently and use distinct visual labels for result status, human issue state, and technical delivery state.

#### N3 — MP review requires opening the row before the explicit action is visible

The review action is correctly explicit and MP is not auto-counted, but the action is only shown after expanding the row.

**Recommendation:** Consider a clearly labeled row-level **Skapa granskningsärende** action for MP, with confirmation or accessible context sufficient to avoid accidental issue creation.

### Future enhancement

#### F1 — Add scanner-safe keyboard navigation for repeated review

History rows are keyboard-operable buttons, but the repeated workflow of selecting a row, opening its details, and moving to the next issue has no dedicated navigation model.

**Recommendation:** After the inline action panel is established, consider documented keyboard navigation between issues and history rows. Do not intercept keyboard-wedge scanner input.

#### F2 — Persist useful history-view preferences

Search, page size, selected filter, and page position are component-local state and are not preserved when leaving the readout page.

**Recommendation:** Consider restoring the operator’s last useful filter/page-size preference per workstation, while clearing stale search text when the active competition changes.

## Phase 3 readiness

Before adding correction controls, prioritize M1–M4 so the operator can keep Latest Readout visible, find an issue without leaving the workstation, and maintain a stable selected-readout context while newer cards arrive. The existing sequence ordering, separate MP issue creation, and searchable/paginated archive are good foundations; the main remaining risk is how much scrolling and navigation the operator must do around them.
