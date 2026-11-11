# SI Assignment `ownerUid` Semantics Review

- Review date: 2026-11-11.
- Scope: meaning and enforcement of `siCardAssignments.ownerUid`.
- Sources reviewed: [ATOMIC_SI_MATCHING_DESIGN.md](./ATOMIC_SI_MATCHING_DESIGN.md), [OWNERUID_FORENSIC_ANALYSIS.md](./OWNERUID_FORENSIC_ANALYSIS.md), [OWNERUID_DISPOSITION.md](./OWNERUID_DISPOSITION.md), [ASSIGNMENT_BOUNDARY_HARDENING.md](./ASSIGNMENT_BOUNDARY_HARDENING.md), current assignment writers, validators, inventory, and Firestore rules.
- No production or local application data was modified.

## Conclusion

The explicit field definition in [ATOMIC_SI_MATCHING_DESIGN.md](./ATOMIC_SI_MATCHING_DESIGN.md), section 1.3, defines assignment `ownerUid` as **the verified administrator who created the assignment, stable across updates**. Of the choices given, the documented meaning is:

- **A) Assignment owner:** No. The SI-to-competitor relationship is represented by `competitorId`/`competitorDocumentId`; `ownerUid` is not documented as the current owner of that relationship.
- **B) Competitor owner:** No. The field definition does not say it mirrors the competitor's `ownerUid`.
- **C) Assignment creator:** **Yes.** This is the explicit design definition.
- **D) Last assignment editor:** No. The design says the value is stable across updates, not refreshed on edits.

**Conclusion: ownerUid parity is not required by the documented field semantics.**

There is a material implementation/documentation contradiction: later hardening, current transaction validators, Firestore rules, tests, and V2 inventory enforce `assignment.ownerUid == competitor.ownerUid`. Those controls effectively redefine the field as competitor-owner provenance, but the reviewed design document does not record that semantic change. Consequently, the six mismatches in the forensic report are proven value differences, but cannot be called ownership-integrity violations solely on the basis of parity until the product/data model explicitly resolves which meaning is authoritative.

This conclusion addresses the reviewed documentation and implementation, not a broader authorization policy. Assignment-level write permissions may independently use `ownerUid`; that does not make it the competitor's owner UID.

## Current assignment writer locations

These are the current `siCardAssignments` ownerUid write sites in `src/firebase.ts`. In creation paths the source varies; existing-assignment updates usually omit `ownerUid`, preserving its value.

| Location | Operation | Value written | Semantics implied by code |
|---|---|---|---|
| `src/firebase.ts:1071-1086` (`generateMissingSIAssignmentsFromFirestore`) | Bootstrap creates an ACTIVE SYSTEM assignment | `identity.ownerUid` from the existing competitor | Competitor-owner parity |
| `src/firebase.ts:2009-2027` (`writeImportedCompetitorWithAssignment`) | Import creates an ACTIVE IMPORT/SYSTEM assignment | `params.ownerUid`, also written to the newly created competitor | Same creator/importing account and competitor owner at creation |
| `src/firebase.ts:4716-4728` (`updateCompetitorInFirestore`) | Reassignment creates a new ACTIVE MANUAL assignment | `nextIdentity.ownerUid` from the competitor | Competitor-owner parity, not necessarily the authenticated assignment creator |
| `src/firebase.ts:4766-4783` (`updateCompetitorInFirestore`) | Reassignment reactivates an existing assignment | `nextIdentity.ownerUid` | Rewrites ownerUid on reactivation, despite the design's “stable across updates” wording |
| `src/firebase.ts:5121-5135` (`retireSIAssignmentInTransaction`) | Creates a missing RETIRED SYSTEM assignment during retirement | `identity.ownerUid` from the competitor | Competitor-owner parity |
| `src/firebase.ts:6114-6127` (`submitReadoutToFirestore`) | Readout creates an ACTIVE READOUT assignment | `newIdentity.ownerUid` from the new competitor | Competitor-owner parity; creator UID is not separately stored |
| `src/firebase.ts:6582-6595` (direct-entry transaction) | Creates an ACTIVE DIRECT_ENTRY assignment | `newIdentity.ownerUid` | Competitor-owner parity; creation actor may differ from competitor owner in delegated/admin flows |

Historical provenance relevant to the Lång-TM cases: pre-hardening commit `88f391d` created reassignment successors with `ownerUid: context.ownerUid`. That records the authenticated mutation context and can differ from the competitor owner. It is not a current writer location, but demonstrates that the repository previously used creator-like semantics in reassignment.

Retirement of an existing assignment, card-series changes, and other in-place assignment updates generally leave `ownerUid` untouched. Therefore code does not consistently treat it as a “last editor” field.

## Validation locations that assume ownerUid parity

### Application transaction and identity validation

- `src/utils/siCardAssignments.ts:58-72`, `assignmentMatchesCompetitorIdentity`, compares `assignment.ownerUid` to `identity.ownerUid` along with SI, card series, and competitor IDs.
- `src/firebase.ts:535-547`, `assertSIAssignmentMatchesCompetitor`, delegates to that parity comparison.
- Call sites include bootstrap verification (`src/firebase.ts:1066`), import create/update (`src/firebase.ts:2000`, `2064`), competitor mutation/reassignment (`src/firebase.ts:3651`, `4691`, `4708`, `4813`), and retirement (`src/firebase.ts:5113`). These reject an assignment whose UID differs from the competitor-derived identity.

### Firestore rules

- `firestore.rules:650-668`, `hasActiveSIAssignmentAfter`, requires the active assignment and linked competitor to have the same ownerUid.
- `firestore.rules:700-724`, `assignmentMatchesCompetitorAfter`, applies parity to ACTIVE assignments and checks the existing competitor's parity before retirement.
- `firestore.rules:1340-1430`, assignment create/update rules call the matching helper and preserve ownerUid on update except for RETIRED-to-ACTIVE reactivation. The rules therefore enforce parity and an immutability rule with a reactivation exception.
- These rules constrain client SDK writes only; the reviewed documents note that Admin SDK writers bypass client rules.

### Inventory and tests

- `src/utils/siAssignmentInventory.ts:532-596` emits `ASSIGNMENT_OWNER_UID_MISMATCH` whenever a linked assignment and competitor have different ownerUid values, regardless of lifecycle state. It counts this as a parity mismatch.
- `src/utils/siCardAssignments.test.ts` tests that changing the identity owner makes `assignmentMatchesCompetitorIdentity` fail.
- `src/utils/siAssignmentInventory.test.ts` includes owner mismatch fixtures/expectations.
- `ASSIGNMENT_BOUNDARY_HARDENING.md` calls parity a required transaction invariant; `OWNERUID_DISPOSITION.md` and the readiness/forensic reports treat violations as P0. These later documents assert the parity policy but do not explain or formally amend the original creator semantics.

The parser in `src/utils/siCardAssignments.ts:81-147` only requires `ownerUid` to be a valid string; parsing alone does not compare it to a competitor.

## Is V2 enforcing a documented invariant or an inferred invariant?

The V2 inventory is enforcing an **explicitly implemented and later documented parity policy**, not a parity invariant stated in the reviewed architecture's field semantics. In that sense parity is not merely an accidental inference in code: the hardening document and rules deliberately adopted it. However, that policy conflicts with the earlier explicit definition of `ownerUid` as the assignment creator, stable across updates. No reviewed document explains the change, defines a migration boundary, or states that assignment creator and competitor owner are always the same principal.

Therefore V2's result is accurate as “assignment ownerUid differs from competitor ownerUid,” but its classification as an integrity violation is not justified by the original schema semantics alone. The six cases should remain visible as **semantic-policy conflicts / ownerUid differences** until the project formally chooses one invariant. Do not silently drop the field from inventory; revise the label and readiness interpretation if creator semantics are confirmed.

## Required policy decision

The existing evidence supports the following determination from the current architecture text:

> **ownerUid parity is not required.**

To make parity required instead, the design must be explicitly amended to state that `ownerUid` means the linked competitor's owner, not the assignment creator; all writer paths must then preserve that definition, and existing records must be classified/corrected under an approved policy. Conversely, if creator semantics remain authoritative, parity comparisons in transaction validators, Firestore rules, tests, and inventory should be removed or replaced with checks against the assignment's creator/authorization policy. This review performs neither change.
