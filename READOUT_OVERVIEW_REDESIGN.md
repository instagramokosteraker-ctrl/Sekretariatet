# Readout Overview Redesign

Date: 2026-11-17

## Objective

Redesign **Avläsning och översikt** as a finish-line workstation optimized for continuous SI-card readout. A readout may create an exception, but must never require the operator to resolve it before reading the next card.

This is an audit and implementation plan only. No application behavior is changed by this document.

## Audit summary

| Requirement | Current behavior | Gap |
|---|---|---|
| Show the result of the latest card immediately | The dashboard selects the latest competitor with `readoutAt`, or the currently selected competitor, and displays its details. Feedback is received after delivery returns. | No dedicated latest-readout card, no immediate captured/pending state, and out-of-order delivery responses can change which result appears selected. Unknown cards have no competitor to show in this panel. |
| Continue reading while delivery or correction is pending | The serial callback dispatches submission without awaiting it. The offline manager stores a readout before attempting Firestore delivery. | The operator-facing readout result is not updated until the delivery attempt returns; the attempt may wait up to 30 seconds. |
| Preserve and revisit every readout | The competitor retains its latest readout data and the Firestore `readoutReceipts` collection provides idempotency receipts. The dashboard event stream displays up to 16 events. | There is no chronological, per-readout UI history. Competitor state is not a history because a later readout overwrites the competitor's latest readout fields. Receipts are not currently an operator-facing correction queue. |
| Keep exceptions for later | Offline delivery failures remain in a durable retry queue with retry/remove actions. | This is a technical synchronization queue, not a human-resolution queue. Successful delivery of an unknown card removes its offline item, while the app keeps only one `pendingUnknownReadout` in memory. A later unknown readout replaces that item. |
| Make history rows reopen work | Event rows with a competitor can select that competitor. Unknown-card event actions navigate to registration/linking. | Event rows are not readout-history records and do not reliably reopen the original readout and its captured punches. Linking navigates away from the finish view. |
| Surface exception types consistently | Known competitors are updated to `OK` or `MP`; the selected runner detail can show missing/extra controls. Unknown cards return `unknownCardReadout`. | Class conflicts, duplicate SI assignments, unlinked competitors, manual review, and manual finish confirmation do not share a persistent issue model or counter. |

## Existing workflow

1. `SportidentSerialService` completes parsing the card and acknowledges the SI station before notifying full-card-readout listeners. The serial listener in `App.tsx` calls submission with `void`, so it does not await Firestore before returning to the hardware event loop.
2. `OfflineReadoutQueueManager.submitReadoutGuaranteed` assigns a client readout ID and stores the payload in the local queue before attempting delivery. Online delivery uses a timeout; failures remain in the queue with retry metadata and exponential retry delay. Permanent errors are identified by message matching and require manual retry or removal.
3. On a delivered known card, `handleReadoutResultFeedback` updates the competitor in memory, selects that competitor, and plays an `OK` or `MP` sound.
4. On an unknown card, the readout is recorded with an `UNKNOWN` receipt and returned to the app as `unknownCardReadout`. The app stores it in the single `pendingUnknownReadout` state. Registration/linking is handled in `EntriesRegistrationView`; the operator must navigate there to complete it.
5. `ReadoutDashboard` derives its inspected runner from the selected runner or latest competitor `readoutAt`. It displays runner details, status, splits, validation and a map-card action.
6. The section titled **Tävlingshändelser i realtid** is a short event stream, not a card-readout history. It shows at most 16 filtered events. A linked event selects a runner; an unknown-card event can navigate to entry creation.
7. The dashboard also includes offline-queue controls, competition KPIs, hardware test scenarios, online-punch entry, forest control-intake status and rental-card information. These are useful tools, but compete visually with the finish operator's primary result and next-card workflow.

## Current validation and error behavior

- `submitReadoutToFirestore` validates the SI number, card type, times and punches, finds an eligible competitor by SI number, and validates punches against the runner's class/course. A normal validation produces `OK` or `MP`; the MP explanation can show missing and extra controls.
- An unknown SI number is stored as an `UNKNOWN` readout receipt and returned for later linking. The receipt is part of the idempotency mechanism and must not be repurposed in a way that weakens duplicate-readout protection.
- The readout update currently uses legacy assignment handling and chooses an eligible competitor from matching SI-number entries. The readout path does not surface duplicate assignment or class-conflict outcomes as first-class operator cases. Do not silently link a conflicting card to an arbitrary runner in the redesign.
- Firestore/delivery errors are caught by the offline queue and displayed in its synchronization banner/item list. The code also catches local-storage and IndexedDB persistence errors without surfacing them. The redesign should distinguish a saved-but-not-synced readout from a readout that could not be durably saved.
- A response that is merely queued offline currently plays registration feedback and returns without adding a result to the latest-readout area. A delayed response can arrive after a newer card has been read.

## Approved layout proposal

Place the operational workstation first in the view. Keep hardware configuration and administrative utilities below it or in a collapsible **Verktyg** area.

### Zone 1 — Latest readout

Always visible, compact enough to leave the readout device controls accessible, but visually dominant. Update it immediately when a card is parsed, then enrich the same item as matching, validation and Firestore delivery complete.

Display:

- Outcome icon and concise result: `OK`, `MP`, `Okänd SI`, `Ej kopplad`, `Klasskonflikt`, `Dubblett` or `Synkar`.
- Competitor name and class when safely matched; otherwise SI number.
- Status, elapsed time, place and Bom when applicable.
- For MP, a short reason such as `Saknar kontroll 45`.
- Separate delivery state such as `Sparad lokalt`, `Synkar` or `Synkad`; do not confuse it with race result status.

Never replace a newer card with a slower response to an older card. Order the display by capture sequence/time, not network completion time. Retain the full readout payload and stable client readout ID for the associated history item.

### Zone 2 — Action area

Show only when the focused item has an operator action. Make the action area non-modal and non-blocking: no overlay, required confirmation step, navigation, or focus-stealing dialog on readout.

Possible actions:

- Select/link the correct competitor for an unknown or unlinked card.
- Select/correct class for a verified class conflict, with a clear preview of revalidation.
- Resolve a duplicate SI assignment by explicitly selecting the intended competitor; never choose one silently.
- Confirm or correct finish time through the existing manual-finish flow when needed.
- Save, cancel, or defer. Deferring leaves the issue unresolved and available in history/queue.

Do not change a competitor's class or SI-card ownership merely because another class/course appears to fit the punches. Require an explicit, authorized action and preserve the existing SI-assignment and atomic matching safeguards.

### Zone 3 — Readout history

- Append one item for every physical card read, including `OK`, `MP`, unknown and delivery-pending outcomes.
- Newest first; default to 30 items with user-selectable 20/30/50 (or another agreed set).
- Every row is keyboard accessible and clickable. Clicking focuses the original item and reopens its correction/review area without stopping subsequent reads.
- Show identity/SI, outcome, and resolution state at a glance. Indicate whether the readout is still syncing.
- Offer **Show only unresolved**. The unresolved counter counts human-action cases, not the technical offline-delivery queue.
- Keep the live history bounded in the UI; retain unresolved cases until resolved even when they age out of the visible recent-history limit.

## Proposed workflow

1. **Capture:** after the reader has completed and acknowledged the card, create an item keyed by the existing/generated `clientReadoutId`, persist its raw payload using the durable local queue, append it to history, and make it the latest item.
2. **Match and validate:** process the readout independently. Produce an explicit outcome and zero or more issue types. A clean match updates the competitor using the current transaction/receipt protections. An ambiguity creates a case instead of an arbitrary mutation.
3. **Feedback:** immediately show the SI number and `Läser in`/`Synkar`; then update the same history item with `OK`, `MP`, unknown, conflict or delivery state. Sound feedback should reflect readout outcome and remain distinct from connectivity feedback.
4. **Continue:** keep the reader ready. Do not open the registration view, block the card controls, require a dialog, or wait for an exception to be resolved.
5. **Resolve later:** operator selects a history row or unresolved queue item, reviews original readout data and candidates, then saves or cancels. Resolution is tied to that item's receipt/readout ID and must be idempotent.
6. **Close the case:** decrement the outstanding count only after an explicit successful resolution or authorized dismissal. A deferred item remains outstanding.

## Outstanding-item model

Keep technical delivery state and human issue state separate:

- **Delivery state:** `LOCAL_SAVED`, `SYNCING`, `SYNCED`, `RETRYABLE_ERROR`, `PERMANENT_ERROR`.
- **Resolution state:** `NONE`, `OPEN`, `IN_PROGRESS`, `RESOLVED`, `DISMISSED`.
- **Issue types:** at minimum `UNKNOWN_CARD`, `UNLINKED_COMPETITOR`, `CLASS_CONFLICT`, `DUPLICATE_ASSIGNMENT`, `MP_REVIEW`, `MANUAL_FINISH_REVIEW`.

The precise set of issues that count as action-required should be finalized before implementation. At minimum, the cases explicitly identified above must be filterable and durable. An ordinary MP should remain `MP` as a race result; any human review state is separate and must not change its result status.

The current `readoutReceipts` documents are used for idempotency and store payload identity/status. Prefer adding a separate, staff-only case/status record keyed by receipt ID (for example under the competition) rather than changing receipt matching semantics. Before choosing the collection/path, inspect Firestore rules and existing receipt retention/access behavior. Raw SI numbers, punch data and correction details must not be exposed through public-result projections.

## Component changes proposed

| Component/module | Proposed responsibility |
|---|---|
| `ReadoutDashboard.tsx` | Reorder into the operational three-zone layout; keep hardware/test tools secondary. Remove reliance on a selected competitor as the definition of “latest readout.” |
| `App.tsx` | Own a latest-readout item and bounded recent history; append by capture order; merge asynchronous match/delivery updates by readout ID. Keep the hardware listener non-blocking. |
| `offlineReadoutQueue.ts` | Continue to own durable delivery/retry state. Expose readout ID and delivery transitions so they can be merged into history. Keep it separate from operator-resolution state. Surface persistence failure explicitly rather than silently presenting a saved state. |
| `firebase.ts` readout submission | Preserve transaction receipts and idempotency. Return an explicit outcome keyed to the readout ID and distinguish unknown, matched OK/MP and assignment conflict. Add server-checked resolution operations for cases; do not make a client-side competitor patch a substitute for atomic assignment validation. |
| Readout subcomponents | Add focused latest-result, history-list and action/case controls, either as small components in the existing dashboard or extracted files if useful. Keep them controlled by the parent state so a row can reopen the exact case. |
| `EntriesRegistrationView.tsx` | Reuse/refactor existing unknown-card form logic into a callback-based correction workflow usable without navigating away. Preserve direct-entry behavior for ordinary registration. |
| Firestore rules and types | Add narrowly scoped staff access for durable case metadata, if needed. Keep raw readout/case data private from public portal projections. |

## Keyboard and scanner workflow

- The SPORTident serial/WebUSB reader remains the primary scanner; preserve its existing protocol acknowledgement and do not await Firestore delivery in the hardware event callback.
- Do not auto-open a modal, move focus into a correction form, or switch tabs when an exception arrives. Leave the card reader ready for the next competitor.
- The latest card can be reviewed using keyboard navigation. Provide a predictable shortcut to focus/select the latest history row and ordinary Tab/Enter/Space operation for all actions; avoid global shortcuts that intercept the scanner's keyboard-wedge characters.
- If keyboard-wedge scanning is supported, keep a dedicated SI input continuously available and submit only after a complete value/Enter. Prevent action-form focus changes from consuming the next scan. Confirm whether this mode is currently supported before implementation; the audited readout path is the SPORTident serial listener.
- Success/failure sounds should be short and distinguish result status from delivery failure. Visual status remains authoritative and accessible.

## Migration strategy

### Phase 0 — Contract and safety checks

- Confirm readout receipt rules, retention and current SI-assignment invariants.
- Define result/issue/delivery state enums and the criteria for an outstanding item.
- Confirm whether MP always creates an action case or only a review case in the operator queue.
- Add tests around readout ID idempotency, duplicate assignment conflicts and out-of-order responses before changing UI behavior.

### Phase 1 — Capture-first UI, no backend schema change

- Add a local latest item and bounded recent history, keyed by readout ID and appended before asynchronous delivery.
- Merge delivery and matching results by ID; never reorder the latest card by completion time.
- Display offline/queued status separately from result status.
- Keep existing transaction, validation, receipt and durable offline queue behavior unchanged.

### Phase 2 — Durable human-resolution queue

- Add private case metadata with readout ID, issue type, resolution state and timestamps, subject to Firestore rule review.
- Add unresolved counter/filter and clickable history rows.
- Ensure successful delivery does not erase an outstanding human case.
- Ensure unresolved cases survive reloads and remain available beyond the bounded visible history.

### Phase 3 — Non-blocking corrections

- Reuse unknown-card registration/linking inside the readout view.
- Add explicit candidate selection for class/assignment conflicts and link to the existing manual-finish flow.
- Apply each correction through validated, authorized, idempotent operations; preserve raw card data and audit resolution history.
- Keep defer/cancel independent of subsequent reads.

### Phase 4 — Rollout and removal of duplicated UI

- Pilot at a test event with rapid consecutive reads, MP/unknown cases, offline delivery and delayed/reordered responses.
- Compare receipt counts, displayed history and resolved/unresolved counts for every test readout.
- Keep the old event stream and registration route available during pilot as fallback, then remove duplicate correction entry points only after parity is verified.

## Acceptance criteria

- A card read is visible in Zone 1/history immediately after capture, before Firestore response.
- A slow, failed, unknown or ambiguous readout never disables or diverts the next card read.
- 100 sequential reads with 3 exceptions yield 100 distinct history items and 3 outstanding cases; none is overwritten by later reads or reordered by response timing.
- Clicking any unresolved row reopens that exact readout and correction context.
- Technical offline count and human outstanding count are independent and correct.
- Resolved cases disappear from the unresolved filter/counter but remain available in history according to retention policy.
- Replayed delivery of the same readout ID does not duplicate the competitor update or case.
- Duplicate assignment/class conflicts cannot silently attach a card to the wrong competitor.
- Public views receive no raw competitor/readout/case documents.

## Files audited

- [ReadoutDashboard.tsx](./src/components/ReadoutDashboard.tsx)
- [App.tsx](./src/App.tsx)
- [offlineReadoutQueue.ts](./src/services/offlineReadoutQueue.ts)
- [sportidentWebSerial.ts](./src/services/sportidentWebSerial.ts)
- [sportident.ts](./src/types/sportident.ts)
- [firebase.ts](./src/firebase.ts)
- [readoutValidation.ts](./src/utils/readoutValidation.ts)
- [EntriesRegistrationView.tsx](./src/components/EntriesRegistrationView.tsx)
