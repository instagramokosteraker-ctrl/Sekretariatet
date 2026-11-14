# Competition Create Diagnostics Plan

## Temporary instrumentation

`createCompetitionInFirestore()` now emits one JSON console entry immediately
before each parent competition transaction:

```text
[Competition create diagnostics] {"requestAuthUid":"...","ownerUid":"...", ...}
```

The entry includes:

| Log key | Meaning |
|---|---|
| `requestAuthUid` | Firebase Auth UID used by the Firestore client at this create call |
| `ownerUid` | Exact owner UID field in the proposed document |
| `ownerUidEqualsRequestAuthUid` | Whether those two values match |
| `emailVerified` | Refreshed ID token's `email_verified` claim |
| `isAdmin` | Client-side evaluation of the rule condition from bootstrap-email check or the admin-role lookup |
| `isBootstrapAdmin` | Whether the refreshed token email matches either bootstrap admin email |
| `adminDocumentRole` | Role returned by the admin lookup, or `null` |
| `databaseId` | Firestore database ID configured for this app (`(default)` if unset) |
| `projectId` | Firebase project configured for this app |
| `competitionId` | Document path ID used by this create |
| `competitionIdEqualsDocumentId` | Whether the payload's `competitionId` equals the target document ID |
| `isAdminSource` | Clarifies that `isAdmin` is locally inferred; Firestore does not return rule evaluation details |

This log is emitted for every attempt that passes the function's existing
authentication/admin preflight and reaches the parent-document transaction.
The existing permission-denied handler continues to log the operation/path.

## Reading the next failed attempt

Compare the values in one console entry:

1. `requestAuthUid` should be exactly
   `8hErgYh3H0NxftC8UE8d2tPecPV2` if the known admin document belongs to the
   account performing the import.
2. `ownerUidEqualsRequestAuthUid` and
   `competitionIdEqualsDocumentId` should both be `true`.
3. `emailVerified` and `isAdmin` should be `true`.
4. `projectId` and `databaseId` must match the Firebase Console location where
   `admins/8hErgYh3H0NxftC8UE8d2tPecPV2` was confirmed.

A `false` value identifies a corresponding client-observed authorization or
identity mismatch. If all values are true and the create is still denied, the
log does not prove that the deployed rules evaluated those values identically:
Firestore does not expose a per-predicate evaluation trace to web clients.
In that case, verify the active rules on the logged project/database and inspect
the precise admin document path there. Also verify the actual transaction
payload and the `createdAt`/`updatedAt` server timestamp transforms, which are
required to equal `request.time`.

The `isAdmin` field is a client-side prediction of the rule's `isAdmin()`:
bootstrap email or an admin role returned by the client lookup. The rules
themselves check verified auth plus bootstrap email or existence of
`admins/{request.auth.uid}`. It is not a server-provided predicate result.
Firestore Rules do not return which conjunct rejected a request.

## Removal

This logging is temporary and includes the user's Firebase UID in browser
console output. After one denied attempt has been captured and compared with the
active rules/database, remove the diagnostic object and `console.info` call from
`src/firebase.ts`.
