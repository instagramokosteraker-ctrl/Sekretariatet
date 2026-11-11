# Lång-TM OwnerUid Root Cause

- Assessment date: 2026-11-10.
- Scope: the two active ownerUid parity mismatches in Lång-TM.
- Evidence: read-only Firestore observations in [OWNERUID_FORENSIC_ANALYSIS.md](./OWNERUID_FORENSIC_ANALYSIS.md), current repository code, and Git history.
- No production data was modified.

## Conclusion

**It cannot be established whether the currently deployed writer created these records.** No deployment revision, release timestamp, client build identifier, or per-write actor/version metadata is available in the repository evidence.

The records strongly match the behavior of the **pre-hardening reassignment implementation**: the predecessor assignment ownerUid matches the competitor ownerUid, while each new `MANUAL` successor ownerUid matches the competition ownerUid. The pre-hardening implementation in commit `88f391d` created the successor assignment with `ownerUid: context.ownerUid`. The authorization context represents the signed-in writer; in these cases its UID matches the competition ownerUid. The hardening commit `90f0e9f` changed the assignment write to use the next competitor identity's ownerUid, and the current source continues to use that identity.

Both successor timestamps are about 34 minutes after the hardening **source commit**. That does not prove the hardened code had been deployed. The most likely explanation is an older deployed/cached client or another pre-hardening writer, but this remains an inference. If the hardened reassignment implementation was active for these writes, then it did not follow the current source path and an alternate or defective writer must be investigated.

Accordingly, the records are **C — Insufficient evidence to attribute the deployed writer**, with **moderate confidence** that their owner values reflect the earlier context-owner behavior. They must remain active integrity violations, not be treated as harmless.

## Record timelines

| Competition | Competitor document / ID | SI | Assignment source and state | Competitor owner | Retired predecessor | Active successor |
|---|---|---:|---|---|---|---|
| Lång-TM (`evt-1794343263813`) | `cmp_1794343935035_1f32fw` | 123456 | `MANUAL`, `ACTIVE` | Same as predecessor | SI 12345; `DIRECT_ENTRY`, `RETIRED`; owner matches competitor | Owner matches competition, differs from competitor |
| Lång-TM (`evt-1794343263813`) | `cmp_1794343951204_oa6epr` | 234567 | `MANUAL`, `ACTIVE` | Same as predecessor | SI 23456; `DIRECT_ENTRY`, `RETIRED`; owner matches competitor | Owner matches competition, differs from competitor |

| SI transition | Competitor createdAt | Predecessor retiredAt / successor createdAt | Competitor updatedAt |
|---|---|---|---|
| 12345 → 123456 | 2026-11-10T20:52:15.585Z | 2026-11-10T20:53:43.336Z | 2026-11-10T20:53:43.482Z |
| 23456 → 234567 | 2026-11-10T20:52:31.762Z | 2026-11-10T20:53:48.711Z | 2026-11-10T20:53:48.841Z |

In both cases, predecessor retirement and successor creation have the same timestamp; the competitor update follows shortly afterward. This supports a paired SI reassignment, but `source=MANUAL` and timestamps do not identify the client build or actor.

## Writer provenance

| Evidence | What it establishes | What it does not establish |
|---|---|---|
| Pre-hardening `88f391d` reassignment code writes `ownerUid: context.ownerUid` on successor creation | An earlier repository writer could create exactly this owner pattern when the signed-in UID is the competition owner and differs from the competitor owner | That this revision was deployed or used for either record |
| Hardening commit `90f0e9f` (`2026-11-10 21:19:26 +0100`) changed successor creation/reactivation to use `nextIdentity.ownerUid`; current source still does so | Current repository reassignment logic derives the assignment owner from the existing competitor identity | The production deployment time or exact code that ran at 21:53 CET |
| Successors were created at 20:53:43.336Z and 20:53:48.711Z (21:53 CET), after the hardening source commit | The records postdate the source change | That the source change had reached production |
| Successor owner equals competition owner; predecessor owner equals competitor owner | The observed values are consistent with the earlier context-owner behavior | Whether an older client, another writer, or a code/rules defect produced them |
| `MANUAL` source and paired timestamps | The records are consistent with manual reassignment | A unique writer, authenticated actor, or build identity |

No deployment workflow/revision attestation or per-write build/actor evidence was found in the repository. Git commit timestamps are source-history evidence, not deployment evidence. A stale browser/client and an external or otherwise untracked writer cannot be ruled out.

## Confidence assessment

| Classification | Confidence | Assessment |
|---|---:|---|
| A. Historical artifact from a pre-hardening writer | 7/10 | Likely: the owner pattern matches the earlier `context.ownerUid` implementation. It is not proven because deployment provenance is missing. |
| B. Defect in the current repository reassignment writer | 2/10 | Unlikely: current source writes `nextIdentity.ownerUid` and validates assignment identity/parity. This does not rule out a stale deployed client or another writer. |
| C. Insufficient evidence to attribute the deployed writer | 10/10 | Established: the available records and source history cannot identify the production revision that wrote them. |

These confidence values describe provenance, not whether the parity mismatch exists. The mismatch itself is certain and remains an integrity violation.

## Disposition and next evidence

- **Production data:** leave unchanged until the authoritative competitor owner is confirmed and a separately approved correction is made through a transaction that rereads both documents.
- **Code:** no current-source correction is justified by these records alone. If deployment evidence shows the hardened build produced them, investigate all alternate writers and correct the responsible path before resolving the blocker.
- **Inventory:** continue reporting active ownerUid parity failures; do not suppress these two cases.
- **Next evidence needed:** production hosting release/deployment revision and time covering 21:53 CET; client build/cache provenance if available; and any Firestore/Admin SDK write audit identifying actor and writer. If those records do not exist, classify provenance as permanently unknown rather than infer a deployment.

## Readiness if these two records are excluded

**No. Readiness would remain NO-GO, not CONDITIONAL GO.** Exclusion would still leave four active Reflexcup#2 ownerUid parity violations. Trusted-writer/deployed-rule assurance and concurrency/rollback validation also remain open in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md). Excluding records from an assessment would not correct or resolve their ownership state.
