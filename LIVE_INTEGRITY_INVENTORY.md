# Live Integrity Inventory

Status: historical basic inventory, superseded by [LIVE_INTEGRITY_INVENTORY_V2.md](./LIVE_INTEGRITY_INVENTORY_V2.md). The scan below is retained as historical evidence; V2 classifies the retired records using active-successor matching and reports the newly checked ownerUid parity findings.

## Scope and evidence

The authenticated administration view ran its existing **SI-inventering → Skanna Firestore** operation against the configured Firestore project. The latest scan completed at `2026-11-10T20:54:19.309Z` and reported:

| Measure | Result |
|---|---:|
| Competitions returned by the Firestore collection scan | 3 |
| Competitors | 12 |
| SI assignments | 16 |
| Errors reported by the existing analyzer | 2 |
| Warnings reported by the existing analyzer | 0 |
| Informational results | 2 |

The analyzer returned the following competition-level results:

| Competition | Competition ID | Competitors | Assignments | Existing analyzer |
|---|---|---:|---:|---|
| Reflexcup#2 | `evt-1794087219877` | 4 | 4 | No reported findings |
| Medel_RM | `evt-1794342973709` | 3 | 5 | No reported findings |
| Lång-TM | `evt-1794343263813` | 5 | 7 | 2 errors: retired assignments linked to active competitors |

The two assignment-count excesses across the scan are in Medel_RM and Lång-TM. Medel_RM's existing checks reported no conflict; Lång-TM's two excess assignments correspond to the lifecycle errors below. This is evidence for the three competition documents returned by that scan, not proof of integrity for fields the analyzer does not inspect. The scan cannot establish that other projects, databases, or inaccessible competition collections are covered.

## Findings by requested check

| Category | Result | Classification | Evidence and limits |
|---|---|---|---|
| Orphan assignments | None reported | Informational, limited checks | The analyzer checks assignment references against competitor document IDs, including active assignments without a competitor. No issue was reported in the three returned competitions. |
| Orphan competitors | None reported | Informational, limited checks | The analyzer checks competitors without a matching SI assignment and assignments that do not point back to the competitor. No issue was reported in the three returned competitions. |
| Duplicate SI ownership | None reported | Informational, limited checks | Duplicate competitor SI numbers and an SI assigned to multiple competitor IDs are checked. No issue was reported in the three returned competitions. |
| `competitorId` mismatch | None reported for the checked relationship | Informational, limited checks | Assignment `competitorId` is compared with the referenced competitor document ID. The analyzer does not separately validate every embedded competitor identity field against the competitor path. |
| Lifecycle mismatch | **2 found** in Lång-TM | P0 integrity violation pending reconciliation | Retired SI assignments are linked to competitors whose status is `REGISTERED`. See the exact records below. Other lifecycle/status combinations are not comprehensively validated. |
| `ownerUid` mismatch | Not checked | P0 coverage blocker | The current inventory analyzer does not compare assignment and competitor owner UIDs. No conclusion about parity can be drawn. |
| `cardSeries` mismatch | Not checked | P0 coverage blocker | The current inventory analyzer does not compare assignment and competitor card series. No conclusion about parity can be drawn. |
| `competitorDocumentId` mismatch | Not checked | P0 coverage blocker | The current inventory analyzer does not compare this assignment field with the competitor document path and identity fields. No conclusion about parity can be drawn. |

## Categorized results

### Historical analyzer classification (superseded by V2)

The basic analyzer reported two lifecycle errors in Lång-TM (`evt-1794343263813`):

| Competitor document ID | SI number | Assignment document ID | Reported mismatch |
|---|---:|---|---|
| `cmp_1794343935035_1f32fw` | 12345 | `12345` | Assignment is retired; competitor status is `REGISTERED`. |
| `cmp_1794343951204_oa6epr` | 23456 | `23456` | Assignment is retired; competitor status is `REGISTERED`. |

The V2 audit found active successors for both retired assignments belonging to the same competitors. The records are therefore classified as expected historical reassignments, not P0 lifecycle violations. V2 also found six ownerUid parity mismatches; see the V2 report for current remediation status.

### P1 cleanup

No independent P1 cleanup item was reported. This is limited to the supported checks and the three competitions returned by the scan. Medel_RM has two more assignments than competitors; its analyzer output was clean, and the difference alone is not proof of a conflict.

### Informational

- The latest scan was read-only and completed for three competitions, twelve competitors, and sixteen assignments.
- No issues were reported for orphan relationships, duplicate SI ownership, or checked `competitorId` relationships.
- Two lifecycle errors were reported in Lång-TM: retired assignment records for SI 12345 and 23456 link to competitors still marked `REGISTERED`.
- Medel_RM has five assignments for three competitors; the existing analyzer reported no conflict. Validate assignment lifecycle/history.
- The prior [SI_ASSIGNMENT_INVENTORY.md](./SI_ASSIGNMENT_INVENTORY.md) documents an earlier one-competition scan; neither scan proves coverage of unreturned competitions or untested identity fields.

## Conclusion

This historical basic scan is superseded. For current results, scope, and the readiness decision, use [LIVE_INTEGRITY_INVENTORY_V2.md](./LIVE_INTEGRITY_INVENTORY_V2.md) and [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).

See [CONFLICT_REMEDIATION_PLAN.md](./CONFLICT_REMEDIATION_PLAN.md) for the next steps and [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md) for the canonical readiness decision.
