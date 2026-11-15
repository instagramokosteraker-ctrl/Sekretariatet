# Eventor Identity Preservation Verification

## Finding

The current repository's competition-ID import path executes the Phase 2
identity-preservation code. It does not use the older import-only mapping, and
the current Firestore serializers do not omit the fields when their source
identity is present.

**Most likely cause: A. The running application is not using the Phase 2
frontend build (or is serving a stale cached bundle).**

This is the best-supported diagnosis, not a deployment attestation: the
repository does not expose the build/version currently running at the
production URL. `HEAD` is `304bb56` (`feat: implement Eventor identity
preservation for new imports`) and the local branch is synchronized with
`origin/main`, but that alone does not prove that the Vercel deployment or the
browser's cached JavaScript uses that commit.

## Exact competition-ID request/import path

1. The user enters an Eventor ID in
   [CompetitionSettingsView](src/components/CompetitionSettingsView.tsx).
   `handleImportEventSubmit()` calls the `onImportEventorEvent` prop and then,
   on success, passes `res.parsed` to `onCreateEventorCompetition()`.
2. The prop is supplied by [App.tsx](src/App.tsx). Its handler validates the
   numeric ID, fetches Eventor `/event/{id}` and `/entries?eventId={id}`, and
   parses those responses with `parseEventorXml()`.
3. [fetchEventorXml()](src/utils/eventorClient.ts) makes POST requests to
   `/api/eventor`; [api/eventor.ts](api/eventor.ts) proxies those requests to
   Eventor.
4. The callback is `handleCreateEventorCompetition()` in [App.tsx](src/App.tsx).
   It builds new competition, class, and competitor model objects with the
   identity-preservation fields, then calls:
   - `createCompetitionInFirestore()` for the new competition and its class
     documents;
   - `saveCompetitionImportToFirestore()` for imported classes, competitors,
     and RunnerDb entries.
5. Competitor creation reaches
   `writeImportedCompetitorWithAssignment()` in [src/firebase.ts](src/firebase.ts),
   which writes the competitor and SI-card assignment in its existing atomic
   transaction.

The current competition-ID route therefore does **not** go directly through
the older general snapshot-import path. Eventor club/member sync is separate:
it reconciles and writes `runnerDb` entries and does not create competition,
class, or competitor documents.

## Where each ID is sourced and written

| Field | Current source/mapping | Exact Firestore writer and path |
|---|---|---|
| `eventorEventId` | The ID entered by the user is sanitized and passed to `parseEventorXml({ eventId })`. `parseEvent()` uses that requested ID as `parsed.event.eventId`; the API import rejects a response without a parsed event. `handleCreateEventorCompetition()` transfers it to the new `CompetitionMeta`. | `createCompetitionInFirestore()` builds `compDocData` and transaction-sets `competitions/{competitionId}`. It includes the field when `preserveEventorIdentities` is true and the ID is non-empty. |
| `eventorClassId` | `parseClasses()` reads `EventClassId`/`Id`; `parsePersonEntry()` also retains the class ID explicitly present on an entry. `handleCreateEventorCompetition()` attaches a parsed ID to its new `CompClass`; the generated PasserSI class ID remains the class document ID. | `createCompetitionInFirestore()` includes it in the new class child-document payload at `competitions/{competitionId}/classes/{internalClassId}`. `saveCompetitionImportToFirestore()` also includes it in class `createData`; its update payload deliberately omits it. |
| `eventorPersonId` | `parsePersonEntry()` reads `PersonId`/`Id` from the person element. The import handler maps it to the competitor object. | `saveCompetitionImportToFirestore()` includes it in the competitor's mutable fields when the new-import flag is true. On `CREATE`, `writeImportedCompetitorWithAssignment()` passes those fields through `buildImportedCompetitorWriteFields()` and transaction-sets `competitions/{competitionId}/competitors/{competitorId}`. |
| `eventorOrgId` | `parsePersonEntry()` retains an organisation ID only when it is explicit on that entry. The import handler maps that value to the competitor object. It intentionally does not copy a global/configured organisation fallback onto every competitor. | Same competitor transaction and path as `eventorPersonId`. |

`handleCreateEventorCompetition()` passes
`preserveEventorIdentities: true` to both Firestore functions. The current
repository rules include all four fields as optional, bounded strings in the
appropriate competition/class/competitor validators. Firestore rules reject
unauthorized writes; they do not silently remove fields from documents.

## A–D assessment

| Option | Assessment | Evidence |
|---|---|---|
| **A. Code not deployed** | **Most likely; not proven from this repository alone.** | Current `HEAD` contains the implementation and is synchronized with `origin/main`. No deployment record or production frontend build identifier is available here. If the running bundle predates `304bb56`, it will create the competition without any of the new identity mappings. |
| **B. Wrong import path** | **No, for the current competition-ID action.** | The Eventor-ID form calls `onImportEventorEvent()`, then `onCreateEventorCompetition()`, which is wired directly to `handleCreateEventorCompetition()`. A separate member-sync path writes RunnerDb only; it is not the route that creates a new competition. |
| **C. Mapping bug** | **Does not explain the missing event ID on the current API path.** | The entered ID is passed to the parser, and `parseEvent()` uses that requested ID as the parsed event ID. The parser can legitimately leave `eventorOrgId` absent if there is no entry-level organisation ID. Class/person fields are conditional on those IDs being present in the Eventor XML. No captured response payload was available to verify those three input values. |
| **D. Firestore write omission** | **No omission found in the current repository path.** | The root/class serializers include their fields on create, and competitor fields reach the transaction's create branch. Existing competitor update serialization strips the external IDs by design, but this import builds a new competition and new competitors. If active rules rejected the added fields, the corresponding Firestore write would fail rather than save a document with those fields silently stripped. |

## Conclusion and proof boundary

Given that **all four** fields are absent while the competition and its children
were reportedly created, the evidence points to **A: the running frontend is
not executing the Phase 2 build** (or the user used a different, older
frontend instance). The current repository does not support B or D as the
explanation. A parser/data issue could account for absent class, person, or
entry-level organisation IDs, but cannot account for the absent event ID when
the validated competition-ID API flow is used.

To prove A rather than infer it, compare the frontend bundle currently served
by the application with commit `304bb56` (or its deployment/build identifier).
Also confirm the documents are being inspected in the configured Firestore
project/database used by the app. No production deployment, Eventor request,
or production Firestore write was made for this verification.
