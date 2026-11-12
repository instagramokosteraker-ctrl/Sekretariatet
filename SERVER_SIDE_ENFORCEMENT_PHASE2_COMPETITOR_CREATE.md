# Phase 2: Trusted competitor creation

## Result

**Implementation: PASS. Rules suite: FAIL.**

Direct-entry competitor creation now uses an authenticated server route and an
Admin SDK transaction. The transaction creates the competitor and its SI
assignment together, updates competition counters, and preserves the existing
learned RunnerDb behavior.

## Enforcement

`src/server/competitorCreation.ts` runs one Firestore transaction that reads the
competition, caller's admin role, destination competitor, requested SI
assignment, existing competitors using that SI number, and—when applicable—the
RunnerDb entry. Before writing it verifies:

- The caller is an administrator and owns the competition, unless they are a
  super administrator.
- The competition is eligible for entry and its counters are valid.
- The competitor ID is unused and the SI number is not already in use.
- Any existing assignment is active and matches the competition, SI number,
  card series, competitor ID, competitor document ID, schema version, and
  caller's owner UID.
- Incoming competitor data conforms to the bounded cloud document shape.

If no assignment exists, the transaction creates one with the competitor.
Counter and eligible RunnerDb updates commit in the same transaction. A
mismatched or retired assignment rejects the operation without writes.

`saveDirectCompetitionEntryToFirestore` now posts to the authenticated
`/api/firestore/competitions/:competitionId/competitors/:competitorId/create`
route instead of writing this operation through the browser Firestore SDK.

## Rules boundary

The Rules changes narrowly require SI identity parity on administrator
competitor creates and owner parity when administrators create assignments.
These checks prevent a direct client write from bypassing the trusted route;
they do not grant any new access. The more complex READOUT path is not routed
through these additional administrator checks.

## Validation

- `npm run lint`: **PASS**
- `npm run build`: **PASS**
- Competitor creation and retirement emulator tests: **PASS** (4 tests)
- `runFirestoreRulesDirtyDozenSuite()`: **FAIL**

The suite now passes the mismatched competitor-owner assertion and the
assignment-owner assertion. It proceeds to the READOUT auto-create batch, where
the competitor create / competition counter update is denied after reaching
Firestore's 1,000-expression evaluation limit. This is outside the direct-entry
transaction changed here.

## Next enforcement responsibility

Move READOUT auto-create and its receipt-provenance checks into a trusted
transaction boundary. Keep competitor, assignment, and receipt writes atomic;
the Rules expression limit remains the next suite blocker. No deployment was
performed.
