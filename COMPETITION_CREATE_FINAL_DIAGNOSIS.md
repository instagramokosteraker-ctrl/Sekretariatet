# Competition Create Final Diagnosis

## Conclusion

Given the stated facts, the create-rule predicates already reported true are
not the issue. Both timestamp comparisons should also pass: the actual write
uses Firestore `serverTimestamp()` transforms, and Firestore documents that for
writes with server-side timestamps `request.time` equals the server timestamp.
See the official [`request.time` reference](https://firebase.google.com/docs/reference/rules/rules.firestore.Request#time).

That leaves **`isValidCloudCompetition(incoming())` as the only remaining
candidate among the predicates under review**. However, the available
diagnostics file contains the payload's shape, not the captured literal
`[Competition create diagnostics]` entry. Its logged timestamp fields are
deliberately replaced by the strings `"serverTimestamp()"`; those strings are
labels for the transforms, not the values passed to `transaction.set()`.
Consequently, no exact failing payload field can be named from the evidence
provided.

The current `createCompetitionInFirestore()` constructor appears to satisfy
`isValidCloudCompetition()` after normalization. If the deployed client is
running this exact code and sends the constructed object, **none of the
remaining predicates is shown to fail**. A denial in that case means at least
one premise is incomplete: the actual document differs from the constructor,
the deployed rule differs from the checked-in validator, or the denial is not
from the assumed write/ruleset.

## Field-by-field audit

The validator requires all required fields below, permits only its declared
optional fields, and enforces the listed types and bounds. Current constructor
values are source-level results; dynamic runtime values cannot be confirmed
without the literal diagnostic entry.

| Payload field | `isValidCloudCompetition()` requirement | Constructor result / possible failure |
|---|---|---|
| `competitionId` | String, 1–128 chars, `[A-Za-z0-9_-]+` | Sanitized ID. The reported ID format is valid and the supplied equality check is true. Could fail only if the actual logged value is not the sanitized value or exceeds/violates the rule pattern. |
| `shortCode` | String, 2–32 chars, `[A-Za-z0-9_-]+` | Sanitized, limited to 32 chars, and replaced with `ev26` if shorter than 2. Source path satisfies the constraint. |
| `name` | String, 1–140 chars | Trimmed and limited to 140; empty result falls back to `Tävling`. |
| `organizer` | String, 1–100 chars | Trimmed and limited to 100; empty result falls back to `OK Österåker`. Unicode is allowed by this rule. |
| `date` | String, exactly 10 chars matching `YYYY-MM-DD` | Invalid input is replaced with `getStockholmTodayIso()`. The rule checks the string pattern, not calendar validity. |
| `status` | String exactly `LIVE`, `UPCOMING`, or `COMPLETED` | Normalized to one of these values, otherwise `UPCOMING`. |
| `zeroTimeStr` | String, 5–8 chars matching `HH:mm` or `HH:mm:ss` digit pattern | Invalid input falls back to `18:00:00`; same pattern is used by the client and rule. |
| `zeroTimeSec` | Integer, 0–86400 | `clampInt()` rounds and clamps to this range; fallback is `64800`. |
| `arenaInfo` | String, max 500 chars | Trimmed and limited to 500. |
| `seriesName` | String, max 80 chars | Trimmed and limited to 80. |
| `allowSelfRegistration` | If present, boolean | Produced with `Boolean(...)`. |
| `competitorCount` | Integer, 0–50000 | Constant `0`. |
| `finishedCount` | Integer, 0–50000 and no greater than `competitorCount` | Constant `0`; satisfies the count relation. |
| `brokenControls` | List, max 64; first element, if any, must be integer | Empty list. |
| `controlTimeOffsets` | If present, map, max 64 entries | Empty map. |
| `ownerUid` | String, 1–128 chars, `[A-Za-z0-9_-]+` | The supplied runtime fact says it equals the auth UID. That UID is a valid 28-character rule ID. |
| `createdAt` | Firestore timestamp | Actual write uses `serverTimestamp()`; the diagnostic JSON shows a descriptive string instead of the transform. |
| `updatedAt` | Firestore timestamp | Same as `createdAt`. |

No other optional fields are added by the constructor. In particular,
`statusOverride`, fee flags, pins, and `pinsCustomized` are absent. The
top-level create rule also forbids `feeTrackingEnabled` and `enableFeesAndSwish`;
the shown constructor does not include them.

### Remaining ways the validator could reject the actual payload

Even though the current source normalizes each field, `isValidCloudCompetition()`
can still return false if the actual submitted document has any of these
conditions:

- a missing required key, an undeclared extra key, or an unexpected field
  type;
- an actual ID or short code outside its length/pattern limits;
- an actual name/organizer that is empty or over its maximum;
- a date that is not exactly the required 10-character pattern;
- a status outside the three accepted values;
- a time string outside the required pattern/length;
- a non-integer or out-of-range `zeroTimeSec`;
- an oversized/non-string `arenaInfo` or `seriesName`;
- a non-boolean `allowSelfRegistration`;
- non-integer/out-of-range counts, or `finishedCount > competitorCount`;
- a non-list/oversized `brokenControls` or a non-integer first member;
- a non-map/oversized `controlTimeOffsets`;
- an invalid `ownerUid`;
- `createdAt` or `updatedAt` not being Firestore timestamps in the actual
  request resource.

These are possible validator rejection conditions, not observed defects in the
provided source-level payload.

## Timestamp predicates

The rule checks:

```text
incoming().createdAt == request.time
incoming().updatedAt == request.time
```

`createCompetitionInFirestore()` sets both fields with the Firestore
`serverTimestamp()` transform in the same transaction write. The Firestore
Rules reference states: “For Firestore write operations that include
server-side timestamps, this time will be equal to the server timestamp,” and
shows comparing `request.time` with the incoming server-timestamp field.
Therefore **the transforms themselves should not cause either comparison to
fail**. They are the standard way to satisfy these checks.

The diagnostic's string labels do not change the actual write object: the
transaction sends `compDocData`, which retains the two `serverTimestamp()`
transforms. A separately constructed payload containing literal strings would
fail the timestamp type checks, but that is not what the current transaction
code sends.

## Exactness limit

The generic permission-denied response does not name a failed rule expression.
The files available for this audit do not contain the literal runtime
`competitionDocument` values from the failing attempt; the diagnostics document
describes the expected shape. Thus:

- At the **top-level predicate** level, `isValidCloudCompetition()` is the only
  remaining plausible failure among the three requested checks.
- At the **field level**, there is no evidence identifying one invalid field.
- Both timestamp predicates are expected to pass for the current transform
  writes.

If the literal `competitionDocument` from the exact denied attempt matches the
source-level constraints above, this audit does **not** establish a payload
failure; the active server rule/payload must then be captured or tested against
the exact deployed ruleset.

## Most likely failing predicate

**`isValidCloudCompetition(incoming())`**, only by elimination. No particular
field has been proven to fail, and the current constructor's normalized values
appear valid. The timestamp predicates are not the likely cause when the
actual write uses the shown server timestamp transforms.

## Minimal fix

**No field change is justified yet.** Compare the literal normalized
`competitionDocument` from the denied attempt (excluding the two diagnostic
timestamp label strings) against the field table and the active deployed
`isValidCloudCompetition()` implementation. If that comparison identifies an
invalid field, correct only that field's normalization or schema constraint.
If it matches, do not weaken the rule or replace `serverTimestamp()`; verify
the actual deployed validator and exact write payload instead.
