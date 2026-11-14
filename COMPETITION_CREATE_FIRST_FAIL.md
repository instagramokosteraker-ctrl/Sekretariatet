# Competition Create: First Failing Predicate

## Result: no repository-rule predicate failed

The literal diagnostic entry and failed commit request were supplied. An
emulator-only reproduction using the exact document values and the checked-in
`firestore.rules` **succeeded**. Every create predicate also succeeded when
isolated. Therefore there is no first failing predicate in the repository
rules for this payload.

## Evidence available

- The create rule in `firestore.rules` checks, in order:
  `isVerifiedUser()`, `isValidId(competitionId)`,
  `isValidCloudCompetition(incoming())`, absence of prohibited fee keys,
  payload/path ID equality, owner UID equality, both timestamp equalities,
  and `isAdmin()`.
- The diagnostic payload's `createdAt` and `updatedAt` strings are labels.
  The failed commit's wire representation confirms both were actual
  `REQUEST_TIME` transforms.
- The reproduction used authenticated UID
  `8hErgYh3H0NxftC8UE8d2tPecPV2`, `email_verified: true`, and seeded the
  corresponding admin document in the emulator. `isAdmin()` in the repository
  rules only requires the admin document to exist.
- The failed request targeted the named Firestore database
  `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`. The
  `@firebase/rules-unit-testing` harness used its isolated emulator database
  (the default database), not the production named database. The checked-in
  rules are identical source text; this does not verify which rules are
  deployed to the production database.

## Reproduced document

The test wrote the exact document values from the supplied diagnostic, using
the actual Firestore transforms confirmed in the failed commit request:

```ts
{
  competitionId: 'evt-1794686784065-ttfc9g',
  shortCode: 'ev698h830',
  name: 'OK Österåker, medel',
  organizer: 'OK Österåker',
  date: '2026-09-20',
  status: 'UPCOMING',
  zeroTimeStr: '18:00:00',
  zeroTimeSec: 64800,
  arenaInfo: '',
  seriesName: '',
  allowSelfRegistration: true,
  competitorCount: 0,
  finishedCount: 0,
  brokenControls: [],
  controlTimeOffsets: {},
  ownerUid: '8hErgYh3H0NxftC8UE8d2tPecPV2',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
}
```

The test did not use the API key from the logged request URL.

## Predicate results

| Rule order | Predicate | Emulator result |
|---:|---|---|
| 1 | `isVerifiedUser()` | **PASS** |
| 2 | `isValidId(competitionId)` | **PASS** |
| 3 | `isValidCloudCompetition(incoming())` | **PASS** |
| 4 | No prohibited fee keys | **PASS** |
| 5 | `incoming().competitionId == competitionId` | **PASS** |
| 6 | `incoming().ownerUid == request.auth.uid` | **PASS** |
| 7 | `incoming().createdAt == request.time` | **PASS** |
| 8 | `incoming().updatedAt == request.time` | **PASS** |
| 9 | `isAdmin()` | **PASS** |
| — | Full competition create rule | **PASS** |

Each predicate was tested in a separate emulator rules variant containing the
same helper functions and the exact predicate. The full unmodified repository
rules were also tested. The emulator output was:

```text
full competition create rule: PASS
isVerifiedUser(): PASS
isValidId(competitionId): PASS
isValidCloudCompetition(incoming()): PASS
prohibited fee keys absent: PASS
competitionId equals path ID: PASS
ownerUid equals auth UID: PASS
createdAt equals request.time: PASS
updatedAt equals request.time: PASS
isAdmin(): PASS
```

## Conclusion

**First failing predicate: NONE in the checked-in repository rules.** The
full repository create rule accepts this payload in the emulator. Thus the
reported production denial cannot be reproduced from the supplied values
against these rules. This result points to a difference outside this local
reproduction—such as the deployed rules or production database context—but
does not identify which one. Do not change the payload or repository rule on
the basis of this emulator result alone.
