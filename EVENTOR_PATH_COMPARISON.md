# Eventor Member Sync vs. Competition Import

## Summary

Eventor member sync and Eventor competition import both use the same Firebase
project/database and both are intended for verified administrators. They do
**not** write through the same Firestore path or match the same rule:

- Member sync writes runner records to `runnerDb/{siNumber}`.
- Competition import first creates `competitions/{competitionId}`.

The member sync's success confirms that its `runnerDb` write(s) were accepted.
It does not test the competition document schema or the
`/competitions/{competitionId}` create rule. The import fails at that separate
parent create before its later child/import writes execute.

## 1. Eventor member sync

### Flow and Firestore writes

`onSyncEventorClub` in `src/App.tsx`:

1. Fetches the Eventor organization and competitor-list XML through
   `fetchEventorXml()`.
2. Parses the Eventor results and maps SI-card members to runner database
   entries.
3. Calls `saveRunnerDbEntriesToFirestore(runnerDbEntries)`.

The Eventor proxy/API calls return data; they do not write Firestore. The only
Firestore collection written by this member-sync handler is:

```text
runnerDb/{siNumber}
```

`saveRunnerDbEntriesToFirestore()` first reads runner records to reconcile
existing Eventor identity data. It then uses `writeBatch(db)` in chunks of up
to 400 and `batch.set(..., { merge: true })` for each runner. Firestore applies
the `create` rule when a document does not exist and the `update` rule when it
already exists. There is no `runTransaction()` in this member-sync write path.

### Matched rule

`firestore.rules` matches:

```text
match /runnerDb/{siNumber}
```

Its create rule requires verified auth, a valid path ID, a valid
`isValidCloudRunnerDbEntry(incoming())` payload, `runnerId == siNumber`,
`ownerUid == request.auth.uid`, both timestamps equal to `request.time`, and
`isAdmin()`.

For existing runner documents, the update rule additionally requires the
existing runner ID, SI number, owner UID, and created timestamp to remain
unchanged. Only its explicit mutable-field allowlist may change; `updatedAt`
must equal `request.time`; and `isAdmin()` is still required.

### Client authorization preflight

`ensureRunnerDbAdmin()` requires a signed-in, verified Google provider. It
accepts a bootstrap administrator or a user whose `/admins/{uid}` record has
role `RACE_ADMIN` or `SUPER_ADMIN`. The save helper repeats the role lookup to
determine super-admin behavior.

The Firestore rule itself does not test the Google provider ID or the admin
document's role value; it requires `isVerifiedUser()` and `isAdmin()`.

## 2. Eventor competition import

### Flow and Firestore writes

`handleCreateEventorCompetition()` in `src/App.tsx` builds the competition,
classes, competitors, and runner records, then calls these steps in order:

1. `createCompetitionInFirestore()` creates the parent document at
   `competitions/{competitionId}` using `runTransaction(db, ...)`. It reads the
   target document and calls `transaction.set(compRef, compDocData)` if it does
   not already exist. **This is the currently failing write.**
2. If the parent create succeeds, it writes initial course/class documents
   using queued write batches:
   - `competitions/{competitionId}/courses/{courseId}`
   - `competitions/{competitionId}/classes/{classId}`
   
   The Eventor callback supplies no courses and supplies its parsed/generated
   classes.
3. `createCompetitionInFirestore()` creates or updates
   `clubSettings/default` to register the new competition. The Eventor call
   passes `activateOnCreate: false`, so it does not make this new event active
   at this step.
4. `saveCompetitionImportToFirestore()` writes/upserts classes and any courses
   and `runnerDb/{siNumber}` entries with write batches. It writes imported
   competitors with their matching SI assignments through
   `writeImportedCompetitorWithAssignment()` and
   `runAtomicSIAssignmentMutation()`, which uses Firestore transactions.
5. `activateCompetitionInFirestore()` later updates `clubSettings/default` to
   activate the imported competition.

The whole import is **not one transaction**. The parent create transaction
commits separately from the child batches, import batches, competitor/
assignment transactions, and activation update. Since the parent create is
denied, the later steps are not reached in this failed attempt.

### Rules matched by the import

| Write path | Firestore rule match | Write mechanism |
|---|---|---|
| `competitions/{competitionId}` | Parent competition `allow create` | `runTransaction()`; `transaction.set()` |
| `competitions/{competitionId}/courses/{courseId}` | Nested `courses` create/update rules | Queued `writeBatch` |
| `competitions/{competitionId}/classes/{classId}` | Nested `classes` create/update rules | Queued `writeBatch` |
| `runnerDb/{siNumber}` | Runner DB create/update rules | `writeBatch` in import helper |
| `competitions/{competitionId}/competitors/{competitorId}` | Nested competitor create/update rules | `runAtomicSIAssignmentMutation()` transaction |
| `competitions/{competitionId}/siCardAssignments/{siNumber}` | Nested SI assignment create/update rules | Same transaction as competitor |
| `clubSettings/default` | Club settings create/update rules | `setDoc()` or `updateDoc()`; activation later uses `updateDoc()` |

These are the potential paths for a successful import; only the first row is
attempted before the observed failure.

### Parent-create rule

The parent create matches `/competitions/{competitionId}` and requires:

- verified user;
- valid competition path ID;
- `isValidCloudCompetition(incoming())`;
- no `feeTrackingEnabled` or `enableFeesAndSwish` keys;
- payload `competitionId` equals the path ID;
- payload `ownerUid` equals the authenticated UID;
- `createdAt` and `updatedAt` equal `request.time`;
- `isAdmin()`.

Its schema validator is competition-specific and is not run by the successful
member-sync write.

### Client authorization preflight

Before attempting the parent transaction,
`createCompetitionInFirestore()` requires a verified Firebase user, refreshes
the ID token, calls `ensureAdminRoleInFirestore()`, and asserts verified-token
status, owner UID equality, and a non-null admin role.

Compared with member sync, the competition-create helper does not explicitly
check the Google provider ID in this function. Both flows still require an
admin role at the client preflight, while both matching Firestore rules require
verified auth and `isAdmin()`. The primary distinction is the rule and
document being evaluated, not a weaker competition authorization role.

## Authorization and transaction comparison

| Aspect | Eventor member sync | Eventor competition import |
|---|---|---|
| First Firestore write | `runnerDb/{siNumber}` | `competitions/{competitionId}` |
| Rule validator | `isValidCloudRunnerDbEntry()` | `isValidCloudCompetition()` |
| Server-side role gate | Verified user + `isAdmin()` | Verified user + `isAdmin()` |
| Path/data identity check | `runnerId == siNumber` | `competitionId == competitionId` path segment |
| Owner check | Create owner equals auth UID; update owner must remain unchanged | Create owner equals auth UID |
| Timestamp check | Create timestamps equal request time; update preserves create time and sets update time to request time | Create timestamps both equal request time |
| Primary write API | `writeBatch`, merge set, up to 400 entries per batch | `runTransaction`, read target then set parent |
| User-provider preflight | Explicitly requires Google provider | Requires verified user/admin role; no explicit provider test in this function |
| Atomic scope | Each chunked batch is atomic | Parent create is atomic with its existence read only; later import steps are separate |

Member sync may be updating existing runner documents, creating new runner
documents, or doing both. Its success means those runner payloads and
`runnerDb` rules passed for the operations performed. It says nothing about
whether the distinct competition document satisfies its key set, field types,
fee-key exclusion, timestamps, and path equality.

## Answer: Why can member sync succeed while competition create fails?

Because success is path- and operation-specific. Member sync writes
`runnerDb/{siNumber}` under its runner-entry validator and may be using the
runner update rule. Competition import first attempts a **new document create**
at `competitions/{competitionId}` under a different validator and additional
competition-specific checks. Passing the `runnerDb` rule does not grant blanket
write permission to other collections.

The two flows have comparable verified-admin authorization requirements.
Therefore member-sync success supports that the account can perform its
runner-DB operation; it does not prove that the competition payload passes the
competition-create rule or that the separate parent transaction is allowed.
