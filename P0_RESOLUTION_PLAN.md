# Competitor and Readout P0 Resolution Plan

**Status:** Required design decisions before implementation
**Date:** 2026-11-09
**Scope:** Firestore-authoritative competitors, readouts, online punches, result-affecting actions, historical backfill, and live-event delivery.
**Prerequisites:** [COMPETITOR_READOUT_ARCHITECTURE.md](./COMPETITOR_READOUT_ARCHITECTURE.md), [SEASONDB_RETIREMENT_PLAN.md](./SEASONDB_RETIREMENT_PLAN.md), and the architecture review findings.

## 1. Decisions and invariants

This plan resolves the P0 design gaps as follows:

1. Firestore is the only writer and source of truth for migrated operations.
2. The browser may read authorized Firestore data and submit operation requests, but does not directly write canonical competitor, receipt, counter, assignment, or outbox documents.
3. A trusted callable backend validates the user's current Firebase Auth identity and Firestore role, then commits each accepted operation in a Firestore transaction.
4. SI-card matching is through a deterministic assignment document read in the same transaction as the competitor and receipt.
5. Existing readout data is backfilled idempotently; missing historical payloads are not fabricated.
6. Every committed mutation that must appear in the live feed writes an outbox event in the same transaction. Delivery is at-least-once and consumers deduplicate by event ID.
7. Competitor documents are authoritative. `competitorCount` and `finishedCount` are transaction-maintained projections, with a reconciliation job as a repair mechanism.
8. A rollback may revert readers or application code, but must not silently restore JSON/Express as a competing writer.

The Express routes that currently mutate the same operational state must be disabled, routed through the same trusted operation service, or fenced before Firestore-first writes are enabled. No dual-writer period is permitted.

## 2. Authority boundary and role policy

### 2.1 Execution boundary

All authoritative writes go through a trusted Firebase callable backend using the Admin SDK. The backend:

- Verifies the Firebase ID token and derives the UID from the verified token; it never trusts a client-supplied UID or role.
- Loads the current admin/official role from Firestore for each operation. Role revocation takes effect on the next request.
- Validates the competition, lifecycle state, input shape, expected versions, and operation ID.
- Commits canonical documents and any required counters/outbox records atomically.
- Returns success only after the Firestore commit succeeds.

Firestore client rules deny direct client writes to the migrated competitor, receipt, assignment, counter, and outbox paths. Authorized clients may read the relevant data directly from Firestore. Public clients receive only the existing safe public projection, not the private competitor collection.

The browser may perform local validation, keep a durable offline queue, display pending state, and call the backend. Those actions are not authoritative mutations. A queued readout/punch keeps the same operation ID through retries and app restarts.

### 2.2 Operation/role matrix

`SUPER_ADMIN` and `RACE_ADMIN` are the administrative tiers. Official roles are scoped operational permissions and do not imply general competitor administration.

| Operation | Roles permitted | Client behavior | Trusted backend responsibility |
|---|---|---|---|
| Read competitor data | `SUPER_ADMIN`, `RACE_ADMIN`, and verified users holding an operational role (`START`, `READOUT`, `FOREST`, `SPEAKER`) | Direct authorized Firestore read; public view uses a sanitized projection | Enforce read rules and keep private fields out of public projections |
| Create, edit, or remove/retire competitor | `SUPER_ADMIN`, `RACE_ADMIN` | Submit a request; no direct write | Validate fields/references, SI assignment, bib allocation, lifecycle state, counters, and outbox |
| Change a competitor's SI number/card series | `SUPER_ADMIN`, `RACE_ADMIN` | Submit a request | Atomically transfer the SI assignment and update the competitor; reject conflicts |
| Direct entry | `SUPER_ADMIN`, `RACE_ADMIN` | Submit a request; preserve a stable request ID | Create competitor, SI assignment, bib sequence, counters, optional runnerDb learning, and outbox as one operation or a resumable idempotent workflow |
| Eventor or bulk import | `SUPER_ADMIN`, `RACE_ADMIN` | Start an import job; cannot write imported rows directly | Fetch/parse external data server-side where applicable; validate and apply rows idempotently in bounded transactions |
| Submit card readout | `SUPER_ADMIN`, `RACE_ADMIN`, `READOUT`, `FOREST`, `SPEAKER` | Persist and retry a durable queue item with its original ID | Match SI assignment, validate, write receipt and competitor projection together; record unmatched valid input as `UNKNOWN` |
| Submit online punch | `SUPER_ADMIN`, `RACE_ADMIN`, `START`, `READOUT`, `FOREST` | Persist and retry a durable queue item with its original ID | Deduplicate, capture station function, update competitor if matched, and write receipt/outbox atomically |
| Manual finish/time correction | `SUPER_ADMIN`, `RACE_ADMIN`, `READOUT`, `FOREST` | Submit an explicit correction request | Validate reason/value and expected competitor version; update official override, result projection, finish counter, and outbox atomically |
| Change emergency configuration | `SUPER_ADMIN`, `RACE_ADMIN` | Submit a configuration change request | Validate and version the configuration; create an auditable change event |
| Recalculate after emergency/configuration change | `SUPER_ADMIN`, `RACE_ADMIN`, `READOUT`, `FOREST` | Request a recalculation job and observe its status | Run a versioned, resumable calculation; publish results only when the complete run is valid |

These are the initial least-privilege rules. They assume the current club-level role model; they do not claim roles are competition-scoped. If competition-specific grants are introduced, model and test that scope explicitly. If the deployed role model intentionally grants a narrower operation to a different role, change the matrix and its tests before implementation; do not broaden Firestore rules to make a client-side write succeed.

### 2.3 Direct-entry and import boundaries

Bulk imports are not one unbounded transaction. Each row has a stable import operation ID and an idempotent bounded commit. The import job records progress and rejected rows; a retry resumes from the same IDs. A partially completed import is visible as a partial job, not reported as an all-or-nothing success.

External Eventor credentials and network calls remain server-side. Runner learning or updates to `runnerDb` must follow that domain's existing Firestore authority and must not be used to overwrite a conflicting runner record silently.

## 3. Atomic competitor and SI-card matching

### 3.1 Firestore model

Keep existing competitor IDs and paths. Add the following deterministic documents:

```text
competitions/{competitionId}/competitors/{competitorId}
competitions/{competitionId}/siCardAssignments/{siNumber}
competitions/{competitionId}/sequences/entries
competitions/{competitionId}/readoutReceipts/{clientReadoutId}
competitions/{competitionId}/stationPunches/{clientPunchId}
```

An assignment document has this shape:

```ts
{
  competitionId: string;
  siNumber: number;          // normalized decimal identity, and document ID
  cardSeries: string;        // descriptive/type metadata, not part of uniqueness
  competitorId: string;
  state: 'ASSIGNED';
  assignmentVersion: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

The competitor retains `siNumber` and `cardSeries`. The assignment is the authoritative reverse lookup and must point to a competitor whose fields agree. A deterministic decimal document ID avoids query-based matching. SI number is the uniqueness key within a competition; `cardSeries` is validated and retained as metadata, but cannot make an otherwise duplicate SI number unique. A readout whose reported series differs from the assignment still matches by SI number, records the observed series on the receipt, and raises a visible discrepancy; it must not redirect the readout or silently change the competitor's card-series field.

The entry sequence document owns the next bib value. Allocate a bib by incrementing this sequence in the same transaction that creates the competitor. Never calculate a new bib from a pre-transaction collection snapshot.

### 3.2 Uniqueness and lifecycle rules

- At most one competitor may be assigned a given SI number in a competition, regardless of competitor status. Do not silently allow reuse after a competitor finishes; the card may still be needed to identify a delayed readout.
- An SI assignment is created with the competitor and retained for its competition lifetime.
- An SI change is one transaction: read the competitor, old assignment, and target assignment; verify the old mapping; reject if the target maps to another competitor; delete the old assignment and create the new one; update the competitor and its version.
- A competitor removal before race processing is allowed only if there are no accepted receipts or punches referencing it. Otherwise retain/archive the competitor and assignment; do not orphan its operational history.
- Duplicate assignments found during initial backfill block cutover until an administrator resolves them. Do not choose a winner based on document order or status fallback.

Registration and SI changes are trusted-backend transactions. Two concurrent registrations for the same SI number both read the same deterministic assignment document; Firestore transaction conflict/retry ensures one commits and the other retries and returns a conflict. The transaction also reserves the bib, so concurrent registrations cannot allocate the same bib.

### 3.3 Readout matching

For each readout, the backend transaction:

1. Reads the competition, stable receipt ID, SI assignment, and any relevant configuration/version documents.
2. If the receipt already exists, returns its recorded outcome without applying another mutation.
3. Rejects a completed/closed competition or malformed payload according to the policy below.
4. If the assignment exists, reads that exact competitor document and verifies its SI number, competition, and current version. A card-series mismatch is recorded and flagged as described above; SI number remains the lookup key.
5. Reads the exact class, course, and emergency/configuration documents (or an immutable versioned input snapshot) required to calculate this readout. It calculates from those transaction-read inputs, not from a previously loaded Express/client snapshot. If the input set is too large for a safe transaction, use a versioned calculation job and do not publish partial results.
6. Creates the immutable `PROCESSED` receipt and updates the competitor/result projection, finish projection, and outbox atomically.
7. If there is no assignment, creates an immutable `UNKNOWN` receipt and an outbox event describing the accepted unknown readout. It does not invent a competitor.

The SI assignment read is part of the transaction's read set. If a registration concurrently creates the assignment, a transaction that observed the missing assignment conflicts and retries. On retry it sees the new assignment and processes the readout against that competitor. If the readout committed as `UNKNOWN` first, later retries return the same `UNKNOWN` outcome. Linking it later is a separate idempotent operator action with its own audit record and outbox event; it does not rewrite the original receipt.

An already accepted receipt is immutable even if a competitor's SI number later changes. Its recorded `competitorId` and original SI input preserve the historical match.

## 4. Historical migration and retirement of `processedClientIds`

### 4.1 Migration fence and source inventory

Before backfill:

1. Inventory all competitions, competitor IDs, SI assignments, `rawReadout` payloads, `processedClientIds`, and available JSON backups.
2. Capture a read-only, timestamped source export and per-competition counts/checksums.
3. Stop or fence all legacy Express mutations and old client builds that can submit to the old routes. Drain online durable queues where possible. Any old client still allowed to write is a dual-writer risk and blocks cutover.
4. Record the migration epoch/version. Backfill code is privileged, scoped, logged, and never used as routine synchronization.

### 4.2 `rawReadout` backfill

`rawReadout` on a competitor contains only the currently retained readout archive; it is not assumed to be a complete history.

- Create one legacy receipt for each available `rawReadout`, preserving the exact SI number, card series where available, station, original punch data, raw hex, source receive time, and known competitor ID.
- Use an idempotent deterministic receipt ID. Prefer the original `clientReadoutId` when valid and unused; otherwise derive a stable ID from a versioned SHA-256 input containing competition ID, competitor ID, and canonicalized archived payload. Store the source and derivation version.
- Mark the receipt `source: 'LEGACY_BACKFILL'`, preserve the original receive timestamp separately as `sourceReceivedAt`, and record `migratedAt`. Do not claim that migration time was the race event time.
- If an archived payload is malformed or conflicts with an existing receipt, quarantine it with a reason for review. Do not overwrite an existing receipt.
- Backfill is create-only/idempotent. Running it twice must produce the same IDs and payloads.

This preserves all readout data still present in the source snapshot. It cannot restore older readouts that were already overwritten or discarded by the legacy model. The cutover report must state this limitation explicitly.

### 4.3 `processedClientIds` retirement

`processedClientIds` stores only a bounded list of IDs, not the operation payload or outcome. It cannot be converted into a fabricated receipt.

- For each retained legacy ID, create a deterministic tombstone at `competitions/{competitionId}/processedOperationIds/{sha256(operationId)}` with the original ID, `source: 'LEGACY_PROCESSED_ID'`, migration epoch, and `outcome: 'ALREADY_PROCESSED_UNKNOWN_DETAILS'`.
- The trusted backend checks both canonical receipts and these tombstones before accepting a legacy ID. New client operations use the receipt collections as their sole idempotency records.
- Keep tombstones indefinitely unless there is a proven maximum offline-queue lifetime and a version fence that rejects older clients. Do not expire IDs while old clients can still retry them.
- After reconciliation, remove the array from active `seasonDb` processing. Keep the read-only migration export for audit until the retention policy permits its disposal.

Because the old array was capped, IDs evicted before migration are unrecoverable. The migration must not imply that the tombstone set represents all historical operations.

### 4.4 Validation and reconciliation gates

Before enabling Firestore-first writes, produce and review a per-competition report that verifies:

- Every legacy competitor ID exists at the same Firestore document ID, or is explicitly recorded as an approved create/delete/repair.
- Every available `rawReadout` has exactly one matching receipt with the same canonical payload hash.
- Every retained `processedClientIds` value has exactly one tombstone or a matching existing receipt.
- No SI number maps to more than one competitor; each assignment agrees with the competitor's SI number and vice versa.
- Competitor and finish counts reconcile to the defined counting rules.
- Backfill `finishRecorded` only from explicit finish evidence (manual finish, stored finish time with verified provenance, or a finish punch). Ambiguous legacy statuses/timestamps are reported for review; do not infer a finish solely from `OK`, `MP`, `DNF`, or `PRELIMINARY_FIN`.
- Existing result projections can be recalculated from available canonical inputs; mismatches are listed and resolved or explicitly accepted.
- A second backfill run produces zero unexpected changes.

Compare both record counts and stable-ID/payload hashes. Counts alone do not prove data preservation. Any unexplained discrepancy, duplicate SI assignment, or missing payload blocks cutover.

## 5. Live-event outbox

### 5.1 Atomic event creation

Add a Firestore outbox collection scoped to competition:

```text
competitions/{competitionId}/outbox/{eventId}
```

Use deterministic event IDs derived from the committed source operation, for example `readout:{receiptId}:accepted`, `punch:{punchId}:accepted`, `competitor:{competitorId}:manual-finish:{operationId}`, and `emergency-recalc:{runId}:published`.

The canonical operation transaction writes the competitor/receipt/counter changes and the pending outbox document together. The outbox includes event ID/type, source operation/receipt ID, competitor ID when applicable, aggregate version, a minimal payload or payload reference, creation time, attempt count, delivery state, and lease fields. Do not place secrets or unnecessary personal data in a broad live-feed payload.

Each competitor mutation increments a monotonic `aggregateVersion`. Consumers use the version to ignore stale projection updates. Events for the same competitor are applied in version order; a consumer that sees a gap reloads the current canonical projection rather than guessing.

### 5.2 Delivery and recovery

A trusted worker claims pending events with a short lease in a transaction, delivers them to the live-event materialization/publisher, then marks them delivered. Delivery is **at least once**:

- A crash before delivery leaves an expiring lease; another worker retries after expiry.
- A crash after delivery but before marking delivered causes redelivery. The destination uses `eventId` as its unique key and treats a repeated ID as success without adding a duplicate.
- Failed attempts use capped exponential backoff with jitter. After a configured attempt threshold, move the event to an observable dead-letter state and alert operators; never delete or silently discard it.
- Operators can replay a dead-letter event using the same event ID. The destination's deduplication makes replay safe.
- Delivered outbox records are retained for the agreed audit/recovery period. Cleanup is separate from application delivery.

WebSocket is a transport, not the durable event store. Clients receive event IDs and deduplicate them; after reconnect or a version gap, they reload an authorized Firestore projection. If the WebSocket server is unavailable, the outbox remains pending/retryable and canonical race data remains committed.

Bulk imports use one outbox event per committed row or bounded chunk with stable IDs. Do not create a single unbounded transaction or event payload for an entire competition.

## 6. Counters and standings

### 6.1 Source of truth and counter definitions

Competitor documents are the source of truth. Summary fields are projections:

- `competitorCount` = number of current, non-archived competitor entries in the competition.
- Add `finishRecorded: boolean` to the canonical competitor state. Set it when a finish is accepted through a FINISH station punch, a readout containing a valid finish time, or an authorized manual finish. `finishedCount` = number of current competitors where `finishRecorded == true`.
- A DNS or DNF status by itself does not change `finishRecorded`; this avoids conflating result classification with whether a finish was recorded.
- A correction may set `finishRecorded` to false only through an authorized, audited correction operation.
- Standings, ranks, and official result tables are calculated from competitor/result documents, not from either count.

### 6.2 Maintenance and reconciliation

`competitorCount` and `finishedCount` are **transaction-updated projections**, not independent canonical facts. Every create, archive/delete, finish transition, or authorized correction updates the affected delta in the same backend transaction as the competitor mutation. The transaction compares the prior and next state, so retries cannot increment twice.

These fields reside on the competition document for existing-reader compatibility. Writes to that document are limited to canonical backend operations. A scheduled/on-demand reconciliation recomputes both counts from competitor documents and reports or repairs drift under an audited operation. It does not overwrite competitor state.

Competition-level counter updates may contend during unusually high concurrency. This is acceptable for current low-rate registration and finish transitions only if load testing confirms it. If contention becomes material, shard counters and expose a reconciled aggregate; do not weaken operation atomicity or use client-side increments.

## 7. Rollback and reconciliation

### 7.1 Reader rollback

- A UI/listener regression may revert the reader to a compatibility projection rebuilt from Firestore.
- The Express mirror must carry a source Firestore version/updated timestamp and is refreshable; it is never promoted to authority.
- If the mirror is behind or cannot be proven current, show an unavailable/stale state rather than silently presenting it as current.
- Public and official views continue to enforce their respective data projections and access rules.

### 7.2 Writer rollback

Writer rollback is not a switch back to `seasonDb`.

1. Pause the affected callable operation and retain queued requests with their original IDs.
2. Inspect operation receipts, outbox records, and the affected competitor's aggregate version.
3. If the issue is in the client, roll back the client while keeping the trusted writer and Firestore source intact.
4. If the backend is defective, deploy a corrected backend or disable the affected mutation. Do not enable an old Express writer against the same fields.
5. If an older application must be restored, its old API endpoints must remain fenced or be adapted to call the canonical trusted operation path.
6. Reconcile from canonical receipts/competitors and replay pending outbox events by stable ID.

Never resolve a discrepancy by choosing the newest JSON timestamp or replacing Firestore from a whole-season snapshot.

### 7.3 Firestore/Express reconciliation

During the compatibility period, compare Firestore and Express mirrors by stable competitor ID, field ownership, and source version. Firestore wins for migrated fields. Any mirror-only mutation is quarantined for review; it is not automatically copied back.

If a repair is required, use a scoped audited repair/import operation with an explicit source, reason, and expected version. After repair, rebuild the Express mirror from Firestore and re-run count, SI assignment, receipt, result, and outbox reconciliation. JSON backups remain recovery evidence, not a routine synchronization source.

## 8. Implementation gates

Implementation must not begin until the following are accepted and testable:

1. The role matrix and callable-only write boundary are reflected in deployed Firestore rules and backend checks.
2. Legacy Express writer routes and old client versions are fenced; offline queue behavior and cutover handling are defined.
3. Assignment and entry-sequence documents are backfilled and duplicate SI conflicts are resolved.
4. Historical `rawReadout` and `processedClientIds` backfill passes the validation gates above.
5. Readout, online punch, manual finish, and counter changes create an outbox record in the same transaction.
6. Outbox delivery, lease expiry, duplicate suppression, dead-letter alerting, and replay are tested under process crashes.
7. Reconciliation can identify and repair counter drift without changing competitor facts.
8. A staging migration rehearsal demonstrates a clean second backfill and a tested reader/writer rollback.

## 9. Remaining risks

The P0 design gaps above have explicit resolutions. The following risks remain and require operational mitigation:

- **Previously lost history:** `rawReadout` is a latest-value archive and `processedClientIds` is bounded. Older overwritten payloads and evicted IDs cannot be reconstructed.
- **Long-offline clients:** Retained legacy IDs prevent some duplicate retries, but a client older than the cutover/version fence may hold an ID no longer present in the capped legacy array. Reject unsupported clients and retain canonical idempotency records for the full supported retry horizon.
- **Configuration drift during recalculation:** Courses, classes, station definitions, and emergency settings can change while a large recalculation runs. Record input versions and publish only a complete run whose inputs still match; otherwise restart.
- **Firestore contention/quotas:** Assignment, sequence, competition summary, and outbox documents may be contention points. Load-test expected peak operation rates and monitor transaction retries/latency.
- **Outbox delivery is not exactly once:** The design guarantees durable at-least-once delivery with destination deduplication, not exactly-once network delivery.
- **Role changes during queued operations:** Re-check roles at commit time. A queued operation may become unauthorized and must remain visible as rejected rather than being silently dropped.
- **Clock and ordering differences:** Preserve client capture time as untrusted evidence, use server receive/commit timestamps for audit, and order accepted mutations by aggregate version rather than client clock.

## 10. Recommendation

Adopt this plan as the required pre-implementation contract. Start with security-rule/backend boundaries, assignment and sequence model, and a read-only migration rehearsal. Do not enable competitor/readout Firestore-first writes until every implementation gate passes. Keep Express only as a rebuildable mirror and integration host during transition; never restore it as a competing writer.
