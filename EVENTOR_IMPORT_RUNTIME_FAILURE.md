# Eventor Competition-ID Import Runtime Failure

## Finding

The Eventor API fetch is not the failing step. The competition-ID import reaches
Firestore, creates the new competition first, then fails while creating an
imported competitor.

The immediate cause is a mismatch between the competitor create payload and
`firestore.rules`: the import writer deliberately omits `rentalReturned`, but
`isValidCloudCompetitor()` requires that field. The competitor create is denied,
so Firestore rejects the atomic competitor/ SI-assignment transaction.

## Request flow

1. The competition-ID form in
   [CompetitionSettingsView.tsx](./src/components/CompetitionSettingsView.tsx)
   calls `onImportEventorEvent(eventId)`.
2. The callback in [App.tsx](./src/App.tsx) validates the numeric ID and calls
   `fetchEventorXml()` for the Eventor event and entries.
3. [eventorClient.ts](./src/utils/eventorClient.ts) maps those requests to
   `POST /api/eventor`. For the import it sends `action: "import-event"` and
   the event ID. The two upstream resources are:
   - `/api/event/{eventId}`
   - `/api/export/entries?eventId={eventId}&version=3.0`
4. The deployed backend function is the default `handler` in
   [api/eventor.ts](./api/eventor.ts). It validates the request, fetches the
   Eventor URL with the supplied API key, and returns XML. The Express route
   `/api/eventor/import-event` in `server.ts` is not called by this client flow.
5. The client parses the XML and passes the result to
   `handleCreateEventorCompetition()` in [App.tsx](./src/App.tsx).

## Backend flow

The backend function called is `api/eventor.ts`'s `handler`. Its responsibility
ends after fetching Eventor XML and returning it; it does not write Firestore.

The write path is in the browser:

1. `handleCreateEventorCompetition()` generates a new Firestore competition ID
   (`evt-{timestamp}-{random}`); it does not use the Eventor ID as the Firestore
   document ID.
2. It calls `createCompetitionInFirestore()` to write the competition and
   classes.
3. It calls `saveCompetitionImportToFirestore()` to persist imported competitors
   and RunnerDb entries.
4. For each competitor, `saveCompetitionImportToFirestore()` calls
   `writeImportedCompetitorWithAssignment()`, which runs
   `runAtomicSIAssignmentMutation()` and queues the competitor and matching SI
   assignment writes in one Firestore transaction.

## Firestore flow and failing operation

For generated competition ID `C`, the relevant documents are:

- Competition: `competitions/C`
- Classes: `competitions/C/classes/{classId}`
- Imported competitor: `competitions/C/competitors/{competitorId}`
- SI assignment: `competitions/C/siCardAssignments/{siNumber}`
- Optional runner profile: `runnerDb/{siNumber}`

The failing operation is the **create transaction commit** containing:

- `transaction.set(competitions/C/siCardAssignments/{siNumber}, assignment)`
- `transaction.set(competitions/C/competitors/{competitorId}, competitor)`

The competitor payload is assembled in `saveCompetitionImportToFirestore()` in
[firebase.ts](./src/firebase.ts), then written by
`writeImportedCompetitorWithAssignment()`. The payload includes the imported
competitor fields, IDs, `ownerUid`, `schemaVersion`, and timestamps, but omits
`rentalReturned`. The helper logs and strips that field as Firestore-owned
rental state.

The create rule in [firestore.rules](./firestore.rules) invokes
`isValidCloudCompetitor(incoming())`. That validator lists `rentalReturned` in
`keys().hasAll(...)`, so the created competitor fails validation. The assignment
is paired with that competitor in the same commit; it is not a successful
standalone write.

## Exception / permission denial

Firestore denies the transaction with code `permission-denied` and the SDK
message:

```text
FirebaseError: Missing or insufficient permissions.
```

Because the writes are committed atomically, the SDK reports a transaction
permission denial rather than identifying one write in the error itself. The
rule evaluation identifies the specific failing condition: the competitor
create payload is missing the required `rentalReturned` field. The import
handler logs the competitor and assignment paths and rethrows the Firestore
error; `handleCreateEventorCompetition()` then surfaces the import-failed
message. The already-created competition/classes may remain, while the
competitor/assignment transaction is rejected.

This identifies the denial from the checked-in writer and rules. No captured
production stack trace or raw Firestore response was present in the repository;
the exact SDK wording above is the standard permission-denied message, not a
claim that a particular live console log was independently captured.

## Root cause and minimal fix

**Root cause:** the importer intentionally suppresses `rentalReturned` on new
competitor writes, while the current Firestore create validator still requires
it. The Eventor network route succeeds; the schema mismatch is reached only
after parsing, competition creation, and entry conversion.

**Minimal fix:** initialize `rentalReturned: false` on **new competitor
documents** written by `writeImportedCompetitorWithAssignment()`, without
accepting or overwriting imported `rentalReturned` values on updates. This
satisfies the existing required schema while preserving Firestore ownership of
the field.
