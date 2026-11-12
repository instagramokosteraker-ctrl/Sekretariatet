# SI assignment retirement decision

## Decision

**Test is correct, backend implementation is missing.**

The Rules simplification was intentional, so this is not an accidental Rules
regression. However, the required trusted server-side enforcement is not
currently in place. The direct Firestore write in the test bypasses the
client-side transaction helper and is authorized by the current Rules.

## Retirement path

The failing test first changes competitor `cmp_valid` to `DNS`, then directly
updates `competitions/evt_live/siCardAssignments/8500111` from `ACTIVE` to
`RETIRED`, without a competitor write in that same commit.

The Rules path is
`/competitions/{competitionId}/siCardAssignments/{siNumber}`. Its current
`allow update` checks authentication, IDs, assignment schema, immutable
identity fields, timestamp, parent existence, and owner/admin authorization.
The test caller is the assignment owner/admin and satisfies those predicates.
The rule does not check the competitor's after-state or require a paired
competitor mutation, so the standalone update succeeds.

## Backend enforcement status

There is a transaction-aware retirement implementation in `src/firebase.ts`:

- `retireCompetitorInFirestore(...)` calls
  `runAtomicSIAssignmentMutation(...)`.
- Its callback validates the current assignment against competitor identity,
  retires the assignment, and updates competitor status in the same transaction.
- `deleteCompetitorFromFirestore(...)` similarly retires the assignment while
  deleting the competitor atomically.
- The SI reassignment path in `updateCompetitorInFirestore(...)` retires the
  old assignment and updates the competitor as part of its transaction.

But these functions use the Firebase **client** SDK. They are not a trusted
server boundary: an authenticated client can issue a direct Firestore write
instead of calling them. Also, repository search finds no caller of
`retireCompetitorInFirestore(...)`; the legacy Express competitor mutation
routes in `server.ts` are disabled and return `410`.

Therefore, the transaction helper enforces the paired write only when that
specific client code path is used. It does not prevent a standalone retirement
from being submitted directly to Firestore.

## Historical intent and transition status

The earlier assignment Rules design and test contract required lifecycle
mutations to be paired. The current Rules file even retains the comment that
assignment mutations must share a commit with a matching competitor mutation,
but the corresponding cross-document enforcement was deliberately removed in
Phase 1 to reduce Rules expression cost.

Phase 1 and Phase 2 documents explicitly assign that invariant to a trusted
server-side transaction. The current client-side transaction helper is not
equivalent to that trusted boundary while direct client writes remain
permitted. Thus the Rules behavior is an intentional relaxation, but the
planned enforcement migration is incomplete.

## Correct behavior and test expectation

The intended security model is:

- a client cannot retire an SI assignment by directly writing the assignment
  document;
- a retirement is accepted only through an authorized trusted operation that
  validates the competitor and assignment and commits their related changes
  atomically.

The `assertFails` expectation is correct for the current security contract.
Changing it to `assertSucceeds` would encode the direct-write bypass as
acceptable behavior rather than demonstrate that the planned backend boundary
is missing.

## Classification

- **A. Expected after server-side enforcement transition:** No. A trusted
  server-side enforcement boundary is not established by the current
  client-SDK helper.
- **B. Missing backend enforcement implementation:** **Yes.**
- **C. Rules regression:** No. The Rules check was intentionally removed, but
  its replacement is not yet a trusted boundary that prevents direct writes.

No Rules or test changes were made for this analysis.
