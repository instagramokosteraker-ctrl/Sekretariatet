# Competitor/Readout Cutover Checklist

**Purpose:** Go/no-go gate before beginning Competitor/Readout migration implementation.
**Initial status:** All items are not started. Move each item to exactly one status section as work progresses.
**Related design:** [MIGRATION-STATUS.md](./MIGRATION-STATUS.md), [COMPETITOR_READOUT_ARCHITECTURE.md](./COMPETITOR_READOUT_ARCHITECTURE.md), [SEASONDB_RETIREMENT_PLAN.md](./SEASONDB_RETIREMENT_PLAN.md), [P0_RESOLUTION_PLAN.md](./P0_RESOLUTION_PLAN.md).

## Status tracking

- `[ ] Not started` — no implementation or evidence yet.
- `[ ] In progress` — work is underway; evidence and owner are recorded.
- `[ ] Complete` — criterion is verified, evidence is linked, and any reviewer sign-off is recorded.

An item is not complete because it is planned, coded, or locally tested alone. Record the test/report/deployment evidence beside the item when moving it to Complete.

## Go/no-go rule

**GO** to begin implementation only when every item in section 1 is Complete, the target decisions for authority, schemas, matching, migration, outbox, counters, offline retry, and rollback are approved, and no P0 decision remains open. This is an implementation-start gate, not permission to enable production writes.

**NO-GO for production cutover** until every applicable item in sections 1–12 is Complete. In particular, deployed rules/backend authorization, legacy-writer fencing, historical reconciliation, and rollback rehearsal must pass. Any failed validation, unauthorized write, unexplained data difference, or untested rollback returns the affected item to In progress and blocks cutover.

---

## [ ] Not started

### 1. Preconditions — implementation start gate

- [ ] Confirm the migration scope and owner for competitor entry data, readouts, online punches, result projections, counters, and outbox delivery.
- [ ] Record the current ownership of adjacent inputs: competition metadata, classes, courses, stations, emergency settings, runnerDb, live events, and ROC.
- [ ] Approve the role/operation matrix in `P0_RESOLUTION_PLAN.md`, including the existing club-level (not competition-scoped) role semantics.
- [ ] Approve the target decisions in `P0_RESOLUTION_PLAN.md` for schema/authority, SI matching and uniqueness, historical backfill, outbox, counter semantics, offline retries, and rollback; record any consciously deferred non-P0 decision and its owner.
- [ ] Confirm the chosen trusted backend runtime, deployment environment, monitoring, and operational owner for privileged mutations.
- [ ] Inventory every client, Express route, ROC path, import, full-season sync, cloud-export, cloud-hydrate, restore, WebSocket snapshot, and administrative mutation that reads or writes competitors/readouts/punches.
- [ ] Fence, disable, or route every legacy mutation through the canonical operation service before enabling any Firestore-first production writer.
- [ ] Identify and reject unsupported old client versions; define how their pending offline operations are surfaced and handled.
- [ ] Produce a read-only source inventory for each competition, including stable competitor IDs, SI numbers, rawReadout payloads, processedClientIds, counts, and available backups.
- [ ] Capture a timestamped baseline export with per-competition counts, stable-ID lists, and payload hashes; verify that the backup can be read.
- [ ] Assign owners for cutover execution, data reconciliation, rollback decision, alerts, and post-cutover support.
- [ ] Record the maintenance window, expected queue-drain period, user communication, and criteria to pause or abort.

### 2. Firestore requirements

- [ ] Keep existing competitor document paths and IDs: `competitions/{competitionId}/competitors/{competitorId}`.
- [ ] Approve and document canonical schemas for competitors, readout receipts, station-punch receipts, SI-card assignments, entry sequence, processed-operation tombstones, outbox records, and any import/recalculation job state.
- [ ] Preserve required canonical competitor fields, including `isBorrowedCard`, explicit official overrides, and fields needed to distinguish original inputs from derived results.
- [ ] Define nullable time encoding and schema compatibility for existing documents; all writers/readers agree on sentinel and validation behavior.
- [ ] Define receipt fields for original card input, reported card series, station identity, client capture time (untrusted evidence), server receive/commit time, source, outcome, and competitor linkage.
- [ ] Use deterministic, bounded document IDs for operation IDs and document all normalization/collision behavior; reject invalid IDs rather than silently changing identity.
- [ ] Define SI assignment path and document shape; assignment and competitor SI fields must agree after every committed operation.
- [ ] Define the transactional bib sequence path, initialization from existing data, and behavior for gaps; do not allocate bibs from a client or stale collection snapshot.
- [ ] Define immutable receipt behavior for both `UNKNOWN` and `PROCESSED`, and the separately audited operation for resolving an unknown receipt.
- [ ] Define explicit competitor archive/delete behavior when receipts or punches refer to the competitor; no accepted history may be orphaned.
- [ ] Define how calculation inputs are versioned (courses, classes, stations, emergency configuration, algorithm version) and how a stale calculation is detected.
- [ ] Confirm every transaction reads all documents it depends on before writing; calculation must not use a stale client/Express snapshot as authoritative input.
- [ ] Confirm transaction read/write limits and document sizes for worst-case readouts and outbox payloads. Large recalculation/import jobs must be bounded and resumable.
- [ ] Define timestamps and ordering: distinguish race time, untrusted client capture time, server receipt time, and monotonic aggregate version.
- [ ] Define Firestore indexes, data retention, backup/export, and recovery procedures for all new collections.

### 3. Rule and authority requirements

- [ ] Route all canonical writes through trusted backend execution with Admin SDK; derive UID from verified auth, never request payload.
- [ ] Re-read current Firestore roles in trusted execution and enforce the approved operation/role matrix.
- [ ] Deny client writes to canonical competitor fields, counters, assignments, entry sequence, receipts, tombstones, outbox, import jobs, and recalculation state.
- [ ] Ensure authorized reads are limited to verified users and approved roles; ensure public projections do not expose private competitor or receipt data.
- [ ] Validate competition state, ownership/role, payload type/ranges, expected aggregate version, and operation identity on the backend.
- [ ] Verify `SUPER_ADMIN`, `RACE_ADMIN`, `START`, `READOUT`, `FOREST`, and `SPEAKER` permissions separately for each operation; test revoked and missing roles.
- [ ] Ensure imports, manual corrections, unknown-receipt resolution, and repair tools are privileged, scoped, logged, and not callable as generic overwrite APIs.
- [ ] Confirm no existing permissive Firestore rule or alternate API path bypasses the intended trusted boundary.
- [ ] Test rules with the Firestore emulator or equivalent automated rules suite, including allowed and denied reads/writes for each role and anonymous/public user.
- [ ] Review deployed rules and backend version together; do not rely solely on rules source in an un-deployed branch.

### 4. Idempotency requirements

- [ ] Generate a stable client operation ID once when a durable queue item is created; preserve it across retries, timeouts, reloads, and manual retry.
- [ ] Make receipt IDs deterministic and unique within competition and operation type; reject reuse of one ID with a different payload hash.
- [ ] In the transaction, check the operation receipt/tombstone before changing competitor state, counters, assignments, or outbox.
- [ ] Return the stored outcome for duplicate IDs without repeating any logical mutation or publishing a second logical event.
- [ ] Store a payload hash and enough provenance to detect same-ID/different-payload conflicts.
- [ ] Define retention at least as long as supported offline retry and audit windows; do not expire dedupe state while older clients can retry.
- [ ] Migrate retained `processedClientIds` as tombstones without fabricating missing receipt details; explicitly document that the bounded legacy list is incomplete.
- [ ] Ensure unknown receipt retries return the same `UNKNOWN` outcome; linking later is a distinct, idempotent audited action.
- [ ] Ensure import row IDs, manual operation IDs, recalculation run IDs, and outbox IDs remain stable across process restarts.
- [ ] Test that a timeout after commit followed by a retry does not increment a counter, update a result, or emit a duplicate event.

### 5. Matching requirements

- [ ] Normalize SI number as the unique assignment key within one competition; card series is descriptive metadata and does not permit duplicate SI numbers.
- [ ] Backfill one SI assignment for every eligible existing competitor and resolve all duplicate/conflicting SI numbers before cutover.
- [ ] Ensure assignment creation, competitor creation, and bib sequence update are atomic.
- [ ] Ensure SI-number changes atomically check the target assignment, update both assignment and competitor, and reject conflicts.
- [ ] Define and test SI assignment retention/reuse policy across DNS, DNF, finish, archive, and removal.
- [ ] Resolve a readout by reading deterministic `siCardAssignments/{siNumber}` inside the same transaction that checks the receipt and updates the competitor.
- [ ] Verify assignment and competitor still agree inside that transaction; do not choose a competitor using an earlier collection query or Express snapshot.
- [ ] Define series-mismatch behavior: match by SI number, record observed series, visibly flag discrepancy, and never silently redirect or mutate card assignment.
- [ ] Define concurrency behavior when registration/SI change races a readout; transaction retries must yield one valid assignment and one deterministic receipt outcome.
- [ ] Ensure a receipt accepted as `UNKNOWN` remains immutable and later linking preserves original SI input and audit history.

### 6. Outbox requirements

- [ ] Write the outbox record in the same Firestore transaction as every accepted mutation that must appear in the live feed.
- [ ] Derive deterministic event IDs from source operation IDs and make the destination enforce uniqueness by event ID.
- [ ] Include source ID, event type, competition/competitor identity, aggregate version, minimal safe payload/reference, delivery state, attempts, timestamps, and lease metadata.
- [ ] Exclude secrets and minimize personal information in event payloads; enforce role-appropriate delivery/projection.
- [ ] Implement transactionally claimed leases with expiry so crashed workers do not strand events.
- [ ] Use at-least-once delivery with capped exponential backoff and jitter; handle crash before delivery and crash after delivery/before acknowledgment.
- [ ] Deduplicate at the destination and preserve per-competitor aggregate ordering; detect version gaps and reload canonical state.
- [ ] Make exhausted retries visible through dead-letter state, alerting, and safe same-ID replay; never silently drop events.
- [ ] Define retention/cleanup independently of delivery and verify cleanup cannot remove pending/dead-letter events.
- [ ] Ensure WebSocket is only a transport; reconnecting clients can recover from Firestore/current projection and deduplicate event IDs.
- [ ] Test outbox replay and duplicate delivery without duplicate live events or stale projection regression.

### 7. Offline queue requirements

- [ ] Persist queue items durably with stable IDs and original payload before reporting them locally as queued.
- [ ] Keep Firestore/backend as the only authority; do not fall back to Express/JSON writes when the canonical operation is unavailable.
- [ ] Remove a queue item only after a confirmed committed outcome or an explicit terminal rejection that the user can inspect.
- [ ] Preserve the item and same ID after timeout, network loss, server error, or ambiguous response; retry safely.
- [ ] Distinguish pending, accepted, unknown-card, rejected/permanent failure, and retryable failure states in UI and queue storage.
- [ ] Make permanent failures actionable and prevent infinite retry; retain enough failure reason for user/operator recovery.
- [ ] Ensure repeated submission after a lost response retrieves the original receipt outcome.
- [ ] Ensure an accepted `UNKNOWN` readout is not silently discarded; provide visible operator resolution workflow.
- [ ] Define what happens when the user loses authorization, changes competition, logs out, or uses an obsolete app while operations remain queued.
- [ ] Ensure local queue payload bounds and sensitive-data handling are documented; do not expose full receipt history to unauthorized roles.
- [ ] Test app restart, browser refresh, offline-to-online transition, duplicate queue delivery, manual retry, and queue migration across client versions.

### 8. Historical migration and reconciliation

- [ ] Backfill each available `rawReadout` as a create-only, idempotent legacy receipt, preserving original payload and source timestamp.
- [ ] Use the original clientReadoutId where valid; otherwise use a documented versioned deterministic hash ID and record its derivation.
- [ ] Quarantine malformed or conflicting legacy readouts for review; do not overwrite existing receipts or fabricate missing details.
- [ ] Backfill retained `processedClientIds` as explicit “already processed, details unknown” tombstones, distinct from full receipts.
- [ ] Backfill competitor documents and assignments without changing existing competitor IDs.
- [ ] Initialize bib sequence and counters from reconciled canonical records, with a report of every adjustment.
- [ ] Compare Firestore and legacy source by stable IDs and payload hashes, not only record counts.
- [ ] Verify every available rawReadout maps to exactly one receipt and every retained processed ID maps to one receipt or tombstone.
- [ ] Verify assignment-to-competitor and competitor-to-assignment consistency; no duplicate SI assignment remains unresolved.
- [ ] Recalculate representative results and compare with Express; document every accepted difference and source/configuration version.
- [ ] Run backfill a second time and confirm zero unexpected writes or changes.
- [ ] Explicitly document irrecoverable history lost before migration due to overwritten rawReadout or capped processedClientIds.
- [ ] Keep migration exports and reconciliation reports under the approved audit/retention policy.

### 9. Rollback requirements

- [ ] Define reader rollback independently from writer rollback; readers may switch to a Firestore-derived compatibility mirror, never to an unverified stale snapshot.
- [ ] Define writer rollback as pausing/fixing trusted operations while Firestore remains canonical; never reactivate a competing JSON/Express writer by default.
- [ ] Fence old application versions and Express endpoints during rollback; older clients must call the canonical service or be rejected clearly.
- [ ] Ensure durable queued operations retain stable IDs while a backend operation is paused or redeployed.
- [ ] Verify Express compatibility state can be rebuilt from Firestore with source version/updated timestamp and is never imported back automatically.
- [ ] Define scoped, audited repair/import procedure with source, reason, expected version, and post-repair reconciliation.
- [ ] Rehearse restoring a read path, pausing a writer, rebuilding the Express mirror, replaying outbox events, and reconciling counts/receipts.
- [ ] Verify backup restoration does not overwrite newer canonical Firestore state and is separate from application synchronization.
- [ ] Define abort thresholds, decision authority, communication, and evidence retention for a production rollback.

### 10. Validation scenarios

- [ ] Same readout submitted twice with the same ID; only one receipt, result mutation, count delta, and logical event.
- [ ] Same operation ID reused with a different payload; explicit conflict and no mutation.
- [ ] Readout for an assigned SI number; receipt and competitor update commit atomically.
- [ ] Readout for unknown SI; durable `UNKNOWN` receipt, no fabricated competitor, visible recovery.
- [ ] Unknown readout linked later; original receipt remains immutable and resolution is separately auditable/idempotent.
- [ ] SI series mismatch; correct SI match, visible warning, no silent reassignment.
- [ ] Two concurrent registrations for the same SI; exactly one succeeds and one returns a conflict.
- [ ] Concurrent SI change and readout; one consistent mapping and no cross-assignment.
- [ ] Concurrent bib allocation; no duplicate bib.
- [ ] Online CHECK, START, FINISH, RADIO, and PREWARNING punches; correct captured station function and state transitions.
- [ ] Concurrent readout, finish punch, manual finish, and status correction; no stale overwrite or double finish count.
- [ ] Manual correction reverses a finish record; counts and audit/outbox update exactly once.
- [ ] Completed/closed competition and malformed payload; clear rejection with no receipt falsely marked successful.
- [ ] Readout with valid unusual/edge times, empty punch list, maximum supported punch count, and boundary values.
- [ ] Firestore transaction abort/retry; no partial receipt, competitor, count, assignment, or outbox state.
- [ ] Role matrix: every allowed operation succeeds for intended role; every disallowed operation is denied, including after role revocation.
- [ ] Direct entry, Eventor import, and bulk import are idempotent and preserve IDs; partial import progress is explicit.
- [ ] Recalculation with standard/forked courses, broken controls, emergency offsets, manual overrides, DNS/DNF, borrowed cards, and incomplete input.
- [ ] Legacy backfill preserves canonical payload hashes, quarantines invalid rows, and is repeatable.
- [ ] Express snapshots, cloud-export, cloud-hydrate, restore, and WebSocket state cannot overwrite Firestore-owned competitor/readout fields.
- [ ] Public data projection and official/admin views expose only their approved information.

### 11. Load and reliability scenarios

- [ ] Load-test expected peak readout, punch, registration, and manual-correction rates with production-like document sizes and indexes.
- [ ] Measure transaction retries/latency and contention for SI assignments, bib sequence, competition counters, and outbox claims.
- [ ] Confirm counter transaction contention remains within the documented peak envelope; define threshold for sharded counters if it does not.
- [ ] Load-test maximum receipt size and ensure transaction/write limits are respected.
- [ ] Run concurrent-operation tests at and above expected peak; verify unique SI assignment, bibs, stable ordering, and exact counters.
- [ ] Simulate client timeout after successful commit, backend restart before/after commit, and client retry.
- [ ] Simulate network partition, Firestore unavailable, permission denial, and recovery; queues retain items and never report uncommitted success.
- [ ] Simulate outbox worker crash before delivery and after delivery but before acknowledgment; verify lease recovery and destination dedupe.
- [ ] Simulate prolonged publisher outage and dead-letter/replay; no event is silently lost.
- [ ] Simulate stale configuration during a long recalculation; partial or outdated output is not published as current.
- [ ] Test recovery after server/function restart and ensure no in-memory-only idempotency, queue, or cursor state is required.
- [ ] Validate monitoring/alerts for transaction failure, queue age, unknown receipts, duplicate payload conflicts, outbox age/dead letters, counter drift, and reconciliation mismatches.

### 12. Exit criteria — production cutover gate

- [ ] Every production competitor/readout/punch/import/manual-finish/emergency-result mutation uses the approved trusted authority path.
- [ ] No client, Express route, snapshot, JSON restore, cloud-export, or cloud-hydrate path can overwrite/delete canonical records.
- [ ] Firestore rules and backend role checks pass the full automated authorization suite in the deployed environment.
- [ ] All historical reconciliation gates pass; unresolved SI conflicts, missing mappings, and unexplained data differences are zero.
- [ ] Existing competitor IDs are preserved and required fields, including borrowed-card semantics, survive read/load/write cycles.
- [ ] Receipts provide durable idempotency across retry, timeout, reload, offline queue, and process restart.
- [ ] Known readout receipt and competitor/result changes commit atomically; unknown receipts are durable and recoverable.
- [ ] Counters match defined semantics and reconcile exactly against canonical competitor state.
- [ ] Outbox delivery is durable, duplicate-safe, observable, replayable, and tested through crash scenarios.
- [ ] Offline queue exposes pending and failure outcomes accurately and never falls back to a legacy writer.
- [ ] Result recalculation is repeatable using versioned canonical inputs and matches agreed baseline scenarios.
- [ ] Rollback rehearsal has passed without restoring JSON/Express writer authority.
- [ ] Runbooks, dashboards, alerts, data retention, and accountable on-call ownership are in place.
- [ ] Product/operations owner approves the staged rollout, monitoring window, abort criteria, and final go decision.

---

## [ ] In progress

Move any started item from **Not started** to this section. Keep its original checklist text and append an owner, start date, and evidence/next step.

- _No items currently recorded._

## [ ] Complete

Move an item here only after its evidence is reviewed. Append the verification date and link to the test result, report, deployed rules/functions, or signed decision.

- _No items currently recorded._
