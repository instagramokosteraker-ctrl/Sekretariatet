# Automatic CHECKED to IN_FOREST status design

## Implementation status

Implemented. The completed-event policy is to use stored status only. See [`AUTOMATIC_IN_FOREST_STATUS_IMPLEMENTATION.md`](./AUTOMATIC_IN_FOREST_STATUS_IMPLEMENTATION.md) for implementation details and validation.

## Objective

Remove the need for an operator to manually mark a checked competitor as started when their allocated start time arrives. Keep the existing stored status values and status-writing behavior intact.

## Recommendation

Implement `IN_FOREST` as a **computed effective status**, not as a timer-driven Firestore update.

Keep the Firestore `status` as the source status. At the view-model boundary, derive an `effectiveStatus` for display, filtering, counts, and ranking:

```text
if stored status is not CHECKED:
    effectiveStatus = stored status
else if no allocated start time exists:
    effectiveStatus = CHECKED
else if current event-local date/time is before the allocated start:
    effectiveStatus = CHECKED
else:
    effectiveStatus = IN_FOREST
```

The calculation must use the competition date and `Europe/Stockholm` time. `allocatedStartSec` is seconds since midnight, so comparing it directly with the current time-of-day would incorrectly start runners on a different calendar day.

Represent this as a separate view-model property, such as `CompetitorWithEffectiveStatus.effectiveStatus: RunnerStatus`. Do not replace `Competitor.status` or write the derived value back to Firestore. This makes the distinction between stored and effective status explicit and prevents ordinary UI updates from persisting a derived status accidentally.

### Why computed status is preferred

- It changes status exactly when the scheduled time arrives without a write per competitor or a scheduled backend job.
- A competitor checked after their allocated time appears `IN_FOREST` as soon as the check update is received and the projection is recomputed.
- It avoids write fan-out, authorization/rules changes, race conditions between clients, and repeated status writes.
- It preserves actual station, readout, and operator status writes as authoritative source data.

This design changes the status shown and used by the app; it does **not** make Firestore or unrelated API consumers report `IN_FOREST` for an overdue stored `CHECKED` competitor. If persisted state or non-app clients must observe the transition, a server-authoritative scheduled transition would be a separate requirement and should not be mixed into this computed-status change.

## Current status flow

### Stored status values

[`src/types/sportident.ts`](./src/types/sportident.ts) defines the existing `RunnerStatus` values: `REGISTERED`, `CHECKED`, `IN_FOREST`, `PRELIMINARY_FIN`, `OK`, `MP`, `DNF`, and `DNS`. There is no `STARTAT` status and no new status value is needed.

### Status creation, hydration, and writes

| Path | Current behavior | Design impact |
|---|---|---|
| Firestore competitor hydration in [`src/firebase.ts`](./src/firebase.ts) | Accepts known status values and falls back to `REGISTERED` for an invalid value. | Leave this stored-status validation unchanged. |
| Registration/import and server competitor creation in [`src/App.tsx`](./src/App.tsx), [`src/firebase.ts`](./src/firebase.ts), and [`src/server/competitorCreation.ts`](./src/server/competitorCreation.ts) | New competitors ordinarily start as `REGISTERED`. | Do not derive `IN_FOREST` for `REGISTERED`, even when its allocated time has passed. |
| Start check-in in [`src/components/StartCorralView.tsx`](./src/components/StartCorralView.tsx) | A check writes `CHECKED` and its check time. | Preserve the write. The view projection immediately returns `IN_FOREST` if the allocated time has already passed. |
| Online CHECK station in [`src/firebase.ts`](./src/firebase.ts) | A CHECK station can write `CHECKED`. | Preserve the write; the same projection applies in every view. |
| Manual/hardware START and online START/RADIO/PREWARNING in [`src/components/StartCorralView.tsx`](./src/components/StartCorralView.tsx) and [`src/firebase.ts`](./src/firebase.ts) | Can write `IN_FOREST` and, for actual starts, record `startTimeSec`. | Preserve these actual-start paths. An already stored `IN_FOREST` must never be downgraded by the projection. |
| Finish and readout in [`src/firebase.ts`](./src/firebase.ts) | A finish station can write `PRELIMINARY_FIN`; readout/recalculation can write `OK` or `MP`. | Preserve all result transitions. They take precedence because only stored `CHECKED` is eligible for derivation. |
| Forest-safety actions and generic competitor updates in [`src/App.tsx`](./src/App.tsx) and [`src/firebase.ts`](./src/firebase.ts) | Operator actions can write statuses such as `DNF` and `DNS`; `updateCompetitorInFirestore` accepts an explicit status patch. | Keep these as source writes. Never pass a derived `effectiveStatus` as an implicit patch. |

These are source-status paths. The automatic behavior belongs in a shared read/view projection, not in each writer.

## Affected files and components

### Shared projection and clock

Add a pure utility, proposed as `src/utils/effectiveRunnerStatus.ts`, to calculate an effective status from:

- the stored `RunnerStatus`;
- `allocatedStartSec`;
- the competition date and lifecycle status;
- a supplied `now` value.

Add a shared hook or equivalent clock owner, proposed as `src/hooks/useEffectiveCompetitors.ts`, to expose effective-status view models. Recompute immediately when competition or competitor data changes and when the next checked runner reaches their scheduled time. Re-evaluate on window focus/visibility restoration so a suspended background tab catches up.

Prefer scheduling the next relevant boundary rather than adding another unconditional one-second timer across the whole app. Existing clocks in Start Corral and live result views should not become independent sources of status truth.

### View and ranking consumers

`src/App.tsx` currently passes the raw `competitors` array to view components. It should retain that raw array for Firestore writes and derive a separate effective-status array for status-sensitive presentation and calculations.

The following consumers must use the same `effectiveStatus` source:

| Component/module | Status-dependent behavior to update |
|---|---|
| [`src/components/StartCorralView.tsx`](./src/components/StartCorralView.tsx) | Waiting/checked/started lists, counts, row status, and card-dip feedback. The scheduled transition must not require a manual Start action. |
| [`src/components/SplitsAnalysisTable.tsx`](./src/components/SplitsAnalysisTable.tsx) | Both simplified and “Sträcka & bom” views, including in-forest display and list membership. |
| [`src/utils/resultSorting.ts`](./src/utils/resultSorting.ts) | Default ranking uses the effective status, so an overdue checked runner enters the `IN_FOREST` rank group at the allocated time. |
| [`src/components/SpeakerResultsView.tsx`](./src/components/SpeakerResultsView.tsx) | Incoming and in-forest result sections. |
| [`src/components/PublicPortalView.tsx`](./src/components/PublicPortalView.tsx) | Public start/result lists; this component loads its own public race payload and needs the same helper and clock behavior. |
| [`src/components/ReadoutDashboard.tsx`](./src/components/ReadoutDashboard.tsx) | Checked/in-forest totals and status-based views. |
| [`src/components/ForestSafetyView.tsx`](./src/components/ForestSafetyView.tsx) | In-forest and checked totals and lists. |
| [`src/components/EntriesRegistrationView.tsx`](./src/components/EntriesRegistrationView.tsx), [`src/components/CoursesClassesView.tsx`](./src/components/CoursesClassesView.tsx) | Any status-based filters, eligibility, or badges. |
| [`src/components/StatusLabels.tsx`](./src/components/StatusLabels.tsx), [`src/components/AccessControlView.tsx`](./src/components/AccessControlView.tsx), [`src/components/DrawView.tsx`](./src/components/DrawView.tsx), [`src/components/DrawAndEmergencyView.tsx`](./src/components/DrawAndEmergencyView.tsx), and [`src/components/RunnerSplitCardModal.tsx`](./src/components/RunnerSplitCardModal.tsx) | Status labels and summaries must display the effective status where they represent current race state. |
| [`src/utils/startListDraw.ts`](./src/utils/startListDraw.ts) and its callers | If drawing is allowed after allocated start times, eligibility must not treat a checked runner whose start time has passed as still waiting. Apply the same effective-status rule at the operation boundary, not just in the display. |

Use a distinct `effectiveStatus` property rather than mutating each `Competitor.status`. This requires status-sensitive consumers and the result comparator to read `effectiveStatus`; unrelated competitor fields and all explicit update callbacks remain unchanged.

## Time and lifecycle semantics

1. Construct the scheduled start from `competition.date` plus `allocatedStartSec`, interpreted in `Europe/Stockholm`.
2. Before that instant, `CHECKED` remains effectively `CHECKED`.
3. At the exact instant (`now >= scheduledStart`), the effective status becomes `IN_FOREST`.
4. A check-in received after that instant becomes effectively `IN_FOREST` immediately after the competitor state updates.
5. A null/unassigned start time (including free-start entries) cannot trigger the automatic transition; the status remains `CHECKED` until an existing actual-start path changes it.
6. Only stored `CHECKED` is eligible. `REGISTERED` remains `REGISTERED` after its allocated time, and all other stored statuses remain unchanged.
7. Do not use the Start Corral simulation clock to change real competitor status unless the simulation mode is explicitly designed to simulate the same event date/time.
8. A completed competition uses the stored status only. Do not project a stale stored `CHECKED` status as `IN_FOREST`.
9. Missing/invalid competition date or invalid allocation must not be interpreted using the browser’s local date or silently compared as seconds-of-day. Keep the stored status and surface the invalid schedule as a data issue.
10. Use one injected `now` in the pure helper so exact-boundary, timezone, and date behavior is deterministic in tests. Consider daylight-saving transitions when converting local event date/time to an instant.

## Manual and hardware start behavior

The automatic transition removes the need for a manual Start action; it does not require removing real start-time capture. A physical START station or optional operator correction may continue to record the actual start and persist `IN_FOREST`. The ordinary scheduled transition must work without either action.

The existing “check” flow can continue to persist `CHECKED`. Its displayed/effective status may already be `IN_FOREST` if the runner was checked late. The UI should avoid presenting a second required action to move that runner into the forest.

## Firestore, API, and compatibility

- No Firestore schema, document ID, rules, migration, or background job is required.
- Do not write effective status from a clock callback. Keep `updateCompetitorInFirestore`, online station writes, and readout transactions operating on stored status and explicit user/hardware actions.
- Do not derive status for terminal/result statuses or overwrite their status during recalculation.
- App/server code that performs status-sensitive operations outside the UI must either call the shared pure rule with competition date/time or be explicitly documented as using stored status. In particular, verify draw eligibility and any API-side filtering; a view-only projection cannot change server behavior.
- Existing competitions remain compatible because the calculation uses their current `competition.date`, `allocatedStartSec`, and stored status. Missing schedule data leaves the stored status unchanged.

## Implementation plan (completed)

1. Add and unit-test the pure effective-status helper, including competition date and Stockholm time handling.
2. Add a shared reactive time source that refreshes at the next checked runner’s allocated start and catches up after focus/visibility changes.
3. Build effective-status view models without mutating raw competitor state; retain raw competitors for persistence and callbacks.
4. Update all status-sensitive components and `resultSorting` to consume the effective status consistently, including both result-view modes and the public portal.
5. Review operation boundaries such as start-list draw eligibility and server/API filters so they do not contradict the displayed status.
6. Keep manual/hardware status writes unchanged; verify that an actual START before the allocated time stays `IN_FOREST` and a late CHECK immediately displays as `IN_FOREST`.
7. Run focused helper/view tests, then build and lint.

## Regression test matrix

- `CHECKED`, scheduled start in the future returns `CHECKED`.
- `CHECKED`, exactly at allocated start returns `IN_FOREST`.
- `CHECKED`, allocated start in the past on the event date returns `IN_FOREST`.
- Change a competitor to `CHECKED` after their allocation → immediate `IN_FOREST` without waiting for another clock tick.
- `REGISTERED` after its allocation remains `REGISTERED`.
- `CHECKED` with no allocation remains `CHECKED`.
- `IN_FOREST`, `PRELIMINARY_FIN`, `OK`, `MP`, `DNF`, and `DNS` remain unchanged.
- Same time-of-day on a future competition date remains `CHECKED` until the scheduled event date and time.
- Effective status does not mutate the source competitor or cause a Firestore write.
- At the boundary, Start Corral counts/lists, simplified results, “Sträcka & bom”, speaker view, public portal, and default live ranking all show the same transition.
- A completed competition follows the lifecycle policy chosen above.
