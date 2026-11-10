# OwnerUid Forensic Analysis

- Read-only Firestore scan: `2026-11-10T21:52:24.668Z`
- Competitions read: 4
- Competitors: 14
- Assignments: 20
- Active ownerUid parity mismatches: 6
- No production data was modified.
- The added Terräng-KM competition has 2 competitors and 4 assignments; it adds no ownerUid mismatch.

This report includes raw Firebase UIDs and is restricted operational data. Do not copy it into public issue trackers or broadly shared logs.

The timestamp-to-migration disposition and recommendation are in [OWNERUID_DISPOSITION.md](./OWNERUID_DISPOSITION.md). That assessment supersedes this report's initial statement that all six historical causes were unresolved; the forensic observations below remain unchanged.

## 1. Reflexcup#2 (`evt-1794087219877`)

- competitorDocumentId: `cmp_1794087402138_z0j2wy`
- competitorId: `cmp_1794087402138_z0j2wy`
- siNumber: `8501992`
- assignment state / retirement status: `ACTIVE` / not retired
- competitor ownerUid: `8hErgYh3H0NxftC8UE8d2tPecPV2`
- assignment ownerUid: `hA107ziRdKddg6Cf6ZZwsuUhTOt2`
- competition ownerUid: `8hErgYh3H0NxftC8UE8d2tPecPV2`
- competitor createdAt: `2026-11-07T21:36:42.397Z`
- competitor updatedAt: `2026-11-07T21:37:07.745Z`
- assignment createdAt / updatedAt: `2026-11-10T07:36:53.039Z` / `2026-11-10T07:36:53.039Z`
- assignment source: `SYSTEM`
- retirement/reassignment history: no predecessor or retired assignment found for this competitor; the active assignment has no retirement metadata or `previousCompetitorId`.
- classification: **C — Current integrity violation**. The active assignment owner differs from the competitor owner.

## 2. Reflexcup#2 (`evt-1794087219877`)

- competitorDocumentId: `cmp_1794087402744_uzvhzj`
- competitorId: `cmp_1794087402744_uzvhzj`
- siNumber: `8502410`
- assignment state / retirement status: `ACTIVE` / not retired
- competitor ownerUid: `8hErgYh3H0NxftC8UE8d2tPecPV2`
- assignment ownerUid: `hA107ziRdKddg6Cf6ZZwsuUhTOt2`
- competition ownerUid: `8hErgYh3H0NxftC8UE8d2tPecPV2`
- competitor createdAt: `2026-11-07T21:36:43.012Z`
- competitor updatedAt: `2026-11-07T21:37:04.915Z`
- assignment createdAt / updatedAt: `2026-11-10T07:36:53.385Z` / `2026-11-10T07:36:53.385Z`
- assignment source: `SYSTEM`
- retirement/reassignment history: no predecessor or retired assignment found for this competitor; the active assignment has no retirement metadata or `previousCompetitorId`.
- classification: **C — Current integrity violation**. The active assignment owner differs from the competitor owner.

## 3. Reflexcup#2 (`evt-1794087219877`)

- competitorDocumentId: `cmp_1794087403371_9fjfj9`
- competitorId: `cmp_1794087403371_9fjfj9`
- siNumber: `8509112`
- assignment state / retirement status: `ACTIVE` / not retired
- competitor ownerUid: `8hErgYh3H0NxftC8UE8d2tPecPV2`
- assignment ownerUid: `hA107ziRdKddg6Cf6ZZwsuUhTOt2`
- competition ownerUid: `8hErgYh3H0NxftC8UE8d2tPecPV2`
- competitor createdAt: `2026-11-07T21:36:43.650Z`
- competitor updatedAt: `2026-11-07T21:37:01.862Z`
- assignment createdAt / updatedAt: `2026-11-10T07:36:53.594Z` / `2026-11-10T07:36:53.594Z`
- assignment source: `SYSTEM`
- retirement/reassignment history: no predecessor or retired assignment found for this competitor; the active assignment has no retirement metadata or `previousCompetitorId`.
- classification: **C — Current integrity violation**. The active assignment owner differs from the competitor owner.

## 4. Reflexcup#2 (`evt-1794087219877`)

- competitorDocumentId: `cmp_1794087404007_62q0ok`
- competitorId: `cmp_1794087404007_62q0ok`
- siNumber: `8509448`
- assignment state / retirement status: `ACTIVE` / not retired
- competitor ownerUid: `8hErgYh3H0NxftC8UE8d2tPecPV2`
- assignment ownerUid: `hA107ziRdKddg6Cf6ZZwsuUhTOt2`
- competition ownerUid: `8hErgYh3H0NxftC8UE8d2tPecPV2`
- competitor createdAt: `2026-11-07T21:36:44.267Z`
- competitor updatedAt: `2026-11-07T21:36:58.235Z`
- assignment createdAt / updatedAt: `2026-11-10T07:36:53.799Z` / `2026-11-10T07:36:53.799Z`
- assignment source: `SYSTEM`
- retirement/reassignment history: no predecessor or retired assignment found for this competitor; the active assignment has no retirement metadata or `previousCompetitorId`.
- classification: **C — Current integrity violation**. The active assignment owner differs from the competitor owner.

## 5. Lång-TM (`evt-1794343263813`)

- competitorDocumentId: `cmp_1794343935035_1f32fw`
- competitorId: `cmp_1794343935035_1f32fw`
- siNumber: `123456`
- assignment state / retirement status: `ACTIVE` / not retired
- competitor ownerUid: `8hErgYh3H0NxftC8UE8d2tPecPV2`
- assignment ownerUid: `hA107ziRdKddg6Cf6ZZwsuUhTOt2`
- competition ownerUid: `hA107ziRdKddg6Cf6ZZwsuUhTOt2`
- competitor createdAt / updatedAt: `2026-11-10T20:52:15.585Z` / `2026-11-10T20:53:43.482Z`
- assignment createdAt / updatedAt: `2026-11-10T20:53:43.336Z` / `2026-11-10T20:53:43.336Z`
- assignment source: `MANUAL`
- reassignment history:
  - SI `12345`, document `12345`: `RETIRED`; ownerUid `8hErgYh3H0NxftC8UE8d2tPecPV2`; source `DIRECT_ENTRY`; createdAt `2026-11-10T20:52:15.585Z`; updatedAt / retiredAt `2026-11-10T20:53:43.336Z`; retirementReason `si_reassigned`; previousCompetitorId `cmp_1794343935035_1f32fw`.
  - SI `123456`, document `123456`: `ACTIVE`; ownerUid `hA107ziRdKddg6Cf6ZZwsuUhTOt2`; createdAt / updatedAt `2026-11-10T20:53:43.336Z`; no retirement metadata or predecessor.
- classification: **C — Current integrity violation**. The active assignment owner differs from the competitor owner. Its creation timestamp exactly matches retirement of the predecessor.

## 6. Lång-TM (`evt-1794343263813`)

- competitorDocumentId: `cmp_1794343951204_oa6epr`
- competitorId: `cmp_1794343951204_oa6epr`
- siNumber: `234567`
- assignment state / retirement status: `ACTIVE` / not retired
- competitor ownerUid: `8hErgYh3H0NxftC8UE8d2tPecPV2`
- assignment ownerUid: `hA107ziRdKddg6Cf6ZZwsuUhTOt2`
- competition ownerUid: `hA107ziRdKddg6Cf6ZZwsuUhTOt2`
- competitor createdAt / updatedAt: `2026-11-10T20:52:31.762Z` / `2026-11-10T20:53:48.841Z`
- assignment createdAt / updatedAt: `2026-11-10T20:53:48.711Z` / `2026-11-10T20:53:48.711Z`
- assignment source: `MANUAL`
- reassignment history:
  - SI `23456`, document `23456`: `RETIRED`; ownerUid `8hErgYh3H0NxftC8UE8d2tPecPV2`; source `DIRECT_ENTRY`; createdAt `2026-11-10T20:52:31.762Z`; updatedAt / retiredAt `2026-11-10T20:53:48.711Z`; retirementReason `si_reassigned`; previousCompetitorId `cmp_1794343951204_oa6epr`.
  - SI `234567`, document `234567`: `ACTIVE`; ownerUid `hA107ziRdKddg6Cf6ZZwsuUhTOt2`; createdAt / updatedAt `2026-11-10T20:53:48.711Z`; no retirement metadata or predecessor.
- classification: **C — Current integrity violation**. The active assignment owner differs from the competitor owner. Its creation timestamp exactly matches retirement of the predecessor.

## Cross-case analysis and classification

All six records are current parity failures (**C**). None is harmless (**D**) while active. The read-only documents do not prove whether the root cause is pre-migration data (**A**) or a migration/writer defect (**B**).

The four Reflexcup#2 competitors have the same ownerUid as their competition, while their later `SYSTEM` assignments have a different, identical ownerUid. The two Lång-TM competitors and their retired predecessor assignments share one ownerUid; the `MANUAL` active successors use the competition owner's UID and were created at the exact times the old assignments were retired. These patterns point to assignment creation/reassignment provenance as the likely boundary where the values diverged, but do not identify the deployed writer version or establish why it chose that value.

The current repository's bootstrap and reassignment implementations source assignment `ownerUid` from the competitor identity. This is consistent with the required parity invariant, so this evidence alone does not justify a source-code change. It does not prove which historical application version wrote these records. A/B attribution requires historical deployment or application audit evidence not present in the scanned documents.

## Determination

- **Data correction:** required to clear the six active parity violations, after the competition owner confirms the competitor documents' ownerUid is authoritative. The correction should align assignment ownerUid to competitor ownerUid, atomically, through the canonical transaction boundary. No correction was made.
- **Code changes:** not demonstrated as necessary in the current repository. Investigate historical writer/version and deployment provenance; change code only if a current writer can reproduce the mismatch.
- **Inventory logic:** do not ignore or downgrade these active parity failures.
- **Historical reassignments:** the four retired assignments elsewhere in the inventory have same-competitor ACTIVE successors and remain informational history, not P0 anomalies.

The refreshed scan covered all four competition documents returned to the authorized query; it cannot prove that the configured project has no inaccessible or unreturned competitions. Relative to the prior scan, one competition, two competitors, and four assignments were added; six historical reassignments now appear in total. The six ownerUid mismatches and their records are unchanged.
