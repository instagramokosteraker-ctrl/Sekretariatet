# Competition Create Rule Diff

## Result

For the deployed release inspected on **2026-11-11**, the available source
comparison found **no material or token-level difference** at
`/competitions/{competitionId}` `allow create` versus the repository rule.
That inspection compared the full Console source token-by-token (ignoring
whitespace/comments); `DEPLOYED_RULE_DIFF.md` states that the differences it
found were elsewhere and that all other compared source tokens were equal.

The deployed release was identified as the Console's star-marked/current
release at that inspection time. Its immutable revision ID/hash was not
available, and there is no newer deployment evidence in the files reviewed.
Thus, this is a comparison to the release inspected on Nov 11, not fresh
attestation of the live release on Nov 14.

## Repository create rule

The current `firestore.rules` condition is:

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

For the inspected deployed release, the path comparison identified no
differences in this condition or its referenced helpers relevant to this
create:

| Create-path element | Repository | Inspected deployed release | Difference |
|---|---|---|---|
| `isVerifiedUser()` | Requires signed-in user and `email_verified == true` | No difference identified | None |
| `isValidId(competitionId)` | String, 1–128 characters, `[A-Za-z0-9_-]+` | No difference identified | None |
| `isValidCloudCompetition(incoming())` | Required/allowed keys and field constraints in repository rules | No difference identified | None |
| Prohibited fee keys | Rejects `feeTrackingEnabled` and `enableFeesAndSwish` on create | No difference identified | None |
| Payload ID equals path ID | `incoming().competitionId == competitionId` | No difference identified | None |
| Owner equals auth UID | `incoming().ownerUid == request.auth.uid` | No difference identified | None |
| Create timestamps | Both equal `request.time` | No difference identified | None |
| `isAdmin()` | Bootstrap-email branch or verified user with matching admin document | No difference identified | None |

The known deployed/repository differences recorded in
`DEPLOYED_RULE_DIFF.md` concern competitor, SI-assignment, and readout
predicates. They are outside this parent competition create rule and cannot
explain a denial of `competitions/{id}` under the inspected release.

## Logged create facts

For the failing attempt, the reported diagnostics are:

- `requestAuthUid == ownerUid`
- `emailVerified == true`
- `isAdmin == true`
- `isBootstrapAdmin == true`
- `competitionIdEqualsDocumentId == true`

Taken at face value, these facts satisfy the corresponding identity and admin
checks in the repository rule. In particular, when `isBootstrapAdmin` is true
and the user is verified, `isAdmin()` succeeds without needing the `admins`
document lookup.

The supplied facts do not include the full captured `competitionDocument` or
the server-resolved timestamp values. The client writes `createdAt` and
`updatedAt` with `serverTimestamp()` transforms, which are expected to equal
`request.time`; that equality is not confirmed by the generic error response.

## Which difference could deny this payload?

**No create-path difference was identified in the inspected deployed release.**
The unrelated deployed differences cannot deny the parent create.

The current evidence therefore points more toward **B. payload/schema
mismatch** than **A. deployed-rule mismatch**. Within the create predicate list,
the remaining items to verify against the exact logged payload are
`isValidCloudCompetition()` (including key/type/range constraints) and the two
timestamp-to-`request.time` checks. The reported booleans rule out the supplied
owner, auth, admin, and path-ID comparisons for this attempt, assuming they
describe the same request and configured project/database.

## A/B assessment

- **A. Deployed-rule mismatch:** less likely.
- **B. Payload/schema mismatch:** more likely.
- **Confidence:** **80% B / 20% A**.

The confidence is not higher because the Console comparison is dated Nov 11,
has no immutable release hash, and does not attest that no later rules
deployment occurred. The current payload values and server-resolved timestamps
were also not included in the facts supplied for this assessment. A new
read-only comparison of the active release and the complete failing
`competitionDocument` would resolve those remaining uncertainties without
changing rules.
