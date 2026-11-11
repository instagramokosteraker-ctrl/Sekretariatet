# Inventory Coverage Report

- Assessment: 2026-11-11 11:03 CET.
- Verdict: **FAIL — current V2 scope and parity coverage are not established.**
- Method: read-only scan through the authenticated production app at `https://sekretariatet.vercel.app/`.
- No production data was modified.

## Live scan observed

The app's standard inventory scan completed at `2026-11-11T10:02:08.710Z` and reported four competition documents, 14 competitors, and 20 SI assignments:

| Competition | Competition ID | Competitors | Assignments |
|---|---|---:|---:|
| Reflexcup#2 | `evt-1794087219877` | 4 | 4 |
| Medel_RM | `evt-1794342973709` | 3 | 5 |
| Lång-TM | `evt-1794343263813` | 5 | 7 |
| Terräng-KM | `evt-1794346921290` | 2 | 4 |
| **Total** |  | **14** | **20** |

The screen reported four lifecycle errors, zero warnings, and two informational “no SI assignment conflicts” results. The four errors were retired assignments paired with competitors still marked `REGISTERED`: two Lång-TM records and two Terräng-KM records. The Lång-TM records are previously documented expected historical reassignments. The two Terräng-KM records were not dispositioned by this scan. This legacy report does not count active/retired assignments or perform the required V2 owner, card-series, document-ID, competitor-ID, SI, orphan, duplicate-ownership, and lifecycle-successor audit.

## V2 coverage and limitations

The authenticated production page exposes only the older `SI_ASSIGNMENT_INVENTORY.md` report. It does not expose the repository V2 report controls or ownerUid forensic output. Consequently, this run is **not** a fresh V2 audit and must not be used to replace the last V2 snapshot (`2026-11-10T21:52:24.668Z`), which reported 4 competitions, 14 competitors, 20 assignments, 14 active, 6 retired/historical reassignments, zero orphans, and 6 ownerUid parity mismatches.

The current repository scan implementation enumerates all documents returned by `getDocs(collection(db, 'competitions'))` and reads each returned competition's competitor and assignment collections. The live scan returned the four IDs above. No independent expected-competition register, separate complete-scope enumeration, or latest V2 production build was available to prove that these four documents exhaust the intended production scope.

## Closure decision

**FAIL.** A read-only legacy scan ran successfully and its returned totals are recorded, but the requested V2 parity/lifecycle inventory was not run against production, expected competition scope is not independently reconciled, and Terräng-KM lifecycle flags need disposition. No claim is made that the six previous ownerUid mismatches remain unchanged or have been resolved.

To pass: reconcile project/database and in-scope competition IDs against an independent register; run the repository V2 scan against every ID after deployment of the V2-capable client; record timestamp, per-competition totals, query errors, and all parity/lifecycle findings; formally disposition the known ownerUid cases and Terräng-KM lifecycle records.
