# Automatic IN_FOREST status implementation

## Result

**PASS**

`effectiveStatus` is computed at runtime and does not change or persist the competitor's stored `status`.

## Behavior

- Only a stored `CHECKED` competitor can be derived as `IN_FOREST`.
- The comparison uses the competition date and `Europe/Stockholm` time. At the exact allocated start boundary, the effective status is `IN_FOREST`.
- A late check-in is projected immediately after competitor data updates.
- A competition with status `COMPLETED` uses stored status only.
- An unallocated (`null`) start cannot trigger the transition. `REGISTERED` and all other stored statuses remain unchanged.
- Allocated starts are interpreted in Stockholm time, including summer time.
- Existing manual and hardware status writes remain intact.
- A shared clock hook refreshes at the next checked runner's start and after focus/visibility changes.

## Integration

The shared helper and hook are used by:

- Start Corral lists, filters, counts, and status display.
- Both simplified and “Sträcka & bom” result modes, including live ranking.
- Speaker results and incoming-runner monitoring.
- Public start and result views.
- Forest Safety counts, filters, status display, and CSV export.
- Result sorting and runner split-card status display.

The Firestore-backed competitor array remains the source data. The computed projection is a separate `effectiveStatus` property; no clock-triggered Firestore update, schema change, or rules change was added.

## Tests and validation

| Check | Result |
|---|---|
| Future start time | PASS |
| Exact start boundary | PASS |
| Overdue checked runner | PASS |
| Late check-in | PASS |
| Completed competition uses stored status | PASS |
| Projection leaves stored competitor unchanged | PASS |
| Effective-status and result-sorting tests | PASS — 12 tests |
| `npm run build` | PASS |
| `npm run lint` | PASS |

The build reported non-failing Vite configuration and large-chunk warnings.
