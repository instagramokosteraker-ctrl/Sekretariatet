# Automatic CHECKED to IN_FOREST status design

## Current behavior

The stored status remains unchanged. For a live/upcoming competition, a competitor with stored status `CHECKED` is effectively `IN_FOREST` when the current competition datetime is at or after their allocated start datetime. A check entered after that time derives `IN_FOREST` immediately. Before the allocated time, the runner remains `CHECKED`.

The scheduled timestamp is constructed from the competition date and `allocatedStartSec` in `Europe/Stockholm`; time-of-day alone is not compared. Competitions marked `COMPLETED`, invalid/missing start allocations, and statuses other than `CHECKED` use their stored status.

## Start Corral actions

The “Startar nu” panel offers **Check** for a runner who has not already been checked. The action stores `CHECKED` and `checkTimeSec`; if the allocated start has already passed, the shared effective-status projection immediately displays `IN_FOREST`. An already checked runner is labeled “Checkad”, and this panel has no separate “Starta” action. Other start-list and physical START actions are unchanged.

## Persistence

The transition is derived in the shared effective-status helper and never written back by a clock timer. Firestore continues to store the check and any explicit actual start data.

See [AUTOMATIC_IN_FOREST_STATUS_IMPLEMENTATION.md](./AUTOMATIC_IN_FOREST_STATUS_IMPLEMENTATION.md) for implementation and verification details.
