# Readout reassignment repeat-policy review

## Decision

**The current implementation does not allow a readout to be reassigned more
than once.** It also blocks reassignment back to the readout's original
competitor. Both restrictions are enforced in the UI and/or server.

**Recommendation: remove the one-time restriction.** Allow additional,
separately audited corrections, including a correction back to the original
competitor, while retaining idempotency, authorization, result validation, and
guards against genuinely ambiguous or conflicting readout data.

The desired model is:

| Value | Meaning | Example |
|---|---|---|
| Original competitor | Immutable identity attached to the initially processed readout | Daniel |
| Current competitor | Competitor currently holding the result; updated by each successful correction | Karl |
| Correction history | Ordered, append-only operations, each recording the previous and new current competitor | Daniel → Mikael → Karl |

## Current behavior

### Second reassignment: blocked

- `isEligibleWrongCompetitorReadout` excludes a history record once it has a
  `correctionOperationId` or an applied correction audit
  ([src/services/readoutHistoryStore.ts](./src/services/readoutHistoryStore.ts)).
- The result handler checks that eligibility again before sending a request
  ([src/App.tsx](./src/App.tsx)).
- On the server, the original competitor is read from the immutable
  `readoutReceipts/{readoutId}.competitorId`. The first correction clears that
  competitor's result, so the next request fails the eligible-source-result
  check. Independently, the transaction queries prior correction audits for
  this readout and rejects if it finds an applied correction
  ([src/server/readoutReassignment.ts](./src/server/readoutReassignment.ts)).

Thus Daniel → Mikael succeeds once, but Mikael → Karl cannot be represented as
a second correction through the current workflow.

### Reassignment back to the original competitor: blocked

- The target selector excludes `originalCompetitorId`
  ([src/components/ReadoutDashboard.tsx](./src/components/ReadoutDashboard.tsx)).
- The server rejects a target whose ID equals the receipt's
  `competitorId`—which remains the initial competitor
  ([src/server/readoutReassignment.ts](./src/server/readoutReassignment.ts)).
- The prior-correction/eligibility restrictions would also prevent this from
  being a normal subsequent correction.

The check is against the *initial* competitor, not the current holder. This is
why returning the result to Daniel is prohibited even if Mikael currently
holds it.

### What the current implementation preserves

- The receipt is not changed during a correction, so its original
  `competitorId` and captured readout payload remain intact.
- Local readout history retains `originalCompetitorId` and updates
  `competitorId` to the corrected competitor. Its update helper preserves the
  original fields when later history fields are written
  ([src/services/readoutHistoryStore.ts](./src/services/readoutHistoryStore.ts)).
- An applied correction audit is written to
  `competitions/{competitionId}/readoutCorrections/{operationId}`. The history
  API returns audits for a readout in timestamp order
  ([src/server/readoutReassignment.ts](./src/server/readoutReassignment.ts)).
- Replaying the **same operation ID and payload** returns the saved result.
  Reusing that ID with a different payload is rejected. This retry protection
  is separate from the policy against a new correction operation.

The audit collection can store multiple operation documents, but the
`priorReassignment` guard currently makes the policy at most one applied
operation per readout. Therefore it cannot show a multi-step correction chain
today.

## Rationale

### Business rationale for allowing repeats

A correction is a human resolution of an assignment error, not a one-time
consumption of the readout. Officials can discover additional evidence after a
first correction—for example, Mikael may initially appear to be the correct
runner, then later card/identity checks establish Karl as the actual runner.
The workflow should permit the authorized official to correct the current
state again rather than leave a known wrong result in place or require an
out-of-band repair.

Returning to Daniel is also a valid correction if later evidence shows the
initial assignment was in fact right. Preserving Daniel as the *original*
competitor does not mean Daniel must forever be excluded as a correction
target; the audit should record the return as another link in the chain.

The audit trail is essential for accountability and review: it should explain
who changed Daniel → Mikael and who subsequently changed Mikael → Karl, with
separate reasons and timestamps. The final result should be associated with
Karl while the original attribution to Daniel remains visible and unchanged.

### Technical rationale for the existing restriction

The restriction is understandable as a conservative integrity guard in the
current data model:

1. The receipt's `competitorId` is the fixed initial assignment; there is no
   explicit authoritative current-assignee pointer on the readout.
2. The transaction currently selects its source from that receipt field,
   assumes that source still owns an eligible result, and clears it when
   applying a correction. After the first operation, those assumptions are no
   longer true.
3. The `priorReassignment` guard intentionally rejects another applied audit
   rather than guessing how to resolve a prior correction, competing receipt,
   or partially inconsistent state.
4. The UI's `correctionOperationId` and audit checks mirror that one-operation
   server policy and prevent inviting an action the backend will reject.
5. Same-operation replay is separately supported to make retries safe; a
   blanket second operation could not safely reuse the first operation's
   idempotency key.

These are limitations of the current single-correction workflow and state
model, not a business reason that a well-defined correction chain must be
forbidden.

## Recommended policy and safeguards

Permit any number of **new, authorized correction operations**, including a
return to the original competitor, when the current state can be verified.
For each operation:

1. Resolve the current holder from an explicit, transactionally maintained
   current-assignee field, or from the latest committed correction in a
   transactionally safe way. Do not treat the receipt's original
   `competitorId` as the current holder after a correction.
2. Validate that the source is the current holder and still has the result,
   and that the target can safely receive it. A target equal to the current
   holder is a no-op and should be rejected; a target equal to the *original*
   holder is valid when it is not already the current holder.
3. Atomically move the result/projection from current source to target and
   append a new audit entry containing that operation's actual `from`
   competitor, `to` competitor, actor, role, timestamp, reason, and result.
   Keep the initial competitor and raw receipt immutable.
4. Preserve same-operation replay semantics. Give every distinct correction a
   distinct operation ID and reject reuse with a different request payload.
5. Retain the guards for multiple competing processed receipts, missing or
   inconsistent source/target state, authorization failures, and other
   ambiguity. A repeat should not bypass those checks.
6. Update UI eligibility to permit a new correction after a completed one,
   show the current holder as the source/context, allow the original competitor
   as a target when appropriate, and render the full chronological audit
   chain. Keep the original competitor separately displayed/preserved.

**Policy conclusion:** do not retain “at most one reassignment.” Retain
transactional and ambiguity protections, and make current ownership explicit
so repeat corrections are deterministic. No implementation change is made by
this review.
