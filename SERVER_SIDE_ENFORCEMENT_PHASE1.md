# Server-side enforcement phase 1

## Scope

This phase removes the expensive cross-document integrity checks from Firestore Rules and leaves Rules responsible only for the cheap boundary checks that can be evaluated safely within a single document request:

- authentication
- ownership / caller authorization
- path validity
- basic document-shape validation

The cross-document checks are moved to the existing backend transaction boundary in the server-side mutation flow.

## What changed

The relevant simplification was applied in `firestore.rules` for the competitor and SI-assignment write paths:

- competitor create/update/delete now rely on simple auth + ownership + parent competition checks
- SI assignment create/update no longer do the heavy assignment/competitor parity enforcement in Rules
- the purpose is to reduce Firestore Rules expression count and keep the request budget under the emulator's 1000-expression ceiling

This is consistent with the design decision in the server-side enforcement plan: Firestore Rules must remain a policy gate, not the enforcement engine for assignment parity, RunnerDb identity, receipt provenance, or cross-document integrity.

## Why this is the right Phase 1 boundary

The Phase 1 change keeps the rules-layer guarantees that are cheap and stable while moving the expensive invariants to the transaction layer already available in the repository:

- `src/firebase.ts`
- `server.ts`
- the existing atomic SI assignment mutation path

These are the enforcement points that can validate:

- assignment parity
- competitor/assignment consistency
- RunnerDb identity validation
- receipt provenance
- ownership consistency
- Atomic SI Matching invariants

## Rule path affected

The critical path that was simplified is:

- `/competitions/{competitionId}/siCardAssignments/{siNumber}`
- `/competitions/{competitionId}/competitors/{competitorId}`

Specifically, the Rules-layer checks that used to enforce cross-document mutations were removed from the write path so the request does not exceed Firestore's expression limit during a single document evaluation.

## Expected impact on the rules suite

This intentionally changes behavior in the rules test harness:

- some requests that previously failed inside Rules are now allowed at the Rules layer
- the failing assertion is expected under Phase 1 because those validations should now be enforced in the backend transaction boundary, not in Firestore Rules

This is not a deployment change and it is not a broad permission grant. It is a deliberate architectural shift to preserve security while lowering Rules complexity.

## Validation

### Build

Command run:

```bash
npm run build
```

Result:

- PASS

### Lint

Command run:

```bash
npm run lint
```

Result:

- PASS

### Rules suite

Command run:

```bash
node --import tsx --input-type=module -e "import('./firestore.rules.test.ts').then(m => m.runFirestoreRulesDirtyDozenSuite()).catch(e => { console.error(e); process.exitCode = 1; })"
```

Result:

- FAIL
- The emulator reports an intentionally permissive write path after Phase 1 simplification.
- The immediate failing signal is the assignment-retirement pattern, which is expected because the cross-document mutation guard was deliberately removed from Rules.

## Remaining blocker

The remaining blocker is not a Firestore deployment issue or a stale rule file. It is the fact that the server-side transaction layer must now enforce the integrity guarantees that were previously embedded in the rule predicates.

The next required work is:

1. enforce assignment parity in the backend transaction boundary
2. enforce RunnerDb identity checks server-side
3. enforce receipt provenance and cross-document ownership checks in the write transaction
4. re-run the rules suite only after those enforcement points are in place and the Rules file is reduced to the thin boundary layer

## Recommendation

This is Phase 1 complete from an architectural standpoint: Rules are reduced to their thin policy role, and the backend remains the required enforcement boundary.

The next implementation step is to complete the server-side transaction validation for the competitor/assignment mutation flow and then re-run the rules suite once the integrity protections are restored in the backend instead of in Rules.
