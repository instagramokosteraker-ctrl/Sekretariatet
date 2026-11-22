# Readout Workstation V6 Implementation

## Status

Implemented on top of the existing readout history, correction, approval, and
audio-feedback flows. No new server endpoint or production-data migration was
required for V6.

## Architecture changes

- Kept `ReadoutDashboard` as the workstation and `ReadoutHistoryRow` as the
  shared, selectable history/action row.
- Added a prioritized action queue after Latest Readout. It previews up to five
  open/in-progress issues; a link opens the complete filtered history.
- Kept result status, issue state, and delivery/synchronization state
  independent. The issue queue uses the existing outstanding-issue predicate.
- Kept readout capture identity and ordering unchanged. Reassignment continues
  to preserve the original competitor while the current competitor and ordered
  correction audit chain track the latest correction. Legacy correction
  compatibility remains as implemented in the repeat-reassignment change.
- Unknown-card registration still creates the entry and updates the linked
  readout from the workstation; it does not navigate away. Manual approval
  remains an explicit, reasoned action. Reassignment still requires a target,
  reason, preview, and confirmation.

## Files changed

V6-specific changes:

- `src/components/ReadoutDashboard.tsx` — action queue, Swedish issue filter,
  expanded history search, keyboard navigation, and bounded page rendering.
- `src/components/ReadoutHistoryRow.tsx` — direct unknown-card and eligible
  wrong-competitor actions; keyboard shortcut metadata.
- `src/components/ReadoutHistoryRow.test.tsx` — row action coverage.
- `src/App.tsx` — routes readout feedback through the tested tone selection.
- `src/utils/readoutAudioFeedback.ts` and
  `src/utils/readoutAudioFeedback.test.ts` — readout-to-tone mapping.
- `src/utils/readoutHistoryKeyboard.ts` and
  `src/utils/readoutHistoryKeyboard.test.ts` — safe visible-row focus movement.
- `src/utils/readoutHistoryPaging.ts` and
  `src/utils/readoutHistoryPaging.test.ts` — bounded page slicing.

The worktree also contains the earlier repeat-reassignment implementation and
its reports; those files were not V6 changes. See
`READOUT_REASSIGNMENT_REPEAT_IMPLEMENTATION.md` for its full file list and
server/audit details.

## UI changes

### Added

- A **Kräver åtgärd** queue with an open-issue count, up to five recent actionable
  rows, direct row actions, and access to all matching history.
- A **Kräver åtgärd** history filter label.
- Search terms for class, card series, station code, and delivery state, in
  addition to the existing readout, runner, status, and issue terms.
- Up/down focus movement between visible history rows; Enter opens the focused
  readout. Navigation ignores modifier-key combinations and editable controls,
  so keyboard-wedge scanner input is not intercepted.
- A direct **Fel löpare** entry point on eligible rows. The existing detail
  panel retains the reason, preview, confirmation, and full correction audit
  chain.

### Removed or replaced

- Replaced the English **Outstanding Issues** label with **Kräver åtgärd**.
- Replaced history-only issue discovery with the new action queue. The history
  filter remains available as the complete issue archive.
- No existing result, manual-approval, offline-queue, diagnostic, KPI, or safety
  list section was removed.

## Result types and interaction behavior

- **OK / MP:** retain their result-specific colors and selectable history
  details. MP is not an issue unless an operator explicitly creates an
  `MP_REVIEW`.
- **UNKNOWN_CARD:** remains an open action; **Anmäl** opens its registration
  workflow without leaving the workstation.
- **DUPLICATE_READOUT:** remains informational and excluded from the action
  queue unless its issue state independently requires intervention.
- **MANUAL_APPROVAL:** remains a separate explicit approval with a required
  reason and finish-time validation; the result provenance stays distinguishable
  from SI-verified OK.
- **WRONG_COMPETITOR / repeat reassignment:** eligible rows expose a direct
  correction entry point. The current competitor is excluded as the target, but
  an earlier/original competitor can be selected again. Each correction remains
  in sequence order with the previous and corrected competitor recorded.

## Audio implementation

The existing `passersi_sound` preference and Web Audio
`playMeosFeedbackTone` implementation remain in use. A tested mapper now makes
the delivery feedback policy explicit:

- queued offline readout: `registration`
- unknown card: `mp`
- matched OK: `ok`
- other matched result: `mp`
- duplicate or unclassified response: silent

The preference still gates playback. No new audio assets or audio settings were
added.

## Filter and large-history strategy

- Both the top action preview and the history filter use the existing
  `OPEN`/`IN_PROGRESS` issue definition. Informational duplicates and ordinary
  MP results stay out of the action queue.
- Search and history slicing remain memoized. History renders only the selected
  page (20, 30, or 50 rows), with a 50-row maximum; it does not mount the full
  history at once.
- The action queue is capped at five preview rows and links to the complete,
  paginated issue list.
- A 10,000-record test verifies that page rendering remains bounded. Filtering
  still scans the active competition's in-memory history; no virtualization or
  server-side search was introduced.

## Migration impact

No V6 Firestore schema, production data, or IndexedDB migration was added.
V6 consumes the existing history and repeat-reassignment model. Original
ownership remains preserved; current ownership resolves from the current
competitor field, with the established legacy audit fallback for older
correction records.

## Validation

- `npm run build` — passed. Existing warnings remain for `__dirname` in the
  Vite config and the minified client bundle exceeding 500 kB.
- `npm run lint` — passed (`tsc --noEmit`).
- `npx vitest run src` — passed: 40 test files passed, 6 skipped; 192 tests
  passed, 27 skipped. Emulator-gated tests were skipped in this run.
- No new screenshots or wireframes were generated.

## Remaining limitations

- Only five issues are previewed at a time; the full filtered list is one
  action away in history.
- Filtering remains an in-memory linear scan, and the archive uses pagination
  rather than virtualization.
- Sound playback remains subject to browser audio/autoplay policy.
