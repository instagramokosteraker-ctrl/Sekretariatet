# OwnerUid Correction Plan

- Assessment date: 2026-11-11.
- Basis: the ownership-semantics recommendation in [OWNERUID_ARCHITECTURE_DECISION.md](./OWNERUID_ARCHITECTURE_DECISION.md), record-level evidence in [OWNERUID_FORENSIC_ANALYSIS.md](./OWNERUID_FORENSIC_ANALYSIS.md), and chronology in [OWNERUID_DISPOSITION.md](./OWNERUID_DISPOSITION.md).
- Inventory snapshot: `2026-11-10T21:52:24.668Z`; four competitions, 14 competitors, 20 assignments.
- This is a plan only. No production writes or code changes were made.

## Decision basis and limits

The adopted policy is that a resolved assignment's `ownerUid` must equal the linked competitor's `ownerUid`. Under that policy the six listed assignments are current parity differences. For every row, the proposed target UID is the competitor's stored ownerUid. The evidence shows the Reflexcup#2 competitors' owner UID also equals their competition owner; in Lång-TM the competitor UID matches each retired predecessor's UID. Those consistencies support the proposed targets, but do **not** independently prove the competitor documents' owner values are authoritative.

Therefore:

- The old and proposed values below are exact values from the read-only forensic snapshot.
- The proposed owner is **authoritative under the chosen rule only after competitor ownership is confirmed** with a trusted source (competition owner confirmation and/or reliable import/administrative records). Do not treat the competition owner UID alone as proof of individual competitor ownership.
- Cause classification is about provenance, not whether parity currently differs: four cases are likely historical artifacts; two Lång-TM cases remain unknown. No active current-writer defect is established.

## Per-record plan

| # | Competition | Competitor document / ID | SI / assignment document | State | Classification | Proposed authoritative owner (competitor.ownerUid) | Exact assignment correction |
|---:|---|---|---|---|---|---|---|
| 1 | Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087402138_z0j2wy` | `8501992` | ACTIVE | Historical artifact — likely early Phase C0 bootstrap | `8hErgYh3H0NxftC8UE8d2tPecPV2` (also matches competition owner; confirm competitor owner) | `hA107ziRdKddg6Cf6ZZwsuUhTOt2` → `8hErgYh3H0NxftC8UE8d2tPecPV2` |
| 2 | Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087402744_uzvhzj` | `8502410` | ACTIVE | Historical artifact — likely early Phase C0 bootstrap | `8hErgYh3H0NxftC8UE8d2tPecPV2` (also matches competition owner; confirm competitor owner) | `hA107ziRdKddg6Cf6ZZwsuUhTOt2` → `8hErgYh3H0NxftC8UE8d2tPecPV2` |
| 3 | Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087403371_9fjfj9` | `8509112` | ACTIVE | Historical artifact — likely early Phase C0 bootstrap | `8hErgYh3H0NxftC8UE8d2tPecPV2` (also matches competition owner; confirm competitor owner) | `hA107ziRdKddg6Cf6ZZwsuUhTOt2` → `8hErgYh3H0NxftC8UE8d2tPecPV2` |
| 4 | Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087404007_62q0ok` | `8509448` | ACTIVE | Historical artifact — likely early Phase C0 bootstrap | `8hErgYh3H0NxftC8UE8d2tPecPV2` (also matches competition owner; confirm competitor owner) | `hA107ziRdKddg6Cf6ZZwsuUhTOt2` → `8hErgYh3H0NxftC8UE8d2tPecPV2` |
| 5 | Lång-TM (`evt-1794343263813`) | `cmp_1794343935035_1f32fw` | `123456` | ACTIVE | Unknown — successor matches pre-hardening context-owner behavior; deployed writer not proven | `8hErgYh3H0NxftC8UE8d2tPecPV2` (matches competitor and retired SI `12345`; confirm competitor owner) | `hA107ziRdKddg6Cf6ZZwsuUhTOt2` → `8hErgYh3H0NxftC8UE8d2tPecPV2` |
| 6 | Lång-TM (`evt-1794343263813`) | `cmp_1794343951204_oa6epr` | `234567` | ACTIVE | Unknown — successor matches pre-hardening context-owner behavior; deployed writer not proven | `8hErgYh3H0NxftC8UE8d2tPecPV2` (matches competitor and retired SI `23456`; confirm competitor owner) | `hA107ziRdKddg6Cf6ZZwsuUhTOt2` → `8hErgYh3H0NxftC8UE8d2tPecPV2` |

The four Reflexcup assignments were created close to the early Phase C0 bootstrap commit. The two Lång-TM successor assignments were created simultaneously with retirement of their prior SI assignments; their successor UID matches the competition owner while competitor and predecessor UID match each other. These are provenance indicators only. The Lång-TM production build remains unverified.

## Can the current transaction boundary perform these corrections safely?

**No—not through the existing canonical mutation helper and deployed client-rule contract as currently written.**

1. The application transaction helper validates existing assignment-to-competitor owner parity before mutation. For these six records that validation fails, so normal update/reassignment/retirement flows abort rather than repair the mismatch.
2. The Firestore assignment update rule requires `incoming().ownerUid == existing().ownerUid`, except for a `RETIRED` to `ACTIVE` transition. All six assignments are ACTIVE, so a client transaction cannot change only their ownerUid under the current rule. A paired competitor `updatedAt` write does not bypass this immutability condition.
3. The `db` instance and generic atomic mutation wrapper are private, and no dedicated repair intent/export is present. Using a direct write or changing lifecycle state to evade validation would bypass the intended boundary and is not a safe correction method.

If owners are confirmed and correction is separately authorized, provide a **narrow, explicit repair transaction** that:

- rereads the competition, competitor, and exact assignment in the same transaction;
- verifies path/document IDs, SI number, `competitorId`, `competitorDocumentId`, cardSeries, ACTIVE state, assignment version, and that the observed old UID still matches the approved plan;
- verifies the competitor's owner UID against the independent authoritative source;
- changes only the assignment ownerUid plus normal version/update metadata, preserving `createdAt`, `source`, and all retirement history;
- is permitted only to the appropriate trusted administrator and is represented in Firestore rules (or a trusted server boundary) without opening a general assignment-owner rewrite path;
- aborts if any precondition changed and records an auditable repair reason outside the immutable creator/source fields.

The transaction boundary and its rule exception need implementation and tests before any production correction. This plan does not authorize or perform those changes.

## Verification after any approved correction

1. Re-read all six competitors and assignments and verify that each target owner is independently confirmed.
2. Apply only the approved rows in the repair transaction; preserve assignment creation timestamps, source values, and retired predecessor records.
3. Re-run the V2 inventory across the complete intended competition set.
4. Require no unexpected changes in SI, competitor/document IDs, cardSeries, lifecycle, orphan, duplicate ownership, or other parity checks; review all totals against the pre-correction snapshot.
5. Confirm the corrected records no longer appear in ownerUid mismatch findings. Keep a durable, access-controlled audit record of actor, time, reason, before/after values, and transaction outcome.

## Readiness if all six corrections were applied

**NO-GO.** This assumes the six values were confirmed against authoritative ownership, corrected through a validated transaction boundary, and a clean post-correction scan was evidenced. Resolving parity would close only the ownerUid-mismatch item; it would not satisfy the remaining canonical cutover blockers.

### Remaining blockers

1. **Trusted-writer and deployed-rule assurance:** verify the deployed Firestore rules version, run the rules regression suite, enumerate Admin SDK/deployed writer authorities, and establish that no writer bypasses the canonical path.
2. **Concurrency, retry, and rollback validation:** test same-SI competing creates, reassignment/readout/import races, timeouts/retries, bootstrap races, and recovery from partial import/bootstrap operations; record evidence and thresholds.
3. **Complete production inventory coverage:** confirm that the four competitions returned by the prior authorized query were the complete intended set and rerun the full inventory after correction.

Before any correction is attempted, the current boundary limitation described above must be resolved by a narrowly authorized repair transaction and tested rule/server boundary. That is a prerequisite to safely closing the ownerUid blocker, not a residual blocker after successful, validated correction.

Competition deletion and destructive reset remain intentionally disabled; they are capability restrictions rather than active identity writers. The readout/result compatibility limitations are tracked separately in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).
