# Competitor and Readout Architecture

**Status:** Design for the planned Firestore-authoritative migration.  
**Scope:** Competitors, readout receipts, online-punch receipts, result projections, and their temporary Express/WebSocket compatibility paths.  
**Non-goal:** This document does not migrate or redefine station configuration, ROC, live-event storage, WebSocket transport, or the ownership of courses/classes. Those remain related dependencies or later migration phases.

## 1. Goals and invariants

The migration will make Firestore the canonical store for competitor records and accepted readout and online-punch inputs. Express may temporarily maintain a compatibility mirror, but it must not be a competing writer.

Required invariants:

1. A successful response means Firestore has durably accepted the operation.
2. A retry of the same queued operation cannot apply it twice.
3. A known readout receipt and its competitor update are committed atomically.
4. An unknown-card readout is durably recorded without inventing a competitor.
5. Competitor document IDs remain stable.
6. Results can be rebuilt from canonical entry data, receipts, and the applicable course, class, station, and emergency configuration.
7. Stale snapshots, JSON restore, cloud-export, or Express mirrors cannot overwrite or delete newer Firestore competitor records.
8. A compatibility mirror is updated only after the canonical Firestore write succeeds.

## 2. Firestore ownership model

### Firestore owns

- Competitor identity, entry data, registration and rental-return state.
- The current competitor race-state projection.
- Immutable readout receipts.
- Immutable online-punch receipts.
- Durable processing outcomes and the data required to replay or recalculate results.
- Competitor and finished counts, as projections maintained consistently with mutations.

### Express temporarily owns

- A compatibility/cache representation for legacy routes, reports, calculations, and WebSocket payloads during rollout.
- Existing live-event feed storage, ROC polling state, and any station or emergency responsibilities not yet migrated.

Express compatibility data is disposable and rebuildable from Firestore where supported. It must not be submitted as an authoritative full-season competitor snapshot after the relevant migration phase.

### Write authority

For a migrated operation, the order is:

```text
Client or trusted server operation
    → Firestore transaction / write
    → update local UI and/or Express compatibility mirror
    → publish compatibility/live update
```

If Firestore fails, the operation must not be reported as successful. Offline readouts and punches remain in the durable client queue for retry with the same operation ID.

## 3. Data model

### 3.1 Competitor document

Path:

```text
competitions/{competitionId}/competitors/{competitorId}
```

Keep the existing document path and IDs. A competitor document represents the current entry and its current race-state projection; it is not the full audit history of all received card data.

#### Canonical entry and administrative fields

- `competitorId`, `competitionId`
- `bib`, `fullName`, `club`, `classId`
- `siNumber`, `cardSeries`
- `isRentalCard`, `isBorrowedCard`, `rentalReturned`
- `isSelfRegistered`, if the feature is confirmed and supported in the application model
- `allocatedStartSec`
- `manualFinishTimeSec` and other explicit official overrides, if present

`isBorrowedCard` exists in the application model but is not currently included in the Firestore competitor mapping/rules. It must be added to the Firestore schema and authorization rules if borrowed-card behavior is to survive reload and remain available to server logic.

#### Materialized current race state

The existing model stores fields including:

- `status`
- `checkTimeSec`, `startTimeSec`, `finishTimeSec`
- `runningTimeSec`
- `readoutAtIso`
- `punchCodes`, `punchTimes`

These are useful current-state projections for UI and queries. Result fields must be updated through the canonical operation path and be reproducible from receipts plus configuration. Explicit official decisions such as a manual finish or an intentional DNS/DNF state must remain distinguishable from ordinary calculated values so recalculation does not erase them.

The current rules encode nullable seconds as an integer sentinel (`-1`). Retain that encoding during migration unless the schema and every reader/writer are changed together.

#### Firestore metadata

- `ownerUid`
- `createdAt`
- `updatedAt`

These are document/authorization metadata, not race-domain inputs. `updatedAt` must not be treated as the timestamp of a punch or readout.

### 3.2 Readout receipt

Path:

```text
competitions/{competitionId}/readoutReceipts/{clientReadoutId}
```

The existing collection is an immutable record of a submitted card readout and its final ingestion outcome. Current fields include:

- Receipt identity: `receiptId`, `competitionId`, `ownerUid`, `clientReadoutId`
- Card identity: `siNumber`, `cardSeries`, `stationCode`
- Original readout times: `checkTimeSec`, `startTimeSec`, `finishTimeSec`
- Original input: `punchCodes`, `punchTimes`, `rawHex`
- Outcome: `status` (`UNKNOWN` or `PROCESSED`), `competitorId`
- `createdAt`

The receipt is the source of the original readout input and the evidence that the operation was accepted. Do not rely on the competitor document alone to reconstruct raw history.

### 3.3 Online-punch receipt

Path:

```text
competitions/{competitionId}/stationPunches/{clientPunchId}
```

The existing collection records each online/radio punch, including:

- Punch identity: `punchId`, `clientPunchId`, `competitionId`, `ownerUid`
- `siNumber`, `stationCode`, `punchTimeSec`, `rawHex`
- Captured `stationName` and `stationFunction`
- Matched `competitorId`, when one exists
- Derived/context fields such as `runningTimeSec` and `isPrewarning`
- `createdAt`

The captured station function is important historical input. Recalculation must not infer the meaning of an old punch from current station configuration.

## 4. Field ownership and derivation

| Current application field | Target treatment |
|---|---|
| Identity, bib, class, SI number, name, club, card series | Canonical competitor fields |
| Rental, borrowed-card, and return flags | Canonical competitor fields |
| Allocated start time | Canonical competitor field |
| Manual finish and explicit official overrides | Canonical competitor fields, separate from calculated values |
| Status and effective check/start/finish/running times | Materialized current competitor projection; updated through canonical transactions and reproducible where applicable |
| Original card punches, card times, raw hex, client ID, receive timestamp | Immutable readout receipt |
| Online punch facts and station function at receipt time | Immutable station-punch receipt |
| Validation details, missing/extra controls, splits, rogaining points | Derived; recompute from receipts and current/versioned inputs |
| Emergency-adjusted card punches | Derived from original readout punches and applicable time offsets |
| Radio splits | Derived from station-punch receipts |
| `lastSeenControl`, `lastSeenTimeSec` | Derived/cache-only summary; do not make canonical source data |
| `readoutAt` | Latest-readout projection; receipt `createdAt` is the authoritative event timestamp |
| `processedClientIds` | Remove as a second idempotency store; replace with receipt document IDs |
| Full `rawReadout` object on competitor | Remove as canonical storage; temporarily reconstruct for legacy consumers |

If derived fields are cached in Firestore for UI or query performance, make their source/version explicit enough to invalidate and rebuild them. Avoid storing two competing meanings in `cardPunches`; receipts hold original punches, while adjusted punch lists are calculation output.

## 5. Idempotency strategy

### Stable operation IDs

- Generate `clientReadoutId` or `clientPunchId` once when creating the client queue item.
- Persist that ID with the queue item and reuse it across retries, timeouts, reloads, and manual retry.
- Use a unique document ID in the corresponding receipt collection.
- Do not generate a new ID after a timeout: the original transaction may have committed even if the response was lost.

### Duplicate handling

The transaction reads the receipt document before writing:

- If it exists, return the recorded outcome and linked competitor ID.
- Do not apply competitor updates, increment counters, or emit a second logical event.
- If it does not exist, process and write the receipt with the competitor update in the same transaction.

### Scope and retention

Receipt IDs are scoped by competition and collection. Readout and online-punch IDs should also use distinguishable prefixes for operational clarity. Receipt retention must be at least as long as offline queue retry and result-audit requirements; deleting a receipt makes a delayed retry appear new.

## 6. Readout receipt lifecycle

```text
Card captured
    → durable local queue item with stable ID
    → Firestore transaction
         ├─ failure before commit: no receipt; retain item and retry same ID
         ├─ existing receipt: return its existing outcome; no duplicate mutation
         ├─ no matching competitor: write UNKNOWN receipt
         └─ matching competitor: write PROCESSED receipt + update competitor atomically
```

### `PROCESSED`

The receipt and competitor update are committed together. The client removes the queue item only after the committed outcome is confirmed. A repeated submission returns the existing result and cannot count the same finish twice.

### `UNKNOWN`

Write an immutable `UNKNOWN` receipt when the input is valid but no eligible competitor can be matched. Do not create a placeholder competitor as a side effect of receipt ingestion.

An operator can later create or identify the correct competitor and explicitly link/process the stored receipt. That resolution should be a separate idempotent operation or resolution record; it should not rewrite the immutable receipt to imply it was originally processed against that competitor. The application must make the resolution outcome visible and recoverable.

### Invalid or permanently rejected submissions

Validate malformed data before creating a receipt. A rejected request must not be represented as successfully processed. Preserve the client queue item and show a useful error when the result is not safely known. If a valid request commits but its response is lost, the retry discovers the receipt and returns its outcome.

## 7. Atomic transaction strategy

### Known readout

One Firestore transaction should:

1. Read the competition and receipt.
2. Return the existing receipt outcome if already present.
3. Verify competition/readout eligibility.
4. Read the current competitor document and validate it still exists and is eligible.
5. Read or verify the version of any configuration required for calculation.
6. Calculate the proposed projection from transaction-current state and accepted readout input.
7. Create the immutable `PROCESSED` receipt.
8. Update the competitor projection.
9. Update affected competition counters.
10. Commit all writes together.

If any check or write fails, neither the receipt nor the competitor update is committed. A retry with the same ID is safe.

### Unknown readout

In one transaction, check the competition and receipt, then create the immutable `UNKNOWN` receipt. No competitor or finish counter is changed.

### Online punch

Apply the equivalent transaction pattern to `stationPunches`: receipt check, current competition/competitor reads, receipt creation, participant projection update, and any counter update in one commit.

### Stale reads and concurrency

Current submission helpers load a full season before beginning their transaction. The target implementation must ensure that state used to write the competitor projection is based on transaction-current data or is guarded by a version/precondition. Course, class, station-function, and emergency configuration used for validation must also have a defined consistency rule. Test concurrent readout, finish punch, manual finish, and status changes.

## 8. Result calculation

Result calculation should consume:

- Canonical competitor entry and explicit official overrides.
- Immutable `readoutReceipts` and `stationPunches`.
- Firestore-owned courses and classes.
- A clearly owned/versioned emergency configuration and time-offset settings.
- The station function captured on each station-punch receipt.

It should produce the competitor’s current status, effective times, adjusted punches, validation, split/rank projections, and competition counts. Validation, adjusted punches, `radioSplits`, `lastSeenControl`, and `lastSeenTimeSec` must be rebuildable.

During rollout, compare Firestore results with the existing Express calculation before removing the legacy calculator. Cover standard and forked courses, rogaining, missing/extra controls, broken controls, time offsets, borrowed cards, stale card start times, manual finishes, DNS/DNF, duplicate submissions, and concurrent punches/readouts.

## 9. Live-event implications

Competitor and receipt ownership does not by itself migrate the existing `events[]` feed. Punches, readouts, direct entries, manual finishes, and emergency actions currently create live events in Express; Firestore ingestion helpers do not fully replace that feed.

During transition:

- Publish a compatibility event only after the canonical Firestore commit succeeds.
- Derive a stable event identity from the accepted operation, such as `punch:{clientPunchId}` or `readout:{clientReadoutId}`, to avoid duplicate events on retry.
- Do not let an Express event imply a Firestore write succeeded.
- Keep live-event storage migration separate. When implemented, events should be append-only and reference their source receipt or mutation.
- Define ordering and retention before replacing the current bounded feed.

WebSocket may continue carrying compatibility snapshots during rollout, but authenticated clients must not let an Express competitor snapshot replace newer Firestore-owned competitor state.

## 10. Migration phases

### Phase 0 — Guardrails and baseline

- Confirm deployed Firestore schema/rules and existing competitor IDs.
- Measure current Firestore/Express differences for representative competitions.
- Back up data for recovery and audit.
- Stop snapshot-driven full-season sync from updating or deleting existing Firestore competitor records from `seasonDb`. Keep a deliberate, reviewed import path for initial migration or repair.

### Phase 1 — Non-result competitor fields

- Make low-risk admin mutations such as rental-return flags Firestore-first.
- Mirror only after successful Firestore writes.
- Verify role rules and preserve existing IDs.

### Phase 2 — Competitor CRUD and reads

- Use Firestore as the authenticated read source.
- Move create, update, delete/retire, direct entry, and imports to Firestore-first paths.
- Use Firestore for SI conflict checks and counters.
- Prevent Express snapshots, cloud-export, restore, or JSON persistence from becoming write sources.

### Phase 3 — Readout receipts

- Make the durable offline queue use the Firestore receipt path exclusively.
- Verify stable IDs across retry, timeout, reload, and manual retry.
- Persist `UNKNOWN` receipts and implement explicit recovery/linking.
- Ensure known receipt and competitor update are atomic.
- Do not dual-process queue items through Express and Firestore.

### Phase 4 — Online punches and result-affecting mutations

- Make Firestore punch receipts the sole canonical ingestion path.
- Move draw/start assignment, status corrections, manual finish, and other result-affecting writes to Firestore-first operations.
- Coordinate receipt writes, competitor projections, and counters.
- Stop relying on `processedClientIds` for migrated operations.

### Phase 5 — Recalculation and compatibility

- Rebuild results from Firestore receipts and canonical competition data.
- Compare results against the Express calculator; address mismatches before cutover.
- Reconstruct compatibility fields for legacy views only as needed.
- Ensure WebSocket and public/admin views consume committed Firestore state or a versioned mirror.

### Phase 6 — Remove competitor/readout JSON ownership

- Remove competitor and raw-readout writes from `seasonDb`.
- Retain explicit backup/export only as a recovery format, not a synchronization authority.
- Verify restart, offline recovery, restore, and counter reconciliation before removing remaining compatibility paths.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Stale `cloud-export` or full-season sync overwrites/deletes newer competitors | Disable snapshot-driven competitor writes/deletes before enabling Firestore-first mutations. |
| Timeout after commit causes duplicate finish/result | Stable receipt ID; transaction checks receipt before changing state. |
| Receipt commits but participant update does not, or vice versa | Commit receipt and competitor projection in one transaction. |
| Unknown card disappears or gets processed repeatedly | Persist immutable `UNKNOWN` receipt and implement explicit, idempotent resolution. |
| Concurrent punch/readout/manual edit uses stale competitor state | Re-read current competitor in transaction; add version/precondition where needed. |
| Calculation changes reinterpret old inputs | Preserve original receipt data and captured station function; version calculation/configuration inputs if historical reproducibility is required. |
| `isBorrowedCard` is lost during load/sync | Add it consistently to Firestore serialization, decoding, and rules before relying on Firestore as sole source. |
| Duplicate or incorrect participant counts | Update counts transactionally and provide a reconciliation procedure from competitor documents. |
| JSON rollback overwrites canonical records | Roll back UI/read paths only; hydrate the Express cache from Firestore. Do not reactivate JSON as writer. |
| Live feed claims an uncommitted operation | Emit compatibility events only after Firestore commit and derive stable event IDs from receipts. |
| Firestore outages disrupt live race operations | Retain operations in the durable client queue; show pending/failure state and never report uncommitted work as successful. |

## 12. Rollback strategy

1. Before cutover, create and verify a recovery backup and compare Firestore competitor IDs/counts with the current mirror.
2. During migration, preserve Express only as a **one-way mirror** of Firestore for migrated fields.
3. If a UI or listener regression requires rollback, revert the UI/read path while leaving Firestore writes canonical; hydrate Express from Firestore before using legacy reads.
4. If a Firestore write fails, keep the queued operation and retry with the same ID. Do not fall back to a JSON write that may later overwrite Firestore.
5. Never re-enable snapshot-driven competitor updates/deletes after newer Firestore data exists. Use explicit, reviewed repair/import procedures instead.
6. Reconcile from competitor documents and immutable receipts after rollback. Rebuild disposable caches and derived results from those canonical records.

Rollback of the application version can be relatively contained while Express remains a compatible reader. Rollback that changes the **writer** back to JSON is high risk and is not an acceptable default recovery mechanism.

## 13. Exit criteria

Competitors and readouts are Firestore-authoritative only when all of the following hold:

- Every competitor create, update, delete/retire, import, draw, rental-return change, manual time, punch, and readout path writes Firestore first.
- The competitor schema preserves all required fields, including borrowed-card semantics.
- Readout and punch IDs are stable across offline retries and restarts.
- Known readout receipt and competitor changes are atomic.
- Unknown receipts are durable and recoverable through an explicit resolution flow.
- Duplicate receipts cannot repeat result, status, counter, or live-event changes.
- Full-season sync, cloud-export, cloud-hydrate, JSON restore, and authenticated Express snapshots cannot overwrite or delete canonical competitor data.
- Results and derived fields can be rebuilt from canonical data and the defined configuration inputs.
- Live events are published only for committed changes and are duplicate-safe.
- Competitor counts reconcile with stored competitor documents.
- Tests cover offline/timeout retries, concurrent submissions, server restart, result recalculation, and rollback.

Until these criteria pass, Firestore support should be described as partial or transitional rather than complete competitor/readout ownership.
