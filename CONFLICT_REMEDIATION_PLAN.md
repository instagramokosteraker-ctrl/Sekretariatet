# Conflict Remediation Plan

Status: historical remediation plan, superseded by [CONFLICT_REMEDIATION_PLAN_V2.md](./CONFLICT_REMEDIATION_PLAN_V2.md). No data was changed during inventory.

## Priority order

### P0 — Complete the integrity evidence before any cleanup

The latest live SI inventory returned three competitions, twelve competitors, and sixteen assignments. It reported two lifecycle errors in Lång-TM: SI assignments 12345 and 23456 are `RETIRED` while their linked competitors remain `REGISTERED`. Medel_RM has two more assignments than competitors but no analyzer-reported conflicts. The inventory does not check `ownerUid`, `cardSeries`, or `competitorDocumentId` parity, and it does not comprehensively validate every competitor embedded identity field or lifecycle combination.

1. Extend or replace the read-only inventory analysis so each competition checks:
   - competitor document path ID against embedded `competitorId`;
   - assignment `competitorId` and `competitorDocumentId` against the competitor path and embedded identity;
   - assignment and competitor `ownerUid` and `cardSeries` parity;
   - SI number and competition ID parity;
   - active, retired, duplicate-confirmed, and other lifecycle states against competitor status;
   - orphan competitors, orphan assignments, and duplicate ownership across all competitors and assignments.
2. Run the expanded analyzer with an authorized account against the complete competition collection. Retain the report counts, scan timestamp, and any query failures. The existing scan returned `evt-1794087219877`, `evt-1794342973709`, and `evt-1794343263813`; confirm this is the complete intended set. A partial or permission-limited scan must be recorded as incomplete, not clean.
3. Keep the operation read-only. Do not run bootstrap, repair, import, restore, or deletion actions as part of inventory collection.

### Historical analyzer findings (superseded by V2)

The basic analyzer reported two retired-assignment/active-competitor mismatches in Lång-TM:

| Competition | Competitor document ID | SI / assignment ID | Competitor status | Assignment status |
|---|---|---:|---|---|
| `evt-1794343263813` | `cmp_1794343935035_1f32fw` | 12345 | `REGISTERED` | `RETIRED` |
| `evt-1794343263813` | `cmp_1794343951204_oa6epr` | 23456 | `REGISTERED` | `RETIRED` |

The V2 analyzer found same-competitor ACTIVE successor assignments for both records; they are valid historical reassignment records and need no remediation.

No ownership violation in the untested owner/card-series/document-ID fields was confirmed by this inventory. Medel_RM's assignment-count excess requires read-only lifecycle/history review; do not treat it alone as proof of corruption. If the expanded scan finds another mismatch:

1. Preserve the affected competition, competitor document ID, assignment document ID, field names, and before-state as restricted operational evidence.
2. Determine the authoritative identity from the competition's trusted records and event/lifecycle history; do not infer ownership solely from the assignment document ID.
3. Plan the correction with the competition owner and verify the intended SI-card holder before changing data.
4. Apply any approved correction only through the canonical Firestore transaction path so competitor and assignment identity, SI, owner, card series, and lifecycle change together.
5. Re-run the read-only inventory and retain the before/after evidence. Never resolve a conflict by deleting an assignment or competitor merely to make the scan pass.

### P1 — Review non-active historical records

The existing scan reported no cleanup findings, but it does not comprehensively cover every lifecycle transition. Once the P0 checks are available:

- Review retired assignments linked to active competitors, active assignments linked to retired/deleted competitors, stale duplicate-confirmed records, and historical orphans.
- Distinguish legitimate retained history from actionable cleanup. Record the rationale for leaving historical records unchanged.
- Make no bulk cleanup based only on stale or orphaned references.

## Current observed outcome

- Detected by existing checks: two lifecycle mismatches in Lång-TM; no orphan, duplicate-SI, or checked competitor-ID findings in the three scanned competitions.
- Informational discrepancy for follow-up: Medel_RM has five assignments for three competitors; lifecycle/history explanation is not present in the report.
- Not established: ownership UID parity, card-series parity, `competitorDocumentId` parity, every embedded competitor identity field, comprehensive lifecycle consistency, and whether the three returned competitions are the complete intended production set.
- Remediation performed: none. This task performed only a read-only scan and documentation.

## Exit criteria

The inventory blocker is closed only when the expanded read-only scan returns the complete intended competition set, every requested mismatch category is checked, all query failures are resolved, and each confirmed P0/P1 finding is either reconciled through the canonical transaction boundary or explicitly documented as an accepted historical condition with owner approval.

This historical plan is superseded. The current ownerUid mismatches and evidence are in [CONFLICT_REMEDIATION_PLAN_V2.md](./CONFLICT_REMEDIATION_PLAN_V2.md). Readiness remains **NO-GO** until the canonical blockers are satisfied.
