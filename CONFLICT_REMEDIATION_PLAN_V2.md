# Conflict Remediation Plan V2

- Based on inventory scanned: 2026-11-10T21:52:24.668Z
- Competitions: 4
- Read-only inventory findings requiring review: 6

No production data was modified. Do not repair records from this report alone; confirm authoritative identity and ownership history first.

## Priority guidance

- **P0:** active ownership or identity parity mismatch, duplicate active SI ownership, active assignment orphan, or competitor with no active assignment.
- **P1:** retired assignment without an active successor, malformed historical assignment, or other lifecycle cleanup requiring owner review.
- **Informational:** retired assignment with a matching active successor for the same competitor; retain it as historical reassignment unless authoritative history indicates otherwise.

## Competition totals

| Competition | ID | Competitors | Active | Retired | Historical reassignments | Orphan assignments | Orphan competitors | Parity mismatches |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Reflexcup#2 | `evt-1794087219877` | 4 | 4 | 0 | 0 | 0 | 0 | 4 |
| Medel_RM | `evt-1794342973709` | 3 | 3 | 2 | 2 | 0 | 0 | 0 |
| Lång-TM | `evt-1794343263813` | 5 | 5 | 2 | 2 | 0 | 0 | 2 |
| Terräng-KM | `evt-1794346921290` | 2 | 2 | 2 | 2 | 0 | 0 | 0 |

## P0 — Owner UID parity mismatches

| Competition | Competitor document ID | Assignment document ID / SI |
|---|---|---:|
| Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087402138_z0j2wy` | `8501992` |
| Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087402744_uzvhzj` | `8502410` |
| Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087403371_9fjfj9` | `8509112` |
| Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087404007_62q0ok` | `8509448` |
| Lång-TM (`evt-1794343263813`) | `cmp_1794343935035_1f32fw` | `123456` |
| Lång-TM (`evt-1794343263813`) | `cmp_1794343951204_oa6epr` | `234567` |

For each record:

1. Review the competition owner, trusted creation/import provenance, and assignment history read-only. Determine whether the mismatch represents a legacy competitor owner, a stale assignment owner, or a legitimate ownership transition.
2. Do not expose or copy raw UID values into general reports. Compare them only within the authorized administrative context.
3. Have the competition owner confirm the authoritative owner for each affected identity. Do not choose the assignment or competitor value solely because it is newer.
4. No correction is included in this task. If a correction is later approved, use the canonical transaction boundary to update the competitor and assignment together, then rerun the read-only V2 inventory.

## Informational — Expected historical reassignments

The four retired records below each have an ACTIVE successor for the same competitor and are not remediation blockers:

| Competition | Competitor document ID | Retired SI | Active successor SI |
|---|---|---:|---:|
| Medel_RM | `cmp_1794343076389_k1cwi4` | `17396` | `173960` |
| Medel_RM | `cmp_1794343175042_5qosxt` | `8100116` | `7100116` |
| Lång-TM | `cmp_1794343935035_1f32fw` | `12345` | `123456` |
| Lång-TM | `cmp_1794343951204_oa6epr` | `23456` | `234567` |
| Terräng-KM | `cmp_1794347002438_r0ysuv` | `121212` | `1212122` |
| Terräng-KM | `cmp_1794346985198_19qdji` | `860917` | `8609171` |

The earlier basic inventory classified the latter two as lifecycle errors because it did not look for a same-competitor active successor. The V2 successor check confirms these as historical reassignments, consistent with the supplied event context.

## Other checks

- Orphan assignments: 0.
- Orphan competitors: 0.
- Duplicate SI ownership: 0 findings.
- `competitorId` and `competitorDocumentId` parity mismatches: 0.
- Current SI parity for active assignments: 0.
- Active `cardSeries` parity mismatches: 0.
- Assignment competition/document-ID parity mismatches: 0.

## Exit criteria

The inventory blocker remains open until the six owner UID mismatches have documented provenance and an owner-approved disposition, then the V2 audit is rerun with no unexplained P0 findings. Historical reassignment records should remain intact. No assignment or competitor should be deleted merely to make counts agree.
