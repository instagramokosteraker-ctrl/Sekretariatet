# Eventor class mapping root cause

## Finding

The active Eventor UI import does **not** fetch the dedicated Eventor class list. It fetches the event and entries, then passes the event XML as both `eventXml` and `classesXml`. The parser consequently treats event-document class elements, if any, as the authoritative class list. This is a confirmed identity-source mismatch and the primary defect in the import pipeline.

The repository does not contain the affected Eventor XML responses, parsed arrays, or resulting Firestore documents. Therefore, the specific external IDs that caused **Orange → Vit** and **Svart → Gul** cannot be proven from source alone. The code confirms the path by which incorrect class identities can propagate, but it does not establish that either reported substitution was caused by a particular ID collision or XML element. The import’s fallback to the first class also cannot explain both substitutions: two unresolved entries would both be assigned to that first class.

## Complete identity path

| Stage | File and function | Identity/key behavior |
|---|---|---|
| Eventor request | `src/App.tsx`, `onImportEventorEvent` | Fetches `/event/{id}` and `/entries?eventId={id}`. It passes `eventXml` as `classesXml`; no dedicated class-list response is fetched in this active flow. |
| Request proxy | `src/utils/eventorClient.ts`, `getProxyRequest`; `api/eventor.ts` | A request for `eventclasses?eventId=...` is rewritten to `event/{id}`, not to Eventor’s dedicated `eventclasses` resource. Thus changing only the UI request URL would still return the event resource through this proxy. |
| Parse class list | `src/utils/eventorXml.ts`, `parseClasses` | Extracts the first descendant `EventClassId` or `Id`, and a direct class name. It deduplicates on external ID when present, otherwise on name; the first occurrence wins. |
| Parse entry class | `src/utils/eventorXml.ts`, `parsePersonEntry` | Extracts an entry class ID from the selected or inherited class element. It resolves the name by `classNames.get(classId)`, then the entry class’s direct name, then `Öppen Motion`. The ID and resolved name are returned separately. |
| Add missing class definitions | `src/utils/eventorXml.ts`, `parseEventorXml` | Adds an entry’s class name only if that lowercased name is not already in the parsed class names. These appended definitions have an empty external class ID. |
| Create internal classes | `src/App.tsx`, `handleCreateEventorCompetition` | Merges parsed classes and entry-derived classes using `eventor:<id>` when an ID exists and `name:<lowercase trimmed name>` otherwise. Those key spaces do not merge the same class if one representation has an ID and the other does not. Internal IDs are generated as `evtcls-${now}-${index + 1}`; the external ID is stored separately as `eventorClassId`. |
| Assign competitors | `src/App.tsx`, `handleCreateEventorCompetition` | Resolves by entry external ID first, then lowercased trimmed class name, then `classes[0].id`. |
| Persist classes | `src/firebase.ts`, `saveCompetitionImportToFirestore` | Writes to `competitions/{competitionId}/classes/{internalClassId}`. The document stores the internal ID as `classId`, the class name, and—when preserved—the external identity as `eventorClassId`. This persistence code does not rename classes. |

## Exact source mismatch

In the UI import, the values passed to `parseEventorXml` are:

```ts
{
  eventXml,
  classesXml: eventXml,
  entriesXml,
}
```

This makes `parseClasses()` parse the event response rather than an `eventclasses` response. The client proxy independently maps `eventclasses?eventId=...` to `event/{id}`, and the API proxy does the same rewrite.

There is a separate `POST /api/eventor/import-event` handler in `server.ts` that fetches `/event/{id}`, `/eventclasses?eventId={id}`, and `/entries?eventId={id}` separately. The inspected UI import callback does not call that handler. This is the concrete disconnect between the correct dedicated-class fetch path and the active import path.

## What this proves about the reported substitutions

- **Confirmed:** The active importer does not use a dedicated class-list response, even though a separate server handler does.
- **Confirmed:** Parser name resolution is ID-first. If the class-ID map contains the wrong name for an entry’s external ID, that wrong name is returned even if the entry class also has a direct name.
- **Confirmed:** Class merge keys differ depending on whether an external ID is present. This can create duplicate class definitions; it does not by itself change `Orange` to `Vit` or `Svart` to `Gul`.
- **Confirmed:** Competitor assignment’s final fallback is the first internal class. If Orange and Svart both fail ID and name resolution, both fall back to the same first class, not respectively to Vit and Gul.
- **Not proven:** The actual Eventor class IDs for Vit, Gul, Orange, and Svart; which IDs appeared in the affected entries; whether the event XML itself contained class nodes; and which parsed class/name pairs were saved. Those require the exact event, class-list, and entry XML responses (or captured `ParsedEventorXml` output) and the affected Firestore class/competitor documents.

Consequently, the source-level root cause is the wrong class-data source in the active importer, with inconsistent identity-based merging and a silent first-class fallback as additional correctness hazards. Assigning the exact two substitutions to a specific ID collision, parser selection, or fallback would be speculation without the affected payload.

## Smallest schema-preserving fix

1. Route the active UI import through the existing server import path, or otherwise fetch the dedicated `/eventclasses` resource without the client proxy rewriting it to `/event/{id}`.
2. Ensure each parsed entry retains its Eventor class ID alongside its class name, and create the internal `CompClass` mapping from the dedicated class list. Keep the existing Firestore schema: internal `classId` remains the document identity and `eventorClassId` remains the external identity.
3. Merge class definitions by Eventor class ID when available; use normalized exact name only when no external ID exists. Detect conflicting ID/name pairs instead of silently assigning an unresolved entry to the first class.

This is a proposed fix only; no implementation changes were made as part of this root-cause analysis.
