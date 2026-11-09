# SI Assignment Inventory

## Status: BLOCKED — scan not executed

No Firestore inventory results are reported in this document. The live scan could not be authenticated, so counts and findings are **unknown**, not zero.

The local admin app was started at `http://localhost:3000` and the read-only scanner was available, but Firebase Authentication returned `auth/unauthorized-domain` for `localhost`. The app uses Firebase project `ai-studio-applet-webapp-72c01`. The production admin URL currently serves a version without the inventory scanner.

No competitor or SI-assignment data was changed.

## Required scan coverage

Once an authorized admin session can run the scanner, it will inspect every competition and report:

- duplicate SI numbers among competitors;
- SI numbers assigned to multiple competitors;
- competitors with missing or invalid SI numbers;
- assignment documents without corresponding competitors;
- competitors without assignment documents;
- malformed, mismatched, or inconsistent assignment documents;
- retired assignments that still reference active competitors.

## Severity

- **ERROR** — duplicate ownership, invalid data, orphaned active assignments, mismatches, or a retired assignment linked to an active competitor.
- **WARNING** — missing SI numbers, missing assignment documents, historical retired references, or confirmed duplicates.
- **INFO** — a competition has no detected conflicts.

## Inventory results

| Competition | Conflict type | Affected competitor IDs | SI number | Severity |
|---|---|---|---|---|
| Unknown — scan not executed | Unknown | Unknown | Unknown | Unknown |

This row records the scan blocker and must not be interpreted as an inventory finding.

## Next step

Run **Klubbadmin & Behörighet → SI-inventering → Skanna Firestore** from a `SUPER_ADMIN` or `RACE_ADMIN` session on an authorized origin. Download the generated `SI_ASSIGNMENT_INVENTORY.md` and replace this blocked report with the actual results. The scan is read-only and does not create assignments or modify competitor data.
