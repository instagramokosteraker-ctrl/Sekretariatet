# Competition Create Permission Denial

## Scope and finding

This report covers only creation of the parent document
`competitions/evt-1794665193520-840xhb`. The reported error says Firestore denied
the create at that path. It does not include the authenticated UID, the submitted
document, or the active deployed rules, so it cannot identify one failed
predicate with certainty.

The checked-in client payload is consistent with the checked-in
`isValidCloudCompetition()` validator. The most likely remaining cause is an
authorization mismatch at the active Firestore rules boundary—especially
`isAdmin()` being false for the request's exact UID in the database receiving
the write, or the deployed rules/database differing from the repository
configuration. The error by itself does not prove which.

## Request and write flow

`createCompetitionInFirestore(params)` in `src/firebase.ts`:

1. Gets the current Firebase user with `ensureValidFirestoreUser()` and requires
   `current.emailVerified`.
2. Derives `ownerUid` as `sanitizeFirestoreId(current.uid, 'usr')` and sanitizes
   the requested competition ID.
3. Forces an ID-token refresh, calls `ensureAdminRoleInFirestore(current)`, and
   runs `assertCanCreateCompetitionInFirestore()`. That preflight requires the
   refreshed token's `email_verified` claim, `ownerUid === current.uid`, and a
   non-null admin role.
4. Builds `compDocData`, reads the parent document in a Firestore transaction,
   and calls `transaction.set(compRef, compDocData)` if it does not exist.

The error's `operationType: "create"` and `path:
competitions/evt-1794665193520-840xhb` identify that parent-document write. The
failure is before any child or competitor writes.

## Payload sent to `competitions/{id}`

The complete object assembled by the current function is:

```ts
{
  competitionId,              // sanitized params.competitionId
  shortCode,                  // sanitized params.shortCode or "oko26"; fallback "ev26"
  name,                       // trimmed params.name, max 140; fallback "Tävling"
  organizer,                  // trimmed params.organizer, max 100; fallback "OK Österåker"
  date,                       // valid YYYY-MM-DD params.date or Stockholm current date
  status,                     // LIVE, UPCOMING, or COMPLETED; fallback UPCOMING
  zeroTimeStr,                // valid HH:mm[:ss] params value or "18:00:00"
  zeroTimeSec,                // clamped integer 0..86400; default 64800
  arenaInfo,                  // trimmed params value, max 500; default ""
  seriesName,                 // trimmed params value, max 80; default ""
  allowSelfRegistration,      // Boolean(params.allowSelfRegistration)
  competitorCount: 0,
  finishedCount: 0,
  brokenControls: [],
  controlTimeOffsets: {},
  ownerUid,                   // sanitizeFirestoreId(current.uid, "usr")
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
}
```

For the reported ID, `competitionId` is
`evt-1794665193520-840xhb`, which satisfies the rule's ID pattern and length.
Values dependent on the import and authenticated session are not present in the
error JSON, so their exact runtime contents cannot be recovered from it.

### Expected validator shape

`isValidCloudCompetition(data)` in `firestore.rules` requires these fields:

- `competitionId`, `shortCode`, `name`, `organizer`, `date`, `status`
- `zeroTimeStr`, `zeroTimeSec`, `arenaInfo`, `seriesName`
- `competitorCount`, `finishedCount`, `brokenControls`
- `ownerUid`, `createdAt`, `updatedAt`

The only allowed optional fields are `statusOverride`,
`allowSelfRegistration`, `feeTrackingEnabled`, `enableFeesAndSwish`,
`controlTimeOffsets`, `pinStart`, `pinReadout`, `pinForest`, `pinSpeaker`, and
`pinsCustomized`. The payload includes only the optional `allowSelfRegistration`
and `controlTimeOffsets`; both have the required types. No required fields are
missing and no disallowed fields are added by this constructor.

| Field | Rule constraint | Value produced here |
|---|---|---|
| `competitionId` | String, 1–128 chars, `[A-Za-z0-9_-]+` | Sanitized ID; reported ID is valid |
| `shortCode` | String, 2–32 chars, `[A-Za-z0-9_-]+` | Sanitized/fallback, max 32 |
| `name` | String, 1–140 chars | Non-empty fallback, max 140 |
| `organizer` | String, 1–100 chars | Non-empty fallback, max 100 |
| `date` | String, exactly 10 chars, `YYYY-MM-DD` pattern | Validated input or ISO date fallback |
| `status` | `LIVE`, `UPCOMING`, or `COMPLETED` | Normalized to one of these |
| `zeroTimeStr` | `HH:mm` or `HH:mm:ss` pattern, 5–8 chars | Validated input or `18:00:00` |
| `zeroTimeSec` | Integer, 0–86400 | Clamped integer, default 64800 |
| `arenaInfo` | String, max 500 | Trimmed string |
| `seriesName` | String, max 80 | Trimmed string |
| `allowSelfRegistration` | If present, boolean | Boolean |
| `competitorCount` | Integer, 0–50000 | `0` |
| `finishedCount` | Integer, 0–50000 and no greater than competitor count | `0` |
| `brokenControls` | List, max 64; first element if any must be integer | Empty list |
| `controlTimeOffsets` | If present, map, max 64 entries | Empty map |
| `ownerUid` | String, 1–128 chars, `[A-Za-z0-9_-]+` | Sanitized current UID |
| `createdAt`, `updatedAt` | Firestore timestamps | Server timestamp transforms |

## Create rule and predicates

The checked-in `firestore.rules` create rule for
`/competitions/{competitionId}` requires all of the following:

```text
isVerifiedUser()
isValidId(competitionId)
isValidCloudCompetition(incoming())
incoming() has neither feeTrackingEnabled nor enableFeesAndSwish
incoming().competitionId == competitionId
incoming().ownerUid == request.auth.uid
incoming().createdAt == request.time
incoming().updatedAt == request.time
isAdmin()
```

The field validator allows the two fee fields only as optional booleans, but
this create rule explicitly prohibits them. The current constructor sends
neither, so that extra restriction is satisfied.

### Owner UID check

The code sets `ownerUid` from the signed-in Firebase UID via
`sanitizeFirestoreId()`. The rule compares it to the raw
`request.auth.uid`, not to a sanitized UID. The current authorization preflight
checks `ownerUid === current.uid` before attempting the transaction. Thus, for
the current client code to reach the reported Firestore denial, that check must
have passed; the available error JSON does not expose either UID to independently
verify that the request used the same user/token.

If the deployed client predates that preflight, or if the auth user changes
between the preflight and Firestore request, the owner equality predicate can
still reject the write. The minimal correction in that case is to write the raw
Firebase UID as `ownerUid` and ensure the request uses that same authenticated
UID.

### Timestamp checks

Both fields are set with Firestore `serverTimestamp()` transforms in the
transaction. The rule requires each resolved timestamp to equal `request.time`.
Server timestamp transforms are intended to resolve to the request commit time,
so these checks should pass. The error JSON does not contain resolved values;
if a runtime trace shows either field is not a timestamp equal to `request.time`,
use the server timestamp transform in the actual deployed write and deploy the
matching rules.

## What can be determined from the evidence

The error identifies a denied create but does not reveal the failed rule
expression. From the current source, the payload's shape and normalized fields
appear valid. The preflight also rejects an unverified refreshed token, an
owner UID mismatch, or a missing client-visible admin role before the create.
Those source checks make a payload-schema failure less likely, but do not prove
the deployed app version or the claims and document read seen by Firestore.

The remaining rule gates that need runtime evidence are:

1. `request.auth.token.email_verified == true` in the token actually used by
   Firestore.
2. `incoming().ownerUid == request.auth.uid` for that same request.
3. Both resolved timestamp fields equaling `request.time`.
4. `isAdmin()`: the request must be verified and either use one of the
   bootstrapped admin emails or have a document at
   `/admins/{request.auth.uid}` in the same Firestore database.

An admin record observed in Firebase Console is conclusive only if its document
ID is exactly the request UID and it is in the same project and database as the
failed write. A client-side admin role value by itself is not what the rule
checks; `isAdmin()` checks the document's existence (or bootstrap email).

## Most likely cause and minimal fix

**Most likely:** the deployed request does not satisfy `isAdmin()` in the exact
Firestore project/database serving this write—because the admin document is
missing under the request's exact UID there, or because the active rules,
project, or database do not match the checked-in configuration. The client
constructor itself supplies no obvious missing or invalid competition fields.

**Minimal fix:** capture the actual request UID and token verification state,
then verify `/admins/{that exact UID}` and the active `competitions` create rule
in the same project/database used by the app. Deploy the checked-in
`firestore.rules` to that database if it is stale; otherwise correct the admin
document ID or owner UID to match the request. Do not weaken the schema or
remove the authorization checks based solely on this generic denial.

The supplied error payload is insufficient to say which individual predicate
failed. A repeat trace needs the actual `authInfo.userId`, the computed
`ownerUid`, and confirmation of the deployed rules/database before the root
cause can be called exact.
