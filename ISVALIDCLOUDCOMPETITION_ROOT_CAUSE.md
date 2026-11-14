# `isValidCloudCompetition()` Root-Cause Audit

## Result in brief

Under the stated facts, `isValidCloudCompetition(incoming())` is the remaining
top-level create predicate under investigation. The repository's
`createCompetitionInFirestore()` constructor appears to produce values that
satisfy every conjunct in the checked-in validator.

The material supplied in this workspace does **not** contain the literal
`[Competition create diagnostics]` entry from the denied request. The report
`COMPETITION_CREATE_DIAGNOSTICS.md` documents the payload shape and its timestamp
placeholders, not the runtime values. Therefore an exact failing *field
predicate* cannot be identified without that entry or a server-side rules
evaluation. If the literal write was produced by the current constructor and
the active validator matches `firestore.rules`, this function should return
true; a denial would mean one of those premises is false.

## Every validator conjunct

`isValidCloudCompetition(data)` is one boolean function composed of the
following checks. Optional-field type checks pass when the field is absent.

| # | Predicate | Applicability to current constructor |
|---:|---|---|
| 1 | `data.keys().hasAll([...required keys...])` | Requires all 17 required keys listed below. Constructor supplies them. |
| 2 | `data.keys().hasOnly([...allowed keys...])` | Rejects any undocumented key. Constructor uses only required fields plus `allowSelfRegistration` and `controlTimeOffsets`. |
| 3 | `competitionId` is string, size 1–128, valid ID regex | Sanitized before writing; reported path/ID equality is true. |
| 4 | `shortCode` is string, size 2–32, valid ID regex | Sanitized, limited to 32; fallback `ev26` if shorter than 2. |
| 5 | `name` is string, size 1–140 | Trimmed, limited to 140, non-empty fallback. |
| 6 | `organizer` is string, size 1–100 | Trimmed, limited to 100, non-empty fallback. |
| 7 | `date` is string, size exactly 10, matches `YYYY-MM-DD` | Invalid/missing input uses `getStockholmTodayIso()`. |
| 8 | `status` is string, size 4–9 | Normalized from input. |
| 9 | `status` equals `LIVE`, `UPCOMING`, or `COMPLETED` | Constructor selects only those values. |
| 10 | `zeroTimeStr` is string, size 5–8, matches time regex | Invalid/missing input uses `18:00:00`; client and rule use the same regex. |
| 11 | `zeroTimeSec` is integer, 0–86400 | `clampInt()` rounds and clamps; fallback is 64800. |
| 12 | `arenaInfo` is string, size at most 500 | Trimmed and sliced to 500. |
| 13 | `seriesName` is string, size at most 80 | Trimmed and sliced to 80. |
| 14 | If present, `allowSelfRegistration` is boolean | Constructor applies `Boolean(...)`. |
| 15 | If present, `statusOverride` is boolean | Field is absent. |
| 16 | If present, `feeTrackingEnabled` is boolean | Field is absent. |
| 17 | If present, `enableFeesAndSwish` is boolean | Field is absent. The parent create rule also separately prohibits these two fee keys. |
| 18 | `competitorCount` is integer, 0–50000 | Constant `0`. |
| 19 | `finishedCount` is integer, 0–50000 | Constant `0`. |
| 20 | `finishedCount <= competitorCount` | `0 <= 0`. |
| 21 | `brokenControls` is list, size at most 64 | Empty list. |
| 22 | `brokenControls` is empty or its first value is integer | Empty list satisfies the empty branch. |
| 23 | If present, `controlTimeOffsets` is map, size at most 64 | Empty map. |
| 24 | If present, `pinStart` is string, size 4–6, digits only | Field is absent. |
| 25 | If present, `pinReadout` is string, size 4–6, digits only | Field is absent. |
| 26 | If present, `pinForest` is string, size 4–6, digits only | Field is absent. |
| 27 | If present, `pinSpeaker` is string, size 4–6, digits only | Field is absent. |
| 28 | If present, `pinsCustomized` is boolean | Field is absent. |
| 29 | `ownerUid` is string, size 1–128, valid ID regex | Runtime fact says it equals the authenticated UID; supplied UID is within the pattern and length. |
| 30 | `createdAt` is timestamp | Actual write uses `serverTimestamp()`. |
| 31 | `updatedAt` is timestamp | Actual write uses `serverTimestamp()`. |

Required keys are `competitionId`, `shortCode`, `name`, `organizer`, `date`,
`status`, `zeroTimeStr`, `zeroTimeSec`, `arenaInfo`, `seriesName`,
`competitorCount`, `finishedCount`, `brokenControls`, `ownerUid`, `createdAt`,
and `updatedAt`. (There are 16 distinct required keys.)

## Candidate ranking against the available payload evidence

This ranks what to inspect first; it does not assert that a field was actually
invalid. The literal runtime document was not supplied, so concrete dynamic
string values and the exact key set cannot be independently checked.

1. **Key-set mismatch (`hasAll` / `hasOnly`) — highest diagnostic priority,
   low likelihood if the current constructor ran.** An extra legacy field or a
   missing field would reject the document even if the visible values looked
   valid. The constructor itself builds a fresh object with no spread of import
   data, has every required key, and adds no unlisted optional keys.
2. **Runtime value differs from normalized source (`name`, `organizer`,
   `date`, `status`, `zeroTimeStr`, `arenaInfo`, `seriesName`) — low
   likelihood.** Malformed or out-of-range values would fail, but the current
   function trims/slices/falls back or normalizes each one before constructing
   `compDocData`. The actual diagnostic entry is needed to rule out an older
   deployed client or a different writer.
3. **Numeric type/range (`zeroTimeSec`, counters) — very low likelihood.**
   `zeroTimeSec` is rounded and clamped; the counters are literal zeroes. The
   installed Firestore Web SDK serializer encodes safe integer-valued
   JavaScript numbers as Firestore `integerValue`, so the rule's `is int` tests
   should not fail from ordinary integer serialization. A non-integer or
   unsafe/different value in the actual payload would still need checking.
4. **Map/list types (`controlTimeOffsets`, `brokenControls`) — very low
   likelihood.** The constructor sends `{}` and `[]`, which serialize as an
   empty map and list. The list's first-element test takes its empty-list
   branch. These could fail only if the actual write differs from the shown
   object or serialization input.
5. **Optional-field predicates — very low likelihood.** The only optional keys
   sent are a boolean and an empty map. Other optional keys are absent, which
   satisfies their `!hasAny(...) || ...` checks. An unexpected optional key
   with an invalid type would fail; an undeclared key would fail `hasOnly`.
6. **Timestamp type predicates — not a likely failure for the current write.**
   The transaction writes Firestore server timestamp transforms. At rule
   evaluation, these are server-side timestamp values, not the string labels in
   the diagnostic JSON.
7. **ID and owner formats — very low likelihood.** The IDs are sanitized and
   the supplied equality facts pass. The UID shown is a valid rule ID. An
   actual payload/path mismatch or different UID would contradict the supplied
   facts.

### Transforms, maps, lists, and coercion

- **Transforms:** The diagnostic object replaces `createdAt` and `updatedAt`
  with `"serverTimestamp()"` strings only to make JSON logging serializable.
  `transaction.set()` receives `compDocData`, whose values remain the actual
  `serverTimestamp()` transforms. Firestore documents that, for writes with
  server-side timestamps, `request.time` equals the resolved server timestamp
  ([Request.time reference](https://firebase.google.com/docs/reference/rules/rules.firestore.Request#time)).
  Thus these transforms satisfy both the validator's timestamp type checks and
  the separate create-rule equality checks, assuming this is the actual write.
- **Optional fields:** Omitted optional fields pass their guarded checks.
  Present fields are `allowSelfRegistration: boolean` and
  `controlTimeOffsets: {}`. The fee fields are absent and separately forbidden
  by the create rule.
- **Maps/lists:** `{}` is a map and `[]` is a list in Firestore. The empty
  `brokenControls` list passes the conditional first-element check.
- **Integer coercion:** `clampInt()` returns `Math.round()` of a bounded finite
  number. Constants are integer-valued. The installed Web SDK serializer
  serializes safe integer-valued JS numbers as Firestore integers, so normal SDK
  encoding should satisfy each `is int` check.

## How a valid-looking log could still mislead

1. The log shows a display representation, not a byte-for-byte server request.
   In particular the timestamp labels are strings in the diagnostic copy; the
   write object contains transforms.
2. The diagnostics file checked into the repository shows the payload shape,
   not the captured literal entry for the denied attempt. A field value, key, or
   type cannot be verified from that summary alone.
3. If the browser is running an older/different bundle, the current source
   normalization may not describe the actual submitted document.
4. Rule checks apply to `request.resource.data` as Firestore receives it. A
   client-side object preview cannot prove the active deployed validator or the
   exact request resource.

## Most likely failing field

**No field is identified as failing by the supplied evidence.** The current
source-level values for all fields satisfy the validator. If the exact runtime
payload is guaranteed to match this constructor, there is no supported
field-level root cause in the checked-in predicate.

## Most likely failing predicate

**`data.keys().hasOnly(...)` / the `isValidCloudCompetition()` key-and-value
conjunction is the highest-ranked candidate only because the exact runtime
document is missing.** No individual conjunct has been proven false. With the
literal payload matching the constructor and current rule source, the predicate
should pass; a denial would then falsify the assumption that those are the
actual request and active rules.

## Minimal verification step

Capture the full `[Competition create diagnostics]` entry for the same denied
attempt and inspect the literal `competitionDocument` keys and all non-timestamp
values. Treat the two `"serverTimestamp()"` strings as transform labels, not
stored strings. Compare that exact object with the 31 predicates above and the
active deployed `isValidCloudCompetition()`; do not change schema or replace
the timestamp transforms before this comparison.
