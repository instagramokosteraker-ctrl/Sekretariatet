# Server-side enforcement phase 2 implementation

## Scope and outcome

Implemented the first missing enforcement slice: SI assignment retirement.
Retirement is now performed through a trusted transaction in the existing
Express service. Direct client retirement is denied unless it is part of a
paired competitor mutation in the same commit, preserving existing atomic
reassignment and delete flows.

No deployment was performed.

## Implementation

### Trusted transaction

Added `retireCompetitorWithAssignment(...)` in
`src/server/siAssignmentRetirement.ts`. The transaction:

- verifies the competition and competitor exist and the caller owns the
  competition, unless the caller is a super admin;
- rejects completed competitions for non-super-admins;
- validates the competitor's path identity, SI number, card series, and owner;
- validates an existing assignment's competition, SI, competitor document,
  card series, owner, schema version, state, and version;
- retires or creates the assignment and updates competitor status atomically;
- adjusts `finishedCount` in that same transaction when retirement changes
  finished status.

The Express endpoint
`POST /api/firestore/competitions/:competitionId/competitors/:competitorId/retire`
requires an authenticated administrator and executes that transaction with
Firebase Admin SDK credentials. The transaction re-reads the caller's
`admins/{uid}` role document, so its authorization decision is made atomically
with the retirement rather than relying only on the role previously resolved
for the HTTP session. `retireCompetitorInFirestore(...)` now calls this
endpoint instead of writing from the browser SDK. The server uses Application
Default Credentials in production and the Firestore Emulator when
`FIRESTORE_EMULATOR_HOST` is set.

### Direct-write fence

Added a focused `get`/`getAfter` guard to the SI-assignment update rule. A
transition to `RETIRED` now requires the existing matching competitor to be
deleted or receive a relevant SI/status mutation in the same commit. The rule
also keeps competitor identity fields immutable on assignment update.

This prevents a standalone client retirement while preserving paired
reassignment and deletion transactions. The trusted Admin SDK endpoint
validates the full transaction contract independently of Rules.

### Tests

- The Rules suite checks that standalone retirement fails and that a paired
  competitor-status plus assignment-retirement batch succeeds.
- `src/server/siAssignmentRetirement.test.ts` verifies atomic assignment and
  competitor retirement, finished-counter adjustment, administrator-role
  validation, and owner authorization.

## Validation

- `npm run build`: **PASS**
- `npm run lint`: **PASS**
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest run src/server/siAssignmentRetirement.test.ts`:
  **PASS** — 2 tests
- `runFirestoreRulesDirtyDozenSuite()`: **FAIL**

The suite passes the standalone-retirement denial and paired-retirement success,
then fails at `firestore.rules.test.ts:592`:

```ts
await assertFails(
  raceAdminCtx.firestore()
    .doc('competitions/evt_live/competitors/cmp_wrong_assignment_owner')
    .set(...)
);
```

The competitor create unexpectedly succeeds despite the pre-seeded assignment
having a different `ownerUid`. This is the next missing enforcement
responsibility: competitor-create/assignment parity and owner consistency for
direct client writes. No further migration slice was attempted.

## Expression-limit and readiness impact

The retirement pair/standalone assertions pass, and the Rules suite now reaches
the competitor-create owner-parity assertion above. This slice does not remove
that remaining competitor-create validation from Rules or establish a numeric
expression-budget reduction. The assignment update rule has a targeted
same-commit `get`/`getAfter` guard; no separate expression-count measurement
was collected.

Retirement can now use a server-side transaction that validates identity,
ownership, and assignment consistency atomically. Readiness remains blocked by
the Rules suite failure and by unverified production Application Default
Credentials for the new endpoint. No deployment or production change occurred.

## Result

- Assignment retirement enforcement: implemented
- Build: **PASS**
- Lint: **PASS**
- Rules suite: **FAIL**
- Next blocker: competitor-create assignment parity / owner consistency
- Production deployment: not performed
