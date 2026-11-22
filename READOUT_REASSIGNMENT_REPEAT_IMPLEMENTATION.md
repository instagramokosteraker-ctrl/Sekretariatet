# Readout reassignment repeat implementation

## Result

Readouts can now be reassigned repeatedly, including back to the initial
competitor. Each correction remains independently authorized, validated,
transactional, and auditable.

## Ownership model

- `readoutReceipts/{readoutId}.competitorId` remains the immutable initial
  competitor.
- `readoutReceipts/{readoutId}.currentCompetitorId` is the authoritative
  current result holder. New processed receipts initialize it to their initial
  competitor; a reassignment changes it in the same Firestore transaction as
  the competitor and public-result updates.
- `reassignmentSequence` on the receipt increments for each committed
  correction. It orders audit entries deterministically, including when
  timestamps share the same millisecond.
- An audit entry retains `originalCompetitor` and records the operation's
  `previousCompetitor` and `correctedCompetitor`. The corrected competitor in
  the latest audit agrees with the receipt's current owner.

When a legacy receipt has no current-owner field, the server resolves it from
the latest applied correction audit, falling back to the receipt's original
competitor when no correction exists. It writes the explicit owner and
sequence on the next successful correction.

## Files changed

- `src/server/readoutReassignment.ts`
- `src/server/readoutReassignment.test.ts`
- `src/types/readoutReassignment.ts`
- `src/utils/readoutReassignment.ts`
- `src/services/readoutHistoryStore.ts`
- `src/services/readoutHistoryStore.test.ts`
- `src/components/ReadoutDashboard.tsx`
- `src/App.tsx`
- `src/server/readoutIngestion.ts`
- `src/server/readoutIngestion.test.ts`
- `src/server/readoutAutocreate.ts`
- `src/utils/readoutDuplicate.ts`
- `src/firebase.ts`

## Restrictions removed

- The browser no longer marks a readout ineligible just because a correction
  has already been applied.
- The target picker excludes the current holder, not the initial competitor.
  Correcting back to the initial competitor is allowed when that competitor is
  no longer the current holder and can safely receive the result.
- The server no longer rejects all subsequent corrections for a readout or
  always treats the receipt's initial competitor as the result source. It
  validates and moves the result from the resolved current holder.

The existing same-operation retry behavior remains: replaying the same
operation ID and payload returns the saved audit; reusing that ID with a
different payload is rejected. A distinct correction must use a distinct
operation ID. Authorization, eligible-result, target-readiness, receipt
ambiguity, and transaction guards remain in place.

## Migration impact

No bulk migration is required. Existing processed receipts without
`currentCompetitorId` remain readable: the server falls back to the latest
applied correction audit (the previous implementation allowed at most one),
or to the original receipt competitor if none exists. The first successful
post-deployment correction writes the explicit current owner and sequence.
Existing audit entries without `previousCompetitor` or `sequence` remain
readable; their previous competitor defaults to the original and the UI uses
timestamp ordering when sequence metadata is absent.

New processed receipts written by server ingestion, auto-create, and the
client fallback initialize `currentCompetitorId`. Duplicate detection still
matches the immutable original receipt identity and payload, while replay and
duplicate responses resolve to the receipt's current result holder.

## Audit-chain behavior

Every successful operation creates a separate immutable correction document
with its own actor, role, reason, timestamp, sequence, and result. The audit
API returns the complete history in sequence order, with timestamp fallback
for older entries. Each entry distinguishes the readout's initial competitor
from the previous holder for that operation.

## UI behavior

After a correction, the local history keeps the original competitor fields and
updates the current competitor and current result snapshot. The correction
action remains available for an eligible result. Preview and target selection
use the current holder; the original competitor may be selected again when
eligible. The correction history is displayed oldest to newest as a chain.

## Test results

- `npm run build` — passed.
- `npm run lint` — passed (`tsc --noEmit`).
- `npx vitest run src` — passed: 184 tests passed; 27 emulator-gated tests
  skipped in the non-emulator run.
- Firestore emulator run for reassignment, ingestion, and auto-create suites —
  passed: 18 tests. Coverage includes repeated moves, return to the original,
  legacy receipt/audit fallback, operation replay and payload conflict,
  unauthorized actors, ambiguous receipts, and duplicate receipt handling.
- `git diff --check` — passed.

The production build reports the repository's existing large JavaScript-chunk
warning. It does not fail the build.

## Remaining limitations

- The no-pointer legacy fallback assumes the historical one-correction policy:
  at most one applied audit without explicit current-owner state. Receipts or
  histories already containing conflicting ownership data fail existing
  source/target validation rather than being repaired automatically.
- Browser-level visual/e2e validation was not run; UI state and server workflow
  were validated through type checking, build, unit tests, and Firestore
  emulator integration tests.
