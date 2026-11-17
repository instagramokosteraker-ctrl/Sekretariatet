# Readout Overview Implementation Plan

Date: 2026-11-17

## Goal

Redesign **Avläsning och översikt** as a finish-line workstation that maximizes readout throughput:

> Capture the card, save it locally, show its result, keep reading, and resolve exceptions later.

An exception must never require navigation, modal confirmation, or operator action before the next SI card can be read. Preserve the existing durable offline queue, delayed synchronization, automatic retry, idempotent receipt handling, and authoritative Firestore validation.

This is an implementation plan only. No application code is changed.

> Product clarification: every physical readout is a first-class, permanently addressable history record, including successful `OK` readouts. Outstanding Issues is a filtered view of those records, not a replacement work list. The expanded authoritative version is [READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V2.md](./READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V2.md).

## Audit findings

### Already supported

- The SPORTident service parses a full readout and acknowledges the SI station before notifying the full-readout callback.
- The App listener invokes readout submission without awaiting it, so it does not wait on Firestore before returning from the hardware callback.
- `OfflineReadoutQueueManager` gives each submission a client readout ID, puts it in its in-memory queue, attempts local persistence before network delivery, and retains delivery failures for retry.
- The queue retries automatically on browser reconnection and on a timer. It distinguishes retryable and permanent errors.
- Firestore `readoutReceipts` makes readout delivery idempotent and records unknown-card outcomes.
- Known readouts are validated against the competitor's class/course and result in `OK` or `MP`.

### Gaps and interruption risks

- The queue calls `persistAll()` before delivery, but localStorage and IndexedDB errors are swallowed. The IndexedDB write is asynchronous and its transaction completion is not awaited. Thus the current code does not prove that a readout is durable before beginning network delivery.
- `handleReadoutResultFeedback` ignores queued/offline results for the latest-readout display. The overview updates only after delivery returns; Firestore delivery can wait for its timeout.
- App state has one `pendingUnknownReadout`. New unknown cards replace that value. Linking from the event stream navigates to the registration view, away from the finish station.
- The selected/latest competitor panel is not a readout log. It shows a competitor's current/latest readout fields, which are replaced on a later readout.
- The real-time event section is limited to 16 events and is not tied to a stable readout ID or the full captured payload. It cannot reliably reopen that exact readout.
- `OK`/`MP` and unknown outcomes exist, but class conflicts, duplicate SI assignments, unlinked competitors and manual review are not unified as durable operator issues.
- Readout matching selects an eligible competitor among matching SI numbers; the readout path does not surface duplicate assignment as a first-class operator conflict. A redesign must not make ambiguous assignment look like a confirmed match.
- The dashboard currently mixes finish operation with hardware test scenarios, online-punch entry, competition KPIs, control-intake and rental-card tools.

See [READOUT_OVERVIEW_REDESIGN.md](./READOUT_OVERVIEW_REDESIGN.md) for the detailed view audit and proposed zones.

## Target layout and UI ownership

Reorder the view so the three operational zones appear first. Keep hardware configuration and non-finish-line tools in a secondary/collapsible **Verktyg** area.

### Zone 1 — Latest readout

Always visible and visually dominant. It is driven by capture sequence, never by asynchronous response order.

On card capture, immediately show the SI number and a provisional state such as **Läser in**. Use already-loaded competition data to identify a unique local competitor candidate and run the existing pure readout validation locally; show provisional result details without waiting for Firestore. Mark the result as provisional until the server confirms the match/update. Ambiguous or stale local data must be shown as an unresolved/conflict state, not as a definitive competitor result.

Display when available:

- Competitor name and class; otherwise card/SI number.
- Race result (`OK`, `MP`, unknown, unlinked, class conflict or duplicate assignment).
- Finish time, placing and Bom, using the existing result/Bom calculations.
- A separate synchronization state: `Saved locally`, `Syncing`, `Synced` or `Retry needed`.

The last-readout pointer is the highest capture sequence. A delayed response may update its own history item but must not replace a newer readout in this panel.

### Zone 2 — Action area

Render for the selected readout when it has a human-action issue or when the operator explicitly opens a readout for review/correction. Every readout is eligible, including successfully processed `OK` and `PRELIMINARY_FIN` records. Keep it inline and non-modal. Do not navigate away or change focus automatically after a read.

Provide correction actions appropriate to the issue:

- Link an unknown card to an existing/new competitor.
- Resolve an unlinked competitor or class conflict after showing candidates and a validation preview.
- Resolve a duplicate assignment by explicit selection; do not auto-select the first match.
- Enter or correct a manual finish time through the existing manual-finish flow.
- Save, cancel or defer. Deferral leaves the issue unresolved.

Keep the scanner and next readout available while any action is open. Do not alter competitor class or SI-card ownership solely because punches appear to fit another course/class.

### Zone 3 — Readout history

- Create exactly one first-class history record per physical card read, keyed by its `clientReadoutId`. Store `captureSequence`, `capturedAt`, outcome, original matching result, current linked competitor, original readout/punches, and issue/resolution state.
- Preserve every record so any readout can be reopened later, including `OK`, `PRELIMINARY_FIN`, and any successfully processed result.
- Show newest first. Offer visible page/window size 20/30/50; default to 30. Older records remain searchable/paginatable and are not deleted when they leave the recent window.
- Include `OK`, `PRELIMINARY_FIN`, `MP`, unknown, unlinked, conflict and sync-pending states. Keep outcome, synchronization and issue state distinct.
- Make every row keyboard accessible and clickable. Selecting any row reopens its original readout details, original punches, original matching result, current linked competitor, and correction workflow—not only an unresolved issue.
- Add **Show only unresolved** as a filter over the same readout records and show its count. A readout may be `OK` with an open correction issue.
- A history-size setting changes only the visible page/window; it never evicts durable readouts or unresolved issues.

### Move out of the primary operation area

| Existing UI | New location |
|---|---|
| Current selected-runner/split detail | Latest readout or details of the selected history item |
| Offline synchronization banner and retry list | Separate technical sync status; never counted as human issues |
| Unknown-card registration navigation | Inline action area, reusing registration logic |
| Real-time competition event stream | Secondary live-activity/tool area; not a substitute for readout history |
| USB station connection/status and errors | Compact station status adjacent to the workstation; detailed settings in tools |
| Hardware test scenarios, online-punch form, KPIs, forest intake and rental overview | Secondary/collapsible tools, unless specifically needed by the finish operator |

## Readout record and status model

Represent one physical readout as a stable record, keyed by the ID generated at capture:

- `clientReadoutId`
- monotonically increasing `captureSequence` and `capturedAt`
- `eventId`
- readout payload (SI number, card series, station, times, punches, raw data as currently retained)
- local persistence state
- delivery/synchronization state
- preliminary and server-confirmed `outcome`
- original matching result, including original competitor ID/display snapshot and validation
- current linked competitor ID/display snapshot, separate from the original match
- issue state (`NONE`, `OPEN`, `IN_PROGRESS`, `RESOLVED` or `DISMISSED`) and issue type, when applicable
- correction history/audit references

Keep three concepts separate:

1. **Race outcome:** `OK`, `MP`, or unlinked/conflict outcome.
2. **Technical delivery:** local save, sync in progress, synced, retryable/permanent delivery failure.
3. **Human resolution:** no issue, open, in progress, resolved or dismissed. This state belongs to the readout record; it does not determine whether the readout exists in history.

An `MP` race result remains `MP`; a review flag must not change its result status. A retryable connectivity problem is not by itself a human assignment issue.

A successfully processed result is not immutable. For example, an `OK` readout initially matched to Anna must remain reopenable if an operator later determines Erik ran with Anna's card. Preserve the original match and separately record the corrected current link.

## Data flow

1. **Capture:** after a full card is parsed, assign a `clientReadoutId` if none exists and assign its capture sequence/time. Add a provisional record to the UI immediately. Do not wait for Firestore or a backend response.
2. **Local-first persistence:** upsert the full payload and record state into IndexedDB. Await transaction completion before starting any network delivery. Keep a localStorage mirror only as a clearly identified fallback, not as silent proof of durability.
3. **Preliminary result:** use cached competition data for a fast local preview. Reuse the current validation/Bom logic. Show provisional state explicitly; do not mutate competitor or SI assignment from client-only inference.
4. **Delivery:** after durable local storage succeeds, hand the same ID/payload to the existing Firestore path. Keep the queue as the owner of retries and idempotent delivery.
5. **Reconcile:** update the matching history record by ID with server-confirmed competitor, validation and delivery result. Out-of-order responses may update older rows only.
6. **Create issue:** if the result requires human action, set the issue state/type on the durable readout record (or on keyed metadata joined to it). A successful delivery does not resolve or delete the issue; it also does not determine whether a history record is retained.
7. **Resolve:** apply a selected correction through an authorized, server-validated, idempotent operation, update the current linked competitor/result as appropriate, and mark the issue resolved while retaining the readout and its audit/history.

If local persistence fails, show a prominent **Not safely saved** state and explicit recovery guidance; do not claim success or send the readout to Firestore as if it were durably queued. Keep the hardware reader available for the next competitor and retain the payload in memory for recovery while clearly communicating that storage failed. Never swallow a storage error.

## Offline and synchronization flow

### Offline capture

1. Reader completes/acknowledges the SI card.
2. Create and display the readout record immediately.
3. Commit it to IndexedDB and mark `Saved locally` only after transaction completion.
4. Leave it in the local journal and technical delivery queue.
5. Continue accepting the next card without waiting for a human correction.

### Reconnection

- Preserve the current automatic `online` event and retry-timer behavior.
- Flush only records confirmed as locally durable.
- Retry transient network/time-out failures automatically; do not require an operator to press **Retry** when connectivity returns.
- Use the same `clientReadoutId` on every replay so Firestore receipt idempotency remains effective.
- Merge delivery completion into the local history by ID. A synced record may leave the pending-delivery queue but must remain in readout history according to the retention policy.
- Keep permanent data/authorization/competition errors visible as `Retry needed` or an explicit blocking-data error; never label them as synced. Such errors may require correction, but must not stop the next physical read.

Use the existing `competitions/{competitionId}/readoutReceipts` as the idempotency/server record where possible, after reviewing its rules and retention. Use separate, staff-only case metadata for human-resolution state rather than changing receipt identity matching. Any history listener/query must be competition-scoped and must not expose raw SI/readout data through public result projections.

## Operator workflow

1. Connect the SI readout station and start reading cards.
2. Each card immediately appears as the latest readout and one history row.
3. Operator sees result and sync status separately; short sound/visual feedback does not require interaction.
4. Operator reads the next card regardless of `MP`, unknown, ambiguity, conflict or sync delay.
5. Any time, operator can select any history row—including `OK`—to reopen its original details and correction workflow.
6. Between rushes, operator may filter the same history to unresolved issues.
7. Operator reviews the original payload and matching, selects the needed correction, and saves or defers it.
8. The unresolved count decreases only when an issue is explicitly resolved or dismissed under the authorized workflow; the readout remains in history.

Keyboard/scanner behavior:

- Preserve SPORTident serial/WebUSB acknowledgement and never await backend delivery in the reader callback.
- Do not auto-open a modal, steal focus, or switch tabs when an issue is created.
- Support keyboard navigation and Enter/Space activation in history and action controls.
- Do not introduce global shortcuts that consume keyboard-wedge scanner input. Confirm whether keyboard-wedge scanning is in use before adding scanner-specific focus logic; the audited main path is the SPORTident serial service.

## Outstanding Issues: filtered readout history

Do not create a separate source of readout records for **Outstanding Issues**. It is a filter over first-class readout history, with count derived from records whose issue state is unresolved. The UI may present a separate filtered panel/tab, but opening an item always opens the same history record and captured payload.

Minimum issue types:

- `UNKNOWN_CARD`
- `UNLINKED_COMPETITOR`
- `CLASS_CONFLICT`
- `DUPLICATE_ASSIGNMENT`
- `WRONG_COMPETITOR` (or `RESULT_REASSIGNMENT`)
- `MANUAL_FINISH_REVIEW`
- `MP_REVIEW`

The unresolved counter counts only human-action issues, not readouts with no issue. The offline delivery queue has its own count/status. Keep issue state across app reload, sync completion and history pagination. An `OK` readout may have `WRONG_COMPETITOR`; its successful outcome and original match remain preserved. MP remains an outcome, and whether every MP requires `MP_REVIEW` should be confirmed before implementation.

For unknown cards, refactor the existing registration/linking logic so it can resolve a focused readout inline. Do not retain only a single pending object; multiple unknown cards must each remain independently addressable by ID. Apply the same reopen/correct behavior to known successful readouts.

## Successful-readout correction and reassignment

1. Operator opens any historical readout, including an `OK` item.
2. Show the immutable original payload/punches, capture ID/sequence/time, original outcome and original matching result (for example, Anna).
3. Operator chooses **Wrong competitor / Reassign result**, searches/selects the actual competitor (for example, Erik), and sees a preview of validation, class/course, start-time, finish-time, placing and Bom consequences.
4. Keep two operations distinct: correcting which competitor this historical readout belongs to, and changing the SI-card assignment for future reads. Do not change future card ownership unless the operator explicitly requests and is authorized to do so.
5. On confirmation, use a server-validated, idempotent transaction to update the readout's current linked competitor and the affected result/derived state. Reject or leave unresolved any ambiguous assignment or incompatible correction rather than silently selecting a runner.
6. Retain the original match and every prior correction; set the issue resolved only after the correction succeeds. The row remains clickable and shows its current corrected link plus audit trail.

## Audit trail requirements

- Preserve original `clientReadoutId`, `captureSequence`, `capturedAt`, raw card data/punches, original matching candidate/result and first server outcome. Corrections must not rewrite this original evidence.
- Append an audit entry for each correction with actor UID/role, timestamp, action/reason, previous and new competitor IDs, relevant class/card-assignment changes, and transaction/result reference.
- Keep original match and current linked competitor as separate fields so the UI can explain what changed.
- Make resolution idempotent and authorized; record failed/conflicting attempts without marking the issue resolved.
- Update derived competitor results/places/Bom atomically as required by the existing result model. Do not alter the Bom algorithm as part of this redesign.
- Keep readout and audit data staff-only; do not expose raw competitor/readout records through public result projections.

## Component and module changes

| File/module | Planned change |
|---|---|
| `src/components/ReadoutDashboard.tsx` | Reorganize into latest readout, inline correction area, and complete clickable history. Make unresolved filtering a view over the same rows. Move non-operational tools below/collapsible. |
| `src/App.tsx` | Create the first-class record at capture time, append by capture sequence, pass latest/history to the view, merge asynchronous results by readout ID. Preserve non-blocking reader callback and original matching data. |
| `src/services/offlineReadoutQueue.ts` | Add an awaited durable enqueue contract, transaction-completion/error handling, explicit local-persistence state and ID-based delivery events. Keep automatic retries and idempotency. Avoid one queue record disappearing from the separate history journal after sync. |
| `src/firebase.ts` | Preserve receipt and transaction semantics. Return a readout-ID-associated explicit outcome; detect/return ambiguity instead of selecting an arbitrary duplicate assignment. Add narrowly scoped validated correction/reassignment operations and audit records if necessary. |
| `src/utils/readoutValidation.ts` | Reuse as the local provisional preview and server validation source; do not change Bom/validation semantics as part of the layout work. Mark local results provisional until server confirmation. |
| `src/components/EntriesRegistrationView.tsx` | Extract/reuse the existing unknown-card entry behavior through an inline correction callback while preserving the normal registration workflow. |
| Firestore rules/types | Review and add minimal staff-only access to case/history metadata if needed. Keep raw readout and competitor documents out of public projections. |

## Migration strategy and phases

### Phase 0 — Safety and contract

- Audit receipt/rules access, retention, SI assignment ownership, and current manual-finish operations.
- Define record, delivery, outcome and issue states; determine the exact count semantics for MP.
- Confirm supported card-scanner modes and device/browser storage behavior.
- Add regression tests for idempotent replay, duplicate assignment ambiguity, storage failure, offline capture and out-of-order responses.

### Phase 1 — Capture-first durable journal

- Generate/reuse one stable readout ID at capture.
- Add immediate local history/latest state and IndexedDB persistence with an awaited transaction completion.
- Do not start network delivery until durable enqueue succeeds.
- Surface storage failure explicitly while leaving the reader active; verify that no `Saved locally` claim is made on failure.
- Preserve existing Firestore receipt IDs, transactions and automatic retry behavior.

### Phase 2 — Immediate result and workstation layout

- Add a provisional local result preview (status, time, place and Bom where computable).
- Add capture-sequence ordering and merge server confirmation into the matching record.
- Implement the three zones; move hardware testbench/admin content to secondary tools.
- Clearly distinguish provisional result, confirmed race result and sync state.

### Phase 3 — Complete readout history and correction workflow

- Persist every readout's original payload, outcome, original match, current link and issue state; keep history independent of the unresolved filter.
- Implement clickable/reopenable rows for all outcomes and add the unresolved counter/filter as a subset of those rows.
- Refactor unknown-card linking into inline correction actions; add explicit ambiguity workflows and `WRONG_COMPETITOR`/`RESULT_REASSIGNMENT` for successfully matched readouts later found to belong to another runner.
- Add auditable, authorized reassignment/correction with original evidence retained.
- Preserve readouts and issue state through sync success, reload and pagination.

### Phase 4 — Pilot and cleanup

- Pilot rapid consecutive reads, multiple unknown cards, MP, duplicate assignment, network loss/recovery, storage failure and deliberately delayed/out-of-order responses.
- Reconcile physical reads, local records, receipts, synced count and issue count.
- Keep old event stream/registration route as fallback during pilot; remove duplicate operator routes only after successful parity checks.

## Acceptance criteria

- Latest readout and a history row appear immediately on capture, before any network request completes.
- 100 consecutive cards with 3 exceptions yield 100 unique readout IDs/history rows and 3 independently addressable outstanding issues.
- A delayed older response never replaces the latest readout.
- No Firestore delivery begins before local durable commit; a failed commit is surfaced and is never reported as locally saved.
- Offline capture continues to work, auto-sync resumes on reconnection, and idempotent retries do not duplicate results.
- Every exception remains deferrable; the next card is never gated by the action area.
- Every history row, including `OK` and `PRELIMINARY_FIN`, reopens the exact original payload, punches, original matching result and correction workflow.
- Correcting an `OK` readout from Anna to Erik preserves Anna as the original match, shows Erik as the corrected link, creates an audit entry, and leaves the readout in history.
- Outstanding Issues is a filtered subset of readout history; resolving an issue removes it from the filter/count but not from history.
- Technical sync failures and human issues have independent counts, filters and lifecycles.
- Bom and validation results match existing behavior; public portal data remains free of raw readout/competitor documents.

## Audited files

- [ReadoutDashboard.tsx](./src/components/ReadoutDashboard.tsx)
- [App.tsx](./src/App.tsx)
- [offlineReadoutQueue.ts](./src/services/offlineReadoutQueue.ts)
- [firebase.ts](./src/firebase.ts)
- [EntriesRegistrationView.tsx](./src/components/EntriesRegistrationView.tsx)
- [sportidentWebSerial.ts](./src/services/sportidentWebSerial.ts)
- [readoutValidation.ts](./src/utils/readoutValidation.ts)
- [sportident.ts](./src/types/sportident.ts)
