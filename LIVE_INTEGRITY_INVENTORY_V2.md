# Live Integrity Inventory V2

- Scanned: 2026-11-10T21:52:24.668Z
- Competitions: 4
- Competitors: 14
- Assignments: 20
- Active assignments: 14
- Retired assignments: 6
- Historical reassignments: 6
- Orphan assignments: 0
- Orphan competitors: 0
- Parity mismatches: 6
- ERROR: 6 | WARNING: 0 | INFO: 6

Read-only audit. No Firestore data was modified.

The authenticated local application queried the configured Firestore competition collection and completed the competitor and assignment reads for all four returned competition documents. The audit checks the full returned set; it cannot establish whether other projects, databases, or inaccessible documents exist.

Retired assignments are classified as historical reassignments only when an ACTIVE assignment with matching `competitorId` and `competitorDocumentId` exists for the same competitor. Card-series parity is compared for ACTIVE assignments because a retired assignment may retain the prior card series after reassignment. Owner UID and identity-document parity are checked for linked assignments.

## Competition totals

| Competition | Competition ID | Competitors | Active | Retired | Historical reassignments | Orphan assignments | Orphan competitors | Parity mismatches |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Reflexcup#2 | `evt-1794087219877` | 4 | 4 | 0 | 0 | 0 | 0 | 4 |
| Medel_RM | `evt-1794342973709` | 3 | 3 | 2 | 2 | 0 | 0 | 0 |
| Lång-TM | `evt-1794343263813` | 5 | 5 | 2 | 2 | 0 | 0 | 2 |
| Terräng-KM | `evt-1794346921290` | 2 | 2 | 2 | 2 | 0 | 0 | 0 |

## Findings

### P0 — Owner UID parity mismatches

The assignment `ownerUid` differs from the linked competitor `ownerUid` for these six active assignments. UID values are intentionally omitted from this report.

| Competition | Competitor document ID | Assignment document ID / SI | Finding |
|---|---|---:|---|
| Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087402138_z0j2wy` | `8501992` | ownerUid mismatch |
| Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087402744_uzvhzj` | `8502410` | ownerUid mismatch |
| Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087403371_9fjfj9` | `8509112` | ownerUid mismatch |
| Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087404007_62q0ok` | `8509448` | ownerUid mismatch |
| Lång-TM (`evt-1794343263813`) | `cmp_1794343935035_1f32fw` | `123456` | ownerUid mismatch |
| Lång-TM (`evt-1794343263813`) | `cmp_1794343951204_oa6epr` | `234567` | ownerUid mismatch |

These are detected parity violations and require read-only provenance review before any correction. The report does not determine which value is authoritative.

### Informational — Historical reassignment

Each retired assignment below has an active successor linked to the same competitor. These are classified as valid historical reassignments, not as orphan assignments or lifecycle errors.

| Competition | Competitor document ID | Retired SI | Active successor SI |
|---|---|---:|---:|
| Medel_RM (`evt-1794342973709`) | `cmp_1794343076389_k1cwi4` | `17396` | `173960` |
| Medel_RM (`evt-1794342973709`) | `cmp_1794343175042_5qosxt` | `8100116` | `7100116` |
| Lång-TM (`evt-1794343263813`) | `cmp_1794343935035_1f32fw` | `12345` | `123456` |
| Lång-TM (`evt-1794343263813`) | `cmp_1794343951204_oa6epr` | `23456` | `234567` |
| Terräng-KM (`evt-1794346921290`) | `cmp_1794347002438_r0ysuv` | `121212` | `1212122` |
| Terräng-KM (`evt-1794346921290`) | `cmp_1794346985198_19qdji` | `860917` | `8609171` |

### Other checks

| Check | Result |
|---|---|
| Orphan assignments | 0 |
| Orphan competitors | 0 |
| Duplicate SI ownership | 0 findings |
| `competitorId` / `competitorDocumentId` parity | 0 findings |
| Current SI parity for active assignments | 0 findings |
| Active `cardSeries` parity | 0 findings |
| Assignment competition/document-ID parity | 0 findings |

Historical retired assignments intentionally have prior SI numbers; their current SI parity is established through the same-competitor active successor relationship instead of comparing the retired SI to the competitor's current SI.

## Conclusion

The audit covered all four competitions returned by the authenticated Firestore collection query. It found six expected historical reassignments and no orphan or duplicate-SI issues. It also found six owner UID parity mismatches, so ownership integrity is **not clean** and cutover readiness remains **NO-GO** pending reconciliation. Compared with the prior scan, the added Terräng-KM competition has no parity errors. See [CONFLICT_REMEDIATION_PLAN_V2.md](./CONFLICT_REMEDIATION_PLAN_V2.md) and [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).
