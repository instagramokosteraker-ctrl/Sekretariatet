# Competitor Rule Architecture Review

## Scope

This review traces the competitor create/update rule architecture in [firestore.rules](./firestore.rules#L441-L889) and the concrete write rules in [firestore.rules](./firestore.rules#L1729-L1795). It is intentionally limited to the competitor path and does not re-open deployment or readiness items.

## 1) Competitor create/update architecture

The competitor path is not a single small write guard. It is a combined access-control + integrity-validation stack.

### Competitor create

The create rule at [firestore.rules](./firestore.rules#L1729-L1758) evaluates:

1. `isVerifiedUser()`
2. `isValidId(competitionId)` and `isValidId(competitorId)`
3. `isValidCloudCompetitor(incoming())`
4. path equality checks
   - `incoming().competitorId == competitorId`
   - `incoming().competitionId == competitionId`
   - `incoming().ownerUid == request.auth.uid`
   - `incoming().createdAt == request.time`
   - `incoming().updatedAt == request.time`
5. `parentCompetitionExists(competitionId)`
6. `hasActiveSIAssignmentForCompetitorAfter(...)`
7. authorization branch:
   - owner/admin on the parent competition
   - `isSuperAdmin()`
   - `canCreateReadoutCompetitor()` + `readoutCompetitorIdentityMatchesRunnerDbData(competitionId, incoming())`

The key helper chain is:

- `isValidCloudCompetitor(data)` at [firestore.rules](./firestore.rules#L441-L539)
- `hasActiveSIAssignmentForCompetitorAfter(...)` at [firestore.rules](./firestore.rules#L695-L713)
- `canCreateReadoutCompetitor()` at [firestore.rules](./firestore.rules#L824-L832)
- `readoutCompetitorIdentityMatchesRunnerDbData(...)` at [firestore.rules](./firestore.rules#L866-L889)

That helper chain in turn calls:

- `hasProcessedReadoutReceiptAfter(...)` at [firestore.rules](./firestore.rules#L838-L847)
- `runnerDbMatchesReadoutCompetitor(...)` at [firestore.rules](./firestore.rules#L855-L864)
- `existsAfter(...)` / `getAfter(...)` for receipt and RunnerDb entries

### Competitor update

The update rule at [firestore.rules](./firestore.rules#L1760-L1785) is similarly large. It evaluates:

1. `isVerifiedUser()`
2. `isValidCloudCompetitor(incoming())`
3. ID and state preservation checks
4. `parentCompetitionExists(competitionId)`
5. one of two mutation branches:
   - same SI/card series, with either existing assignment parity or a new active assignment match
   - changed SI, with retired-assignment check + active-assignment match
6. access-control branch with `isAdmin()` / `isSuperAdmin()` / role-based logic

The update path also repeatedly re-checks:

- current owner
- existing competition identity
- SI/card-series continuity
- active assignment state
- assignment parity versus the incoming competitor

This is a cross-document integrity stack, not a simple document schema validation.

## 2) Guarantee contribution and complexity

### Biggest contributors to expression cost

From the static source analysis and the earlier failure tracing, the dominant cost is not any one tiny comparison. It is the combination of:

- full competitor schema validation (`isValidCloudCompetitor`)
- active assignment parity (`hasActiveSIAssignmentForCompetitorAfter`, `activeSIAssignmentMatchesCompetitorCreate`)
- readout receipt provenance (`hasProcessedReadoutReceiptAfter`)
- RunnerDb identity verification (`readoutCompetitorIdentityMatchesRunnerDbData`)
- parent competition status + ownership checks
- admin/role checks and their nested helper calls

The validator itself is large: [firestore.rules](./firestore.rules#L441-L539) contains a dense set of required fields, ranges, enum checks, optional-field checks, and list-size comparisons. It is not just a few booleans; it is a full record-shape contract.

## 3) Guarantee classification

| Guarantee | Classification | Why |
|---|---|---|
| Schema validation (`isValidCloudCompetitor`) | MUST remain in Rules | This protects the document shape and field constraints at the write boundary. |
| Assignment parity (`hasActiveSIAssignmentForCompetitorAfter`, `activeSIAssignmentMatchesCompetitorCreate`) | MUST remain in Rules | The competitor write is intentionally coupled to an active SI assignment; this is part of the core write integrity contract. |
| Owner parity (`incoming().ownerUid == request.auth.uid`, existing owner comparisons) | MUST remain in Rules | Prevents UID spoofing and cross-owner mutation. |
| Receipt provenance (`hasProcessedReadoutReceiptAfter`, `processedReadoutReceiptMatchesCompetitor`) | MUST remain in Rules for current design | The readout path explicitly relies on a processed receipt to authorize the write. Removing it would break the current write model. |
| RunnerDb identity (`readoutCompetitorIdentityMatchesRunnerDbData`) | MUST remain in Rules for current design | The design intentionally validates that a readout competitor matches the authoritative RunnerDb identity. |
| Role validation (`canCreateReadoutCompetitor`, `hasOfficialRole`, `isAdmin`, `isSuperAdmin`) | MUST remain in Rules | Access policy must remain enforced at the Rules layer for the selected role-based path. |
| Duplicate/self-comparisons in same helper | ALREADY enforced elsewhere | Some checks are redundant with path equality and already-validated IDs; these may be simplified, but they do not materially solve the limit. |
| Legacy or optional-field checks already covered in app/server transaction | CAN move elsewhere | Some validation can be shifted to backend API validation without changing the rules' authorization intent, but not all of it. |

The important point is not that every line is required. The problem is that the current design makes the competitor write do all of the following in one request path:

- validate the full competitor schema
- validate parent state/ownership
- validate the matching active assignment
- validate receipt provenance
- validate RunnerDb identity
- enforce role and admin rules
- preserve per-field update semantics across both create and update

That is a real architectural load, not a single bug.

## 4) Architecture classification

### Classification: C. Incompatible with Firestore Rules constraints

Reasoning:

1. The path is evaluated in a single request with many nested helper calls and several `existsAfter`/`getAfter` checks.
2. The exact same path includes both heavy schema validation and cross-document integrity validation. These are not independent or optional conditions; they are each required for the write to be valid.
3. Even after repeated optimization passes, the emulator still reports the 1,000-expression limit on competitor create and competitor update.
4. The counter split did not solve it; removing one parent counter update still left the competitor create path over the limit.
5. Therefore, the basic rule architecture for the competitor path is not merely "a little too big"; it is operating at or beyond the practical boundary of Firestore Rules for the current business guarantees.

This is not an accusation that the business logic is wrong. It is evidence that the current design attempts to enforce too much cross-document integrity inside a single Rules request.

## 5) Practical conclusion

The competitor rule architecture is not realistically optimizable into a fully compliant, still-secure Firestore Rules path without significant structural changes.

The design is best viewed as:

- near the practical limit for a single write path
- incompatible with the current one-request, one-path Rules model if all integrity guarantees remain in Rules

## 6) Recommended path forward

Recommended path: move the full business-integrity enforcement out of Firestore Rules and keep Firestore Rules limited to cheap, high-signal safety checks.

A realistic split is:

- In Rules: auth, role, ownership, path validity, minimal document-shape sanity, and safe status gating.
- In backend/service layer: full competitor schema validation, assignment parity checks, receipt provenance, RunnerDb matching, and any other complex cross-document equivalence checks.

This does not mean abandoning integrity guarantees. It means moving them to a transaction or server-side validation layer where expression limits are not binding.

The main architectural recommendation is:

- do not keep every integrity guarantee on the competitor write path inside Firestore Rules
- use Rules for authorization and basic safety only
- use backend enforcement for complete business consistency

That is the best path forward if the goal is to keep the system secure without depending on a Rules model that is structurally too expensive for the current competitor contract.
