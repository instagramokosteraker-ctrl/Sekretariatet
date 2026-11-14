# Active Firestore Ruleset Attestation

## Result: DIFFERENT RULESET

The current star-marked Firestore Rules version for the target database was
opened read-only in Firebase Console. Its active competition-create rule
differs materially from the repository rule and requires a field absent from
the captured import payload. No rules were changed or deployed, and no
production document was written.

Target database:

- Project: `ai-studio-applet-webapp-72c01`
- Database: `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`
- Scope: `/competitions/{competitionId}` `allow create`

## Active release metadata

| Requested value | Result |
|---|---|
| Active release label | Star-marked Console version labeled `Yesterday • 12:24 PM`; on Nov 14, 2026 this corresponds to Nov 13, 2026 at 12:24 PM. The Console did not show a timezone. |
| Release resource name | Not exposed in the Console version list |
| Ruleset resource name | Not exposed in the Console version list |
| Source hash | Not displayed; no full source export was available to hash |
| Source attached to target database | Retrieved from the selected database's Security/Rules version view |

## Read-only retrieval attempts

- Firebase CLI `15.35.0` is installed, but `firebase login:list` reports no
  authorized accounts.
- With consent, a no-localhost Firebase CLI sign-in was started; it requires
  the user to complete an authorization-code step. No authorization code was
  shared or entered, so the CLI remains unauthenticated.
- After user sign-in, the Firebase Console opened the exact target database
  and confirmed its database ID. The Security/Rules version list identified a
  star-marked version and exposed its source in the read-only editor.
- `gcloud` is not installed.
- A direct Rules API list request returned HTTP 403 because it had no
  authenticated API caller. The Console UI did not expose API resource names
  or a source hash.

The prior `DEPLOYED_RULE_ASSURANCE.md` records a Nov 11, 2026 Console
inspection and does not contain an immutable release identifier or source
hash. `DEPLOYED_COMPETITION_CREATE_VERIFICATION.md` says the competition
create path in the historical version inspected then matched the repository.
The currently star-marked version is later and has a different create rule,
which resolves the conflict between that historical finding and the current
failure.

## Repository comparison target

The checked-in rule in `firestore.rules` is:

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

The currently star-marked source contains:

```text
allow create: if isVerifiedUser() &&
  isValidId(competitionId) &&
  isValidCloudCompetition(incoming()) &&
  incoming().keys().hasAll(['feeTrackingEnabled']) &&
  !incoming().keys().hasAny(['enableFeesAndSwish']) &&
  incoming().competitionId == competitionId &&
  incoming().ownerUid == request.auth.uid &&
  incoming().createdAt == request.time &&
  incoming().updatedAt == request.time &&
  isAdmin();
```

### First material difference affecting create

The active rule requires
`incoming().keys().hasAll(['feeTrackingEnabled'])`. The repository rule
prohibits `feeTrackingEnabled` and `enableFeesAndSwish` instead. The exact
captured production payload contains neither field, so the active rule's new
`hasAll` predicate evaluates false and denies the create. This is the first
material difference after `isValidCloudCompetition(incoming())` in the
competition-create conjunction.

## Emulator evidence

The exact captured payload passed the full checked-in competition create rule
and each isolated create predicate in the Firestore Emulator. The active
Console source explains the production denial: it imposes the additional
`feeTrackingEnabled` key-presence requirement.

## Explicit answer

**DIFFERENT RULESET.**

The current star-marked source attached to the specified database has the
material `feeTrackingEnabled` requirement absent from `firestore.rules`.
Although the Console does not expose release/ruleset resource names or a source
hash, its current star marker and source view establish the active source
comparison and the first create-rule difference.

The active and repository rules are not identical, so the conditional
same-ruleset analysis does not apply. The captured payload omits
`feeTrackingEnabled`, directly violating the active rule's required-key
predicate.

## Next read-only step

To complete metadata attestation, retrieve the release and ruleset resource
names through an authenticated read-only Rules API request and hash a full
ruleset export. This metadata step is not needed to establish the material
create-rule difference shown in the active Console source. Do not publish or
edit rules as part of this verification.
