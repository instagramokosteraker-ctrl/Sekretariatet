# Automatic IN_FOREST status implementation

## Result

`effectiveStatus` is computed at runtime and does not change or persist the competitor's stored `status`.

## Behavior

- Only a stored `CHECKED` competitor can derive to `IN_FOREST`.
- The comparison uses `competition.date` and `Europe/Stockholm` time. At the exact allocated-start boundary, effective status becomes `IN_FOREST`.
- Checking in after the allocated start derives `IN_FOREST` immediately when the check update is received.
- A completed competition uses stored status only.
- An unallocated/invalid start does not trigger a transition. `REGISTERED` and all other stored statuses remain unchanged.
- A shared clock hook refreshes at the next checked runner's allocated start and after focus/visibility changes.
- The Start Corral “Startar nu” panel offers **Check** for a runner not yet checked. Already-checked runners show “Checkad”; no “Starta” action is shown there. The separate start-list actions remain available.

## Integration and persistence

The shared helper and hook provide effective status to Start Corral, both result modes, Speaker, Public Portal, Forest Safety, and other status-sensitive views. Firestore continues to store the source status; no scheduled clock-driven write or schema change was added.

## Verification

`src/utils/effectiveRunnerStatus.test.ts` verifies Stockholm time handling, before/at/after allocated start behavior, late check-in, registered/completed status behavior, missing allocation, and non-mutation. Focused test, build, and lint results are reported with the corresponding code change.
