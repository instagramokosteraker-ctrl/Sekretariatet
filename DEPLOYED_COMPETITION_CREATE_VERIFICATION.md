# Deployed Competition Create Verification

## Scope and current evidence

This report covers only the parent document rule
`/competitions/{competitionId}` `allow create`.

The configured target is:

- Project: `ai-studio-applet-webapp-72c01`
- Firestore database: `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`

`DEPLOYED_RULE_DIFF.md` records a full token-level comparison of the
star-marked deployed release inspected on **2026-11-11** against the repository
source. It found no difference in the competition-create rule path; the
reported material differences were in other rule areas. This is evidence that
the inspected Nov 11 release had the same competition-create conditions as the
repository.

It does **not** prove that the same release is active now. The prior assessment
did not capture an immutable release hash, and no active-release source or
hash for the current attempt is present in the supplied files. A fresh,
read-only release/source retrieval is required to prove current parity.

## Repository rule

The repository create condition is:

```text
allow create: if isVerifiedUser() &&
  isValidId(competitionId) &&
  isValidCloudCompetition(incoming()) &&
  !incoming().keys().hasAny([
    'feeTrackingEnabled',
    'enableFeesAndSwish'
  ]) &&
  incoming().competitionId == competitionId &&
  incoming().ownerUid == request.auth.uid &&
  incoming().createdAt == request.time &&
  incoming().updatedAt == request.time &&
  isAdmin();
```

The known runtime facts report verified auth, admin/bootstrap status, owner
equality, and payload/path equality as true. The repository code writes server
timestamp transforms, which are expected to resolve to `request.time`. The
remaining significant payload condition is `isValidCloudCompetition()`.

## Single create payload expected to be allowed

Use this single-document payload with the repository rule. In a Web SDK
rules-unit test, `serverTimestamp()` below is the Firestore transform, not a
string:

```ts
const competitionId = 'diag-create-probe-20261114';
const uid = '8hErgYh3H0NxftC8UE8d2tPecPV2';

const payload = {
  competitionId,
  shortCode: 'diag14',
  name: 'Rules Probe',
  organizer: 'OK Österåker',
  date: '2026-11-14',
  status: 'UPCOMING',
  zeroTimeStr: '18:00:00',
  zeroTimeSec: 64800,
  arenaInfo: '',
  seriesName: '',
  allowSelfRegistration: false,
  competitorCount: 0,
  finishedCount: 0,
  brokenControls: [],
  controlTimeOffsets: {},
  ownerUid: uid,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
};
```

The request path is `competitions/diag-create-probe-20261114`. Run it as an
authenticated user with UID `8hErgYh3H0NxftC8UE8d2tPecPV2`, token claims
`email_verified: true` and
`email: "instagram.okosteraker@gmail.com"`. This exercises the rule's
bootstrap-admin branch and avoids relying on existing admin-document state.
The date is a syntactically valid ISO date; the rule validates the string
pattern, not whether the calendar date is in the past.

The payload has all required keys, no unknown keys, valid field types/ranges,
neither prohibited fee key, matching document/payload IDs, matching owner UID,
and two server timestamp transforms.

## Read-only verification against the active release

### 1. Retrieve the exact currently released source

Use either the Firebase Console or the Rules REST API with an account that has
read permission. Do not edit or publish any rules.

**Console route**

1. Select project `ai-studio-applet-webapp-72c01`.
2. Select Firestore database
   `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`.
3. Open Firestore **Rules** and identify the currently published/active
   release, not an unsaved editor draft.
4. Copy/export its source and note the active release timestamp/identifier and
   selected database.

**Read-only Rules API route**

The Firebase Rules API supports read-only `GET` requests:

1. List project releases:

   ```text
   GET https://firebaserules.googleapis.com/v1/projects/ai-studio-applet-webapp-72c01/releases
   ```

2. Select the Firestore release attached to the exact database above. Record
   its release name, ruleset name, and release metadata.
3. Retrieve that release and its immutable ruleset source:

   ```text
   GET https://firebaserules.googleapis.com/v1/{release-name}
   GET https://firebaserules.googleapis.com/v1/{ruleset-name}
   ```

   The ruleset response includes the source files. Use the `firebase.readonly`
   OAuth scope. These calls do not deploy rules or write Firestore documents.

4. Compare the returned source at `isVerifiedUser()`,
   `isValidCloudCompetition()`, and
   `/competitions/{competitionId} allow create` with the repository
   `firestore.rules`. Save the release/ruleset identifiers and a source hash so
   the result is tied to a specific active ruleset.

The Firebase Rules API references document [`projects.releases.list`](https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/list),
[`projects.releases.get`](https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/get),
and [`projects.rulesets.get`](https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets/get).

### 2. Simulate the create without touching production data

For an interactive check, use Firebase Console **Rules Playground** against the
selected database's active published source:

- Simulation type: `create`
- Location: `competitions/diag-create-probe-20261114`
- Authentication UID: `8hErgYh3H0NxftC8UE8d2tPecPV2`
- Auth claims: verified email and bootstrap email shown above
- Request data: the payload above

The Playground simulates an allow/deny result; it does not commit the document.
If the Playground cannot express the server timestamp transforms or set both
fields equal to its simulated `request.time`, use an isolated Firestore
Emulator test instead: load the exact rules source retrieved in step 1, use
the same database ID and auth claims, and submit the payload through the Web
SDK with the two actual `serverTimestamp()` transforms. That writes only to the
local emulator, not production.

Do not treat an emulator run using the repository file alone as a deployed-rule
test. The emulator must load the source fetched from the active release. The
read-only source retrieval plus that isolated simulation proves how the
currently identified deployed ruleset evaluates this payload without
performing a production create.

## Interpretation

- **Simulation allowed + exact source matches repository:** the current
  deployed competition-create rule is the same rule analyzed in the
  repository, and this probe payload passes it. This does not by itself prove
  that the real failed request had identical payload bytes/values.
- **Simulation denied + source differs:** the active deployed source mismatch
  is established; inspect the specific differing create predicate.
- **Simulation denied + source matches:** inspect the simulator inputs and
  then compare the real failed request's complete incoming document to this
  payload. Do not infer the failed field from the generic production error.

## Answer

**Is there any remaining evidence that the repository rules are the rules
actually denying this write? YES — but only historical, path-specific
evidence.** The Nov 11 deployed-source comparison reported no difference at the
competition-create path, so it supports that the repository create rule was
also present in that inspected release. It does not prove that release is
still active for the Nov 14 failure. Only a fresh read-only retrieval of the
current release and its ruleset source can establish current parity.
