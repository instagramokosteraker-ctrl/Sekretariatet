# Phase 3: Trusted READOUT auto-create

## Result

**Implementation: PASS. Rules suite: FAIL at the next READOUT permission assertion.**

READOUT auto-create now uses the authenticated Express backend and an Admin SDK
transaction. The transaction creates the competitor, active SI assignment,
processed receipt, and competition counters atomically.

## Rules inventory and migration

| Validation | Rules behavior before this change | Trusted transaction behavior |
|---|---|---|
| Assignment parity | Admin/owner create branch checked active assignment identity. The READOUT create branch bypassed that helper; the deeper READOUT assignment helper was defined but not called. | Reads `siCardAssignments/{siNumber}` and fails closed if any assignment exists; successful writes create the exact active assignment paired to the competitor. |
| Ownership parity | Competitor, assignment, and receipt paths separately required `ownerUid == request.auth.uid`; Rules did not prove cross-document owner parity for the READOUT branch. | Sets caller UID on competitor, assignment, and receipt from the verified server session. |
| Receipt provenance | Rules validated receipt shape, role, owner, path IDs, timestamp, and competition state. The processed-receipt-to-competitor helper had no active caller. | Validates the receipt ID and every readout payload field on replay; creates a `PROCESSED` receipt linked to the competitor or an `UNKNOWN` receipt on conflict, in the same transaction. |
| RunnerDb identity | The RunnerDb comparison helper was not called by the active READOUT create rule. | Reads `runnerDb/{siNumber}` in the transaction and compares SI number, name, club, and card series with the expected record and readout. |
| Competitor/assignment consistency | The READOUT role could create a competitor and assignment through client writes without the admin branch's active-assignment parity check. | Reads competition, competitor, assignment, receipt, RunnerDb, role documents, and competitors before writing; successful competitor/assignment/receipt/counter writes commit together. |

The Rules layer now denies direct READOUT competitor and assignment creation.
The unused cross-document READOUT helpers and the READOUT-only
competitor-count-plus-finished-count create allowance were removed. Normal
READOUT updates and receipt writes for existing competitors remain available.

## Implementation

`src/server/readoutAutocreate.ts` implements the trusted transaction. It
revalidates the caller's admin or official role, checks competition lifecycle
and counters, checks SI uniqueness and identity, and supports idempotent receipt
replay. A conflict records an `UNKNOWN` receipt without creating a competitor
or assignment.

`submitReadoutToFirestore` now posts auto-create requests to
`/api/firestore/competitions/:competitionId/readouts/:receiptId/auto-create`.
The server route permits only administrators and READOUT/FOREST/SPEAKER
officials, honors the server's auto-create setting, and the transaction
rechecks the persisted role. Existing-competitor readouts continue through
their existing path.

## Validation

- `npm run lint`: **PASS**
- `npm run build`: **PASS**
- READOUT auto-create, competitor creation, and retirement emulator tests:
  **PASS (7 tests)**
- `runFirestoreRulesDirtyDozenSuite()`: **FAIL**

The suite now rejects the direct-client READOUT auto-create batch and direct
counter increment. It proceeds to `firestore.rules.test.ts`'s assertion that a
READOUT official cannot update `feePaid` (the assertion at the first fee-paid
update failure). That update currently succeeds because the competitor update
rule allows the broad `canCreateReadoutCompetitor()` role branch without a
field allowlist. This is outside the auto-create transaction changed here.

## Next enforcement responsibility

Narrow or migrate READOUT updates to existing competitors so the role can
change only permitted fields (such as rental return) and cannot change billing
or race status. No deployment was performed.
