# Readout Counter Split Prototype

## Result

FAIL.

The prototype removed the `competitions/evt_live` counter update from the `readoutAutocreateBatch` and applied it as a separate follow-up write in the same test fixture. It did not bring the remaining atomic unit below Firestore's 1,000-expression limit.

## Prototype implemented

The minimal prototype was applied in [firestore.rules.test.ts](./firestore.rules.test.ts):

- `readoutAutocreateBatch` kept only the three atomic writes:
  - competitor create
  - SI assignment create
  - readout receipt create
- the competition counter update was moved out of the batch and executed afterward as a standalone update
- the same pattern was applied to the spoofed readout batch to keep the test semantics aligned with the prototype

This preserved the core Atomic SI Matching unit and all paired-write checks while testing the request-budget theory.

## Test result

The suite was rerun once with the prototype in place using the Firestore emulator.

The remaining failure still reports the expression ceiling on:

- `match /competitions/{competitionId}/competitors/{competitorId}` `allow create` at [firestore.rules](./firestore.rules#L1729)
- `allow update` on the same competitor path at [firestore.rules](./firestore.rules#L1760)

Firestore also reported evaluation errors on the SI assignment create path at [firestore.rules](./firestore.rules#L1492) and readout receipt create at [firestore.rules](./firestore.rules#L1991), but the dominant remaining over-limit path is the competitor rule path itself.

## Interpretation

Removing the parent competition counter update from the batch removed one large rule path from the request budget, but it did not remove the dominant issue.

The remaining atomic unit still exceeds the limit because the competitor write path itself is still too expensive. In practical terms:

- the batch no longer carries the `competition update` rule
- the remaining request still crosses the 1,000-expression ceiling during competitor create and competitor update evaluation
- therefore, the problem is not merely the parent competition counter update being in the same request

## Conclusion

The competition-counter split is not sufficient as a standalone fix.

The currently dominant remaining expression-limit hotspot is the competitor path, not the parent competition counter update.

This means the next likely real fix is further validation simplification or structural change in the competitor create/update rules themselves, not only splitting the counter from the batch.
