# OwnerUid Disposition

- Assessment date: 2026-11-10
- Evidence: four-competition read-only inventory at `2026-11-10T21:52:24.668Z`, forensic record details in [OWNERUID_FORENSIC_ANALYSIS.md](./OWNERUID_FORENSIC_ANALYSIS.md), and repository commit timestamps.
- Scope: the six active assignment/competitor `ownerUid` parity mismatches in Reflexcup#2 and Lång-TM.
- No production data was modified.

## Executive determination

The six mismatches are not all equally attributable:

- **Four Reflexcup#2 cases: A — Historical legacy artifacts.** Their `SYSTEM` assignments were created at 07:36:53–07:36:53.799Z (08:36:53–08:36:53.799 CET). This is about one minute after the Phase C0 missing-assignment bootstrap implementation commit (`24cc989`, 08:35:49 CET), and before the later atomic mutation/reassignment commits, import/snapshot migration commits, and assignment-boundary hardening commit. Their competitor documents predate those assignments by several days. The source and timing are consistent with the early bootstrap path.
- **Two Lång-TM cases: D — Unknown pending deployment provenance.** Their active `MANUAL` successor assignments were created at 20:53:43.336Z and 20:53:48.711Z (21:53 CET), after the assignment-boundary hardening source commit (`90f0e9f`, 21:19:26 CET), and after the import/snapshot migration source commits. Thus they cannot be called pre-hardening solely from document timestamps. However, the repository does not record when the hardened build was deployed to the production app. The records could have been written by an older deployed build or by a currently deployed writer with a defect. The `MANUAL` source and same-time predecessor retirements show reassignment, but do not establish which build performed it.

All six remain **current parity violations** regardless of historical cause. None is harmless. Classification A describes likely provenance for four records; the two D classifications mean “unknown provenance,” not “expected” or “harmless,” and do not waive the present integrity requirement.

No case is presently supported as **B — Migration defect**: the evidence does not tie any of the six records to an import/snapshot migration implementation error. The Lång-TM cases remain D until deployment evidence distinguishes A from C.

## Milestone chronology

Times below use the repository commit's recorded `+01:00` local time. Firestore `createdAt` values in the forensic report are UTC; both time zones are shown when comparing them.

| Milestone | Repository evidence | Relationship to affected records |
|---|---|---|
| Atomic SI assignment schema/design foundation | Commit `ddf4583`, 2026-11-09 21:58:07 CET | Predates all six assignment records. The Reflexcup records were created in the early Phase C0 bootstrap period, before the later atomic mutation/reassignment implementation. |
| Missing-assignment Phase C0 bootstrap implementation | Commit `24cc989`, 2026-11-10 08:35:49 CET | The four Reflexcup `SYSTEM` assignments were created about one minute later. This strongly associates those four mismatches with the early bootstrap path. |
| Atomic mutation / reassignment implementation | Commits `42137da` (10:30:17 CET), `3b34897` (11:21:15 CET), and `88f391d` (11:38:17 CET) | These commits postdate the four Reflexcup bootstrap assignments and predate the two Lång-TM successor assignments. They are source-history evidence only, not production rollout evidence. |
| Import/snapshot transaction migration | Commits `42e0055` (19:59:06 CET), `c5a5269` (20:09:41 CET), and `8146d7f` (20:20:26 CET) | Postdates the Reflexcup assignments and predates the Lång-TM successors. The Lång-TM records have `MANUAL` reassignment provenance, not import provenance; temporal order does not make them import defects. |
| Assignment-boundary hardening | Commit `90f0e9f`, 2026-11-10 21:19:26 CET | Predates the Lång-TM successor timestamps by about 34 minutes and postdates Reflexcup. No production rollout timestamp or deployment revision is recorded, so this cannot establish which code wrote the Lång-TM records. |
| Fresh read-only inventory | `2026-11-10T21:52:24.668Z` | Four competitions, 14 competitors, 20 assignments; same six mismatches. Terräng-KM adds two competitors and four assignments with zero parity mismatches and two expected same-competitor historical reassignments. |

Repository commit timestamps identify when code entered source history. They do **not** identify production deployment, client cache/service-worker version, or the exact build used for a Firestore write. No verified production rollout record was found for Atomic SI Matching, import/snapshot migration, or assignment-boundary hardening.

## Per-case disposition

| # | Competition | SI | Assignment createdAt (UTC) | Relevant evidence | Predates Atomic SI Matching foundation? | Predates transactional mutation/reassignment implementation? | Predates import/snapshot migration commits? | Predates hardening source commit? | Classification |
|---:|---|---:|---|---|---|---|---|---|---|
| 1 | Reflexcup#2 | 8501992 | 2026-11-10 07:36:53.039Z | `SYSTEM`; created about one minute after Phase C0 bootstrap commit | No — schema/design already existed | Yes | Yes | Yes | **A — Historical legacy artifact** |
| 2 | Reflexcup#2 | 8502410 | 2026-11-10 07:36:53.385Z | `SYSTEM`; same bootstrap batch | No — schema/design already existed | Yes | Yes | Yes | **A — Historical legacy artifact** |
| 3 | Reflexcup#2 | 8509112 | 2026-11-10 07:36:53.594Z | `SYSTEM`; same bootstrap batch | No — schema/design already existed | Yes | Yes | Yes | **A — Historical legacy artifact** |
| 4 | Reflexcup#2 | 8509448 | 2026-11-10 07:36:53.799Z | `SYSTEM`; same bootstrap batch | No — schema/design already existed | Yes | Yes | Yes | **A — Historical legacy artifact** |
| 5 | Lång-TM | 123456 | 2026-11-10 20:53:43.336Z | `MANUAL`; created as SI 12345 was retired for same competitor | No — Atomic SI reassignment was implemented earlier | No — source migration commits predate it; this is not an import path | No — source hardening commit predates it; production rollout is unknown | **D — Unknown** |
| 6 | Lång-TM | 234567 | 2026-11-10 20:53:48.711Z | `MANUAL`; created as SI 23456 was retired for same competitor | No — Atomic SI reassignment was implemented earlier | No — source migration commits predate it; this is not an import path | No — source hardening commit predates it; production rollout is unknown | **D — Unknown** |

“No — source commit predates it” does not mean the production milestone was active at the time. All six assignments postdate the Atomic SI schema/design foundation; the four Reflexcup assignments predate the later transaction-safe mutation/reassignment implementation. For the two Lång-TM cases, deployment version is the missing evidence needed to distinguish **A — Historical legacy artifact** from **C — Active writer defect**. The mismatch itself is not evidence that the import/snapshot writer caused them.

## Recommendation

| Cases | Recommendation | Condition |
|---|---|---|
| Four Reflexcup#2 bootstrap artifacts | **Data correction only** | First confirm the authoritative competitor owner; update only the paired assignment ownerUid atomically and preserve identity/history. |
| Two Lång-TM successor assignments | **Leave unchanged for now** | First establish which production revision wrote them. If it predates hardening, data correction only after owner confirmation. If it includes hardening, **both** code correction and data correction are required. If provenance remains unknown, keep the NO-GO blocker and do not guess. |

The available evidence does not justify a code correction now: current repository paths validate and source assignment ownerUid from the competitor identity. A code correction becomes required only if a hardened production build is shown to have produced the Lång-TM mismatches.

## Is there evidence that new mismatches are still being produced?

There are **zero mismatches in the newly added Terräng-KM sample** (2 competitors, 4 assignments), which is evidence against a widespread ongoing defect in that sample. The four Reflexcup assignments are clearly associated with the early bootstrap. However, the two Lång-TM mismatches were created **after the hardening source commit**; because production rollout timing is unverified, they remain possible evidence of a writer still producing mismatches. Therefore the evidence does **not** support the categorical claim that no new mismatches are being produced.

## Readiness

**NO-GO.** Six active parity mismatches remain; four have a likely historical bootstrap cause, and two cannot be classified until their writer/deployment provenance is established. Trusted-writer/deployed-rule assurance and concurrency/rollback validation also remain open. The next highest-priority blocker is verifying the production build responsible for the two Lång-TM reassignments, then determining the authoritative owner for all six and correcting confirmed historical records safely.
