# Readout Workstation V6 Gap Analysis

## Scope and conclusion

This is a review-only comparison between the current V6 workstation and the
requested single-timeline design. No application code is changed by this
analysis.

The current V6 is an incremental improvement to the V5 section layout, not the
intended redesign. A single captured readout can still be represented in three
separate visible areas—Latest Readout, the action queue, and the history
archive—and its expanded details/actions render in a fourth, separate panel.
The persistence model already has the identity and ordering needed for a
chronological timeline; the main blockers are presentation and UI state
placement, not production data.

## Comparison

| Concern | Current V6 | Intended timeline |
|---|---|---|
| Primary surface | Latest card, issue queue, history list, and selected-detail panel | One chronological readout timeline |
| Readout visibility | The newest record can appear in the latest card and again in history; actionable records can also appear in the issue preview | One timeline item per captured readout |
| Actions | Row buttons select a readout, then forms/details render in a separate panel | Details and all operator actions expand inside that readout's row |
| Issues | Dedicated queue duplicates records from history; the history also has an issue filter | Issue state remains a property/badge on the timeline item; filtering is a timeline view, not another surface |
| Ordering | Latest card is separately derived; history is capture-sequence sorted newest first | One sequence-ordered stream, newest first; the newest item is identified in-place |
| Large histories | Search plus 20/30/50-row pagination | May retain paging or use virtualization, but it must paginate/window the one timeline rather than create a separate archive |

## What remains from V5

The current V6 retains the V5 section model:

1. A separate **Senaste SI-avläsning** card.
2. A separate **Kräver åtgärd** preview queue.
3. A separate **Avläsningshistorik** archive with its own view filter, search,
   page size, and pagination.
4. A selected-readout detail/action panel outside the history row.
5. **Tävlingsstatus** KPI overview after the history list.
6. The collapsed **Offlinekö och tekniska verktyg** section within the readout
   dashboard.

V6 changed the issue label to Swedish and added an action preview, but did not
remove the distinction between the latest readout, actionable issues, and
history. Its implementation report explicitly says the history filter remains
the complete issue archive and that no existing KPI, diagnostic, or offline
section was removed.

Some V5 behaviors remain useful and should be carried into the timeline:

- Every physical readout remains durable and independently addressable.
- `captureSequence`—not wall-clock timestamp—defines readout ordering.
- Result status, issue state, and delivery state remain independent.
- MP is not an issue unless an operator explicitly creates an MP review.
- Duplicates remain informational unless an intervention issue is explicitly
  open.
- Current and original competitor ownership, manual-approval provenance, and
  the ordered repeat-correction audit chain remain visible in the relevant
  readout item.
- The reader stays available while a row is expanded or being corrected.

## What prevents the timeline model

### Duplicate presentation

`ReadoutDashboard` derives a separate `latestReadout` while also mapping the
same `readoutHistory` into the action queue and history. The queue previews
records already present in the archive. Thus, these are duplicate
presentations—not duplicate persisted readout records.

### Actions detached from their readout

`selectedReadoutId` controls a large selected-readout panel rendered outside
`ReadoutHistoryRow`. Selecting a row opens that panel, which contains readout
details, unknown-card registration, MP review, manual approval, wrong-competitor
correction, and correction audit history. The operator's work is therefore
visually separated from the timeline/archive item it changes.

The existing row component only renders a compact summary plus direct
**Anmäl** or **Fel löpare** entry buttons. Those buttons also select/open the
separate detail panel; they do not complete the workflow within the row.

### Split navigation and state

`historyView`, `historySearch`, `historyPage`, and the issue queue are organized
around the separate history and issue sections. `selectedReadoutId` is a
dashboard-level selection, with form and audit state also held in
`ReadoutDashboard`. A timeline implementation must instead associate expansion
and action state with the stable `clientReadoutId` of the rendered timeline row.

### Other dashboard content

The workstation includes reader controls and a collapsed offline/technical
section in addition to the readout surfaces. These are not competing readout
records, but the timeline redesign must decide whether to retain them as
secondary controls or relocate diagnostics. They should not become another
readout list or duplicate timeline content.

## Components and visual surfaces affected

- **`src/components/ReadoutDashboard.tsx`**
  - Remove the standalone latest-readout presentation and render its
    latest-record cues on the first timeline item.
  - Remove the standalone action-queue list; retain an in-timeline filter for
    open/in-progress issues if desired.
  - Replace the history section as a separate archive with the one timeline
    surface and its search/filter/paging controls.
  - Move the selected-readout content and action forms into the corresponding
    timeline item.
  - Keep competition KPIs as secondary content after the timeline, or make
    them available elsewhere without inserting readout copies.
- **`src/components/ReadoutHistoryRow.tsx`**
  - Evolve from a compact archive/action row into the timeline item, including
    stable expansion, issue and delivery indicators, and in-row actions.
- **`src/services/readoutHistoryStore.ts`**
  - No schema redesign is apparent from the timeline requirement. Continue to
    use the captured record, stable ID, sequence, and explicit status fields.
- **`src/App.tsx`**
  - Keep capture, delivery, audio, manual approval, unknown-card creation, and
    reassignment callbacks intact; the UI refactor should not move these server
    responsibilities into the timeline component.
- **Visual reference**
  - The previously supplied compact colored readout-list screenshot is
    consistent with a row-first surface. No new screenshot or wireframe was
    generated for this gap analysis.

## Sections to remove

Remove these as independent readout surfaces:

- **Senaste SI-avläsning** card. Its content becomes a `Senaste` marker and
  latest-result context on the first timeline item.
- **Kräver åtgärd** preview queue. It repeats records and should not render a
  second readout list.
- The separate **selected-readout detail/action panel**. Its content belongs
  inside the expanded timeline item.
- The separate **Avläsningshistorik** identity as an archive distinct from
  operational readouts. Keep its useful search, issue filter, counts, and
  pagination as controls on the timeline itself.

Do not remove the persisted readout history, correction audit data, offline
capture behavior, or competition calculations. The removal is presentational.

## Sections to merge

- Merge Latest Readout into the first (newest) timeline item.
- Merge Outstanding Issues into row-level issue badges and an optional
  **Kräver åtgärd** filter on that same timeline.
- Merge history rows and expanded selected details/actions into one
  `ReadoutTimeline` / `ReadoutTimelineItem` surface. The action forms and
  correction chain must remain associated with the row's `clientReadoutId`.
- Keep search and pagination/windowing in the timeline header/list rather than
  as controls for a separate archive.

The collapsed offline queue/technical tools and Competition Overview are not
readout copies. They can remain as clearly secondary sections outside the
primary timeline; the V5 placement of Competition Overview after all readout
content can be preserved.

## Proposed final layout

```text
Avläsning och översikt
┌─────────────────────────────────────────────────────────────┐
│ Reader status / connection controls                         │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Avläsningar  [Alla] [Kräver åtgärd] [search] [paging]       │
│                                                             │
│ #N   Senaste · OK · Synkad                                   │
│      Competitor · class · time · result                     │
│      [expand] details / correction / approval actions       │
│                                                             │
│ #N-1 MP · Synkad                                             │
│      [expand] details / optional MP review                  │
│                                                             │
│ #N-2 Okänd bricka · Kräver åtgärd                            │
│      [expand] inline registration and linking               │
│                                                             │
│ #N-3 Redan avläst · Informativ                               │
│      [expand] original details                              │
│                                                             │
│ ... older records, newest first                             │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Competition Overview / secondary diagnostics                │
└─────────────────────────────────────────────────────────────┘
```

Each captured readout appears once in this list. The latest item is not copied
into a separate card; issue rows are not copied into a queue. Expanding one
timeline item reveals that readout's details and relevant actions in place.
Filtering changes which timeline items are shown, not where an item is
rendered.

## Migration effort

### Data migration

**None expected.** The current local history already stores a stable
`clientReadoutId`, monotonically assigned `captureSequence`, result and issue
fields, delivery state, current/original competitor information, and correction
audits. Existing records can be rendered by the timeline without a data
backfill. Server ownership and repeat-reassignment data remain unchanged.

### UI refactor

**Moderate to high, concentrated in the readout dashboard.**

1. Consolidate the three readout selectors/presentations into one
   capture-sequence-ordered collection.
2. Move the selected detail/action panel into a row expansion keyed by
   `clientReadoutId`; preserve form errors, busy state, and audit loading for
   the expanded record.
3. Make the latest item a derived marker on the first record rather than a
   second rendering.
4. Convert the issue queue into a filter/count over the same timeline; do not
   copy records into another list.
5. Preserve bounded rendering. Existing page sizes can be reused initially;
   virtualization is optional and should be considered only if real history
   sizes require it.
6. Add UI tests for exactly-one-row presentation, latest-in-place behavior,
   inline action association, filter transitions, and expansion stability when
   new captures arrive.

No server/API change is required unless implementation discovers that a
required action or audit detail is unavailable in the existing readout record
or callbacks.

## Acceptance criteria for the redesign

- Every physical readout is rendered in one and only one timeline row.
- Rows are ordered by `captureSequence` descending; ties or missing legacy
  sequences must have a deterministic fallback without replacing sequence
  ordering for current records.
- The newest readout is visibly identified in its row.
- Search and issue filtering operate on the timeline; no standalone issue list
  or selected-readout detail panel remains.
- Expanding a row shows details and performs actions for that exact
  `clientReadoutId`.
- New readouts do not move an expanded item's state to a different record.
- OK, MP, unknown card, duplicate, manual approval, wrong competitor, repeated
  reassignment, delivery state, and correction history retain their existing
  semantics.
- The next card can always be captured while a timeline item is expanded or
  awaiting operator action.
