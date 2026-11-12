# Server-side enforcement phase 2: assignment owner parity

## Result

**FAIL** — the mismatched-owner assertion still succeeds against the current
repository Rules. No effective Rules change or backend transaction change is
included in this result. No deployment was performed.

## Failing write and required parity

The test seeds an active assignment at
`competitions/evt_live/siCardAssignments/8500119` with:

- `ownerUid`: `race_admin_2`
- `competitorId` and `competitorDocumentId`:
  `cmp_wrong_assignment_owner`

It then attempts to create
`competitions/evt_live/competitors/cmp_wrong_assignment_owner` as
`race_admin_1`, with `siNumber: 8500119` and `ownerUid: race_admin_1`.
The assignment and competitor refer to the same event, SI number, and
competitor ID, but their owner UIDs differ. The expected parity check is
`assignment.ownerUid == competitor.ownerUid`.

The `assertFails` expectation is valid: an active assignment for that SI
identity must not be accepted under a different owner.

## Rules trace

The earlier competitor-create Rules path called
`hasActiveSIAssignmentAfter(...)`. Its assignment predicate compared the
assignment's post-commit owner with the incoming competitor owner
(`getAfter(assignmentPath).data.ownerUid == ownerUid`). That is the check which
rejected this mismatch.

The current competitor `allow create` validates the incoming competitor
schema, path IDs, `ownerUid == request.auth.uid`, timestamps, parent
competition, and role. It no longer compares that owner with the assignment
document. Consequently, the `race_admin_1` request satisfies the current
create predicates even though the pre-seeded assignment belongs to
`race_admin_2`.

## Backend enforcement status

The client-side Atomic SI Matching flow contains assignment checks:

- `writeImportedCompetitorWithAssignment(...)` checks
  `assignmentMatchesCompetitorIdentity(...)` before writing;
- direct-entry creation plans the assignment write and rejects conflicts.

Those checks run in `src/firebase.ts` using the browser Firebase SDK. They are
not a trusted boundary: the failing test writes directly to Firestore and
bypasses those functions. The existing trusted Admin transaction handles SI
assignment retirement, not competitor creation. It therefore does not replace
the removed competitor-create parity check.

**Classification: backend enforcement is missing for competitor-create owner
parity.** The current client-side checks are not incorrect for callers that
use them; they are bypassable. The test expectation is not obsolete.

## Attempt and validation

A narrow competitor-create Rules owner-parity check was tried, but repeated
emulator runs still reported `Expected request to fail, but it succeeded` at
the mismatched-owner assertion. The diagnostic Rules edits were removed rather
than leaving an unverified or ineffective guard. The test payload now states
`ownerUid: 'race_admin_1'` explicitly.

- Build: **PASS**
- Lint/type-check: **PASS**
- `runFirestoreRulesDirtyDozenSuite()`: **FAIL** at the mismatched-owner
  `assertFails` in `firestore.rules.test.ts`
- Production deployment: not performed

## Remaining responsibility

Trusted server-side competitor creation must read the competition, competitor,
and SI assignment in one transaction, reject an active assignment whose
`ownerUid` differs from the authenticated owner, and commit the competitor and
assignment atomically. Until that path exists and direct client creates are
securely constrained, the Atomic SI Matching client helper does not replace
the Rules check.
