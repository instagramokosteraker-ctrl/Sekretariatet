# OwnerUid Remediation Plan

- Based on read-only Firestore scan: `2026-11-10T21:52:24.668Z`
- Competitions read: 4
- Competitors: 14
- Assignments: 20
- Active ownerUid parity mismatches: 6
- No production data was modified.
- The added Terräng-KM competition has 2 competitors and 4 assignments with no ownerUid mismatch; it adds 2 expected historical reassignments.

The detailed ownerUid values and forensic history are restricted to [OWNERUID_FORENSIC_ANALYSIS.md](./OWNERUID_FORENSIC_ANALYSIS.md). This plan is not authorization to change production data.

The timestamp and source-history reassessment is in [OWNERUID_DISPOSITION.md](./OWNERUID_DISPOSITION.md), which supersedes this plan's earlier all-six-unknown attribution: four Reflexcup#2 cases are likely early-bootstrap artifacts; two Lång-TM cases remain unknown until the production deployment revision at the time of reassignment is verified.

## Cases requiring disposition

| # | Competition | Competitor document ID | Competitor ID | SI | Assignment state | Assignment source | History |
|---:|---|---|---|---:|---|---|---|
| 1 | Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087402138_z0j2wy` | `cmp_1794087402138_z0j2wy` | 8501992 | ACTIVE | SYSTEM | No predecessor found |
| 2 | Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087402744_uzvhzj` | `cmp_1794087402744_uzvhzj` | 8502410 | ACTIVE | SYSTEM | No predecessor found |
| 3 | Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087403371_9fjfj9` | `cmp_1794087403371_9fjfj9` | 8509112 | ACTIVE | SYSTEM | No predecessor found |
| 4 | Reflexcup#2 (`evt-1794087219877`) | `cmp_1794087404007_62q0ok` | `cmp_1794087404007_62q0ok` | 8509448 | ACTIVE | SYSTEM | No predecessor found |
| 5 | Lång-TM (`evt-1794343263813`) | `cmp_1794343935035_1f32fw` | `cmp_1794343935035_1f32fw` | 123456 | ACTIVE | MANUAL | SI 12345 retired at successor creation; same competitor |
| 6 | Lång-TM (`evt-1794343263813`) | `cmp_1794343951204_oa6epr` | `cmp_1794343951204_oa6epr` | 234567 | ACTIVE | MANUAL | SI 23456 retired at successor creation; same competitor |

## Recommended disposition

1. Keep all six cases as P0 blockers until corrected and rescanned. The four Reflexcup#2 cases are **A — Historical legacy artifacts**; the two Lång-TM cases are **D — Unknown** pending deployment provenance. All six remain current parity violations; do not classify any as harmless.
2. Verify that each Firestore competitor's `ownerUid` is authoritative using the competition owner's confirmation and available import/admin/deployment audit records. The competition owner UID by itself is not proof of competitor ownership.
3. If confirmed, correct only the affected SI assignment `ownerUid` fields to match the corresponding competitor documents. Use the canonical Firestore transaction boundary and reread the competitor and assignment within the transaction. Preserve competitor identities and all retired historical assignments.
4. If the owner cannot be established, leave production data unchanged and retain the blocker; do not select a value based only on timestamps or `source`.
5. Rerun the read-only inventory across the complete intended competition set. Require zero unexplained active ownerUid mismatches and review any changed counts before closing the blocker.
6. First establish which production build was active for the Lång-TM reassignment writes. If it predates hardening, data correction alone is indicated after owner verification; if it includes hardening, treat it as an active writer defect and implement a code correction as well as approved data correction. The clean Terräng-KM sample is useful evidence but does not replace deployment verification.

## Data correction, code, and inventory decisions

- **Data correction:** required to restore parity after owner review for confirmed historical cases. No production correction was performed.
- **Code change:** not currently established. Required only if the two Lång-TM mismatches were written by a production build containing the hardened transaction path.
- **Inventory logic:** retain strict active assignment-to-competitor ownerUid parity validation. Do not ignore or downgrade the condition.
- **Historical reassignments:** keep the same-competitor retired predecessor records. They explain SI changes and are not themselves a reason to delete or rewrite data.

## Readiness

**NO-GO.** Six active P0 ownerUid mismatches remain unresolved; the latest scan covers four returned competitions, 14 competitors, and 20 assignments. It found no orphans, duplicate SI ownership, competitor/document ID mismatches, current SI mismatches, or active card-series mismatches. Trusted-writer/deployed-rule assurance and concurrency/rollback validation also remain open in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md).
