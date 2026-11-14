# Competition Create Diagnostics

## Scope

The Eventor API succeeds. The import then calls
`createCompetitionInFirestore()` and fails while creating
`competitions/{id}`. This report does not cover competitor or assignment
creation.

The temporary diagnostic is emitted inside the transaction callback
immediately before `transaction.set(compRef, compDocData)`. It records:

- Firebase project and configured Firestore database IDs
- current Firebase Auth UID and the document's `ownerUid`
- client-observed owner/UID equality and refreshed token
  `email_verified` claim
- the client-side admin result, bootstrap result, and admin role returned by
  `ensureAdminRoleInFirestore()`
- the competition ID and payload/path equality
- the complete normalized competition document; timestamp transforms are
  rendered as the literal `serverTimestamp()` so the intended write is clear

The console entry is tagged `[Competition create diagnostics]`. A transaction
callback retry can emit more than one entry for the same function call.

The current app config targets:

- Project: `ai-studio-applet-webapp-72c01`
- Database: `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`

Confirm the known admin document is in this exact project/database, not merely
in a similarly named/default database.

## Normalized parent payload

`createCompetitionInFirestore()` builds and logs the following shape:

```ts
{
  competitionId,          // sanitized input; also target document ID
  shortCode,              // sanitized or "oko26"; fallback "ev26"
  name,                   // trimmed, max 140; fallback "Tävling"
  organizer,               // trimmed, max 100; fallback "OK Österåker"
  date,                    // valid YYYY-MM-DD or current Stockholm date
  status,                  // LIVE | UPCOMING | COMPLETED
  zeroTimeStr,             // valid HH:mm[:ss] or "18:00:00"
  zeroTimeSec,             // integer clamped to 0..86400; default 64800
  arenaInfo,               // trimmed, max 500; default ""
  seriesName,              // trimmed, max 80; default ""
  allowSelfRegistration,   // boolean
  competitorCount: 0,
  finishedCount: 0,
  brokenControls: [],
  controlTimeOffsets: {},
  ownerUid,                 // sanitized current Firebase UID
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
}
```

There are no extra fields in this constructor. In particular it does not send
`feeTrackingEnabled` or `enableFeesAndSwish`, which the competition create rule
explicitly prohibits.

## Create-rule checklist

The checked-in rule in `firestore.rules` requires all of the predicates below.
“Client status” describes the current code/payload and the diagnostic values;
it is **not** a server-returned rule evaluation. Firestore reports only the
generic permission denial, not which conjunction evaluated false.

| Predicate | Checklist | Evidence / how to read the next log |
|---|---|---|
| `isVerifiedUser()` | [x] **PASS** / [ ] FAIL — client preflight | Function requires `current.emailVerified` and refreshed `email_verified`; diagnostic logs the refreshed claim. Server result is not exposed. |
| `isValidId(competitionId)` | [x] **PASS** / [ ] FAIL — by construction | `sanitizeFirestoreId()` restricts IDs to `[A-Za-z0-9_-]`; compare logged ID to the path. |
| `isValidCloudCompetition()` | [x] **PASS** / [ ] FAIL — current normalized constructor | Required fields are present; values are normalized to the rule's bounds/types; optional keys sent are allowed and correctly typed. Check the logged `competitionDocument` if runtime parameters differ. |
| `ownerUid == request.auth.uid` | [x] **PASS** / [ ] FAIL — client preflight | `assertCanCreateCompetitionInFirestore()` rejects a mismatch before the transaction. Confirm logged UID is exactly the UID in the active database's admin document. Server result is not exposed. |
| `createdAt == request.time` | [x] **PASS expected** / [ ] FAIL | `createdAt` is written with the Firestore `serverTimestamp()` transform, which should resolve to `request.time`; the browser cannot inspect the server-resolved timestamp. |
| `updatedAt == request.time` | [x] **PASS expected** / [ ] FAIL | Same server timestamp behavior as `createdAt`. |
| `isAdmin()` | [x] **PASS predicted** / [ ] FAIL — client preflight | Client result is derived from bootstrap email or the admin role lookup. The rule independently checks bootstrap email or existence of `/admins/{request.auth.uid}` in the database receiving the write. Server result is not exposed. |

`isValidCloudCompetition()` requires `competitionId`, `shortCode`, `name`,
`organizer`, `date`, `status`, `zeroTimeStr`, `zeroTimeSec`, `arenaInfo`,
`seriesName`, `competitorCount`, `finishedCount`, `brokenControls`, `ownerUid`,
`createdAt`, and `updatedAt`. It allows only those fields plus its declared
optional fields. The logged document contains the required set and only allowed
optional fields (`allowSelfRegistration` and `controlTimeOffsets`).

## Current diagnosis

The supplied error does not contain a UID, payload, project/database ID, or
rule-evaluation trace. Therefore **no predicate can honestly be labeled as a
server-confirmed `FAIL` yet**.

The single most likely predicate to verify first is **`isAdmin()`**. The known
document `admins/8hErgYh3H0NxftC8UE8d2tPecPV2` proves this predicate only if the
failed request's authenticated UID is exactly that ID and the document exists
in the logged project and named database. The current preflight makes a missing
client-visible admin role unlikely, but it cannot prove the active rules
evaluated the same request identity and database. If the next log confirms the
same UID/project/database and admin role, this hypothesis is weakened; compare
the active deployed rules and investigate the timestamp and payload predicates
instead.

## Evidence needed from the next attempt

Capture the full tagged console entry and the matching permission error. Check:

1. `requestAuthUid` equals
   `8hErgYh3H0NxftC8UE8d2tPecPV2`.
2. `projectId` and `databaseId` are the location where that admin document was
   verified.
3. `ownerUidEqualsRequestAuthUid` and
   `competitionIdEqualsDocumentId` are `true`.
4. `emailVerified`, `isAdmin`, and `adminDocumentRole` show a verified,
   admin-authorized user.
5. The complete `competitionDocument` has the expected fields and normalized
   values.

If these client observations all pass and Firestore still denies the create,
they do not reveal which server-side predicate failed. Firestore Security Rules
do not expose per-predicate evaluation to a web client. The next comparison must
be against the rules actually deployed to the logged project/database; do not
treat the client-side `isAdmin` estimate or timestamp expectation as a server
trace.

The instrumentation is temporary and logs the authenticated UID and full
competition document to the browser console. Remove it after capturing the
diagnostic attempt.
