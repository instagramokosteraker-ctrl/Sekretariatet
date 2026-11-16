# Live Ranking Projection Decision

## Decision: finalized

Use one rolling elapsed value for an active competitor's next-passage display:

```text
projectedPassageTime = currentTime - actualStartTime
```

The value means: **“If the competitor reached the next passage point right
now, what would their elapsed time be?”** It reports elapsed time at the
current instant and does not model future movement.

Use recorded `startTimeSec` as the actual start when available; otherwise use
`allocatedStartSec`. The calculation must use the current race time
consistently and preserve safe handling for missing starts and day rollover.

No speed, course, Bom, ideal-time, or reference-runner calculation contributes
to this value.

## Display and update behavior

- For the next unreached configured radio control, display
  `projectedPassageTime` in red italic text.
- Advance the displayed rolling value once per second while the competitor is
  still active and has not punched that point.
- On an actual radio punch, show its actual cumulative time at that control;
  the rolling value then appears only at the next configured passage.
- Never display rolling values at multiple future passage points. All future
  points after the next unreached point remain blank.
- If Finish is the next passage point, Finish alone displays the same rolling
  value. Once the final radio control is punched, that point shows actual time
  and Finish becomes the next point with the rolling value.
- Tid stays blank for an active runner while a radio control is next. When
  Finish becomes the next point, Tid displays the rolling value there. An
  official finisher displays actual finish time.
- A competitor row has at most one displayed projected value.
- For a ranking comparison, compare actual and projected cumulative times at
  the same passage point. Do not sort a radio-control value against an
  unrelated finish time.
- When a radio column is explicitly selected, compare every competitor at
  that control instead. For example, Radio 137 `35:22` ranks ahead of a
  `35:23` projection even if the default LIVE order differs.

At Radio 137, the order when Jocke reaches `35:23` is Emil `34:35`, Aksel
`35:19`, Kasper `35:22`, Jocke `35:23`, Joel `35:44`, Albert `36:23`. Jocke
is fourth. In the default LIVE order, status groups are applied first; within
the `IN_FOREST` group, the number of completed radio controls ranks first,
then rolling elapsed time. At the same progress count, this compares the
rolling value at the next passage without introducing a pace or runner-based
prediction. At Finish, the actual/rolling values order Kasper `58:48`, Joel
`59:46`, Emil `59:56`, Aksel `60:03`, Albert `60:06`.

## Constraints

- Do not calculate from the previous radio passage; the rolling value is
  always from the actual (or fallback allocated) start.
- Keep every future passage column blank except the one next unreached point.
- Do not project ordinary controls.
- Keep row sorting independent of the Plac cell's official place/status
  display.
- Keep rolling values ephemeral. Do not write them into validated splits or
  Bom fields.
- Keep automatic `IN_FOREST` as the separate computed status; it requires no
  Firestore write.
- Preserve the existing Bom calculation unchanged.
