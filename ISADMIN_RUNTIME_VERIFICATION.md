# `isAdmin()` Runtime Verification

## Result

The app's configured Firestore target is:

- **Project ID:** `ai-studio-applet-webapp-72c01`
- **Database ID:** `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`
- **Authenticated UID reported by the failed request:** `8hErgYh3H0NxftC8UE8d2tPecPV2`

The admin document must therefore be checked at this exact fully qualified
resource:

```text
projects/ai-studio-applet-webapp-72c01/databases/ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df/documents/admins/8hErgYh3H0NxftC8UE8d2tPecPV2
```

**Existence in that exact project/database: NOT VERIFIED.** The supplied fact
that `admins/8hErgYh3H0NxftC8UE8d2tPecPV2` exists does not specify its project
or database, and repository files cannot read live Firestore document
existence. The denial response also does not return the result of `exists()`.

If the document exists at the fully qualified path above, the document
existence branch of `isAdmin()` is satisfied for this UID (assuming the request
is a verified user). If it exists only in another project or database, the
rule's lookup in the configured database returns false.

## Exact rule path

`firestore.rules` defines:

```text
function isAdmin() {
  return isBootstrappedAdmin() || (
    isVerifiedUser() &&
    exists(/databases/$(database)/documents/admins/$(request.auth.uid))
  );
}
```

In this rule, `$(database)` is the database matched by the request. The client
initializes Firestore with
`getFirestore(app, firebaseConfig.firestoreDatabaseId)`, so the checked-in
client configuration targets the named database above. The `admins` document
ID is the raw `request.auth.uid`; it is not a role name or a sanitized
competition owner field.

There is also a bootstrap-email branch: a verified request using either
`instagram.okosteraker@gmail.com` or `marcus.o.ahlen@gmail.com` passes
`isAdmin()` without relying on the admin-document existence check. The supplied
diagnostic includes the UID but not the token email, so that branch cannot be
confirmed from the provided error.

## How to verify live existence

In Firebase Console, select project
`ai-studio-applet-webapp-72c01`, then select Firestore database
`ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`. Confirm that
the exact document ID
`admins/8hErgYh3H0NxftC8UE8d2tPecPV2` exists there. A document with the same path
in the default database or a different project does not satisfy this rule
lookup.

The current evidence is insufficient to answer “yes” or “no” for that exact
database. Do not treat the reported, unscoped document existence as proof that
the `exists()` call above is true.
