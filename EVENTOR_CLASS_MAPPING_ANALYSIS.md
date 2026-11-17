# Eventor Class Mapping Analysis

## Summary

The class data is not renamed by Firestore, and the inspected normalization
does not convert `Orange` to `Vit` or `Svart` to `Gul`. The mapping is made in
the Eventor XML parser and `handleCreateEventorCompetition()` in
`src/utils/eventorXml.ts` and `src/App.tsx`.

The current UI Eventor import path has a concrete source inconsistency:

- It fetches `/event/{id}` and `/entries?eventId={id}`.
- It passes the event document as both `eventXml` and `classesXml`.
- It does not fetch the distinct `/eventclasses?eventId={id}` resource.
- Parsed classes and entry classes are then merged using different keys:
  Eventor ID when present, otherwise normalized name.

If the Event document lacks class identities while Entry data carries them,
the merge can create two internal classes for one logical Eventor class. Also,
if an entry's parsed class ID does not match the class list, the App falls
back to a name match and then silently to the first class. These behaviors can
produce duplicate or misassigned classes. They are the smallest code-level
explanations consistent with the symptom, but the exact `Orange`/`Svart`
source values cannot be proven from the repository alone.

No raw Eventor response, import payload, or affected competition/class
documents were supplied. Therefore the exact observed Eventor IDs and
per-competitor mapping are **not available**; this report does not invent
them.

## Import path and identity mapping

### Current UI Eventor API path

1. The Eventor UI calls `onImportEventorEvent()` in `src/App.tsx`.
2. That function fetches the event and entries. It calls
   `parseEventorXml({ eventXml, classesXml: eventXml, entriesXml })`.
3. `parseEventorXml()` in `src/utils/eventorXml.ts` calls `parseClasses()` on
   `classesXml` and `parseEntries()` on `entriesXml`.
4. `parseClasses()` extracts the first descendant `EventClassId` or `Id` as
   the parsed class `id`, and gets the name from a direct `Name`, `ClassName`,
   or `ClassShortName` child.
5. `parsePersonEntry()` reads an `EntryClass`/`EventClass`/`Class` element,
   resolves its `EventClassId` or `Id` against the parsed-class name map, and
   otherwise uses the entry-class name or `Öppen Motion`. The result is a
   `ParsedEventorEntry` containing `className` and `eventorClassId`.
6. If an entry's class name was not in the parsed class list, the parser adds
   a `ParsedEventorClass` with an empty `id`. The same class can therefore
   appear once without an ID and again later with an ID.
7. `handleCreateEventorCompetition()` in `src/App.tsx` merges parsed classes
   and entry classes. It keys definitions by `eventor:<id>` when an ID exists,
   otherwise by `name:<trimmed-lowercase-name>`. Those keys do not identify
   the same class if one input has an ID and the other does not.
8. The function generates internal IDs such as `evtcls-${now}-${index + 1}`.
   These are not Eventor IDs. It stores the external ID separately as
   `eventorClassId`.
9. Competitors are assigned an internal class ID by Eventor class ID first,
   then normalized class name, then `classes[0].id`.
10. `saveCompetitionImportToFirestore()` writes each internal class under
    `competitions/{competitionId}/classes/{internalClassId}`, with
    `classId: internalClassId` and (when retained) `eventorClassId`.
    Competitors store the corresponding internal ID in `classId`.

### Separate server Eventor endpoint

`POST /api/eventor/import-event` in `server.ts` fetches the Event, the
`eventclasses` resource, and the entries resource separately. It uses
`parseEventorClassesXml()` and `parseEventorEntriesXml()` from
`src/server/eventorXml.ts`, returning Eventor IDs with class names in its
`classes` response. The inspected current UI callback does **not** call this
endpoint; it parses its own responses through `src/utils/eventorXml.ts`.
The existence of this separate endpoint therefore does not correct the
current UI import's class list.

## Mapping table

| Stage | Value source | ID/name behavior |
|---|---|---|
| Eventor classes | `/eventclasses?eventId=...` in the server endpoint; `/event/{id}` reused as `classesXml` by the current UI path | Actual IDs/names depend on the response XML. The affected event's values were not supplied. |
| Parsed class | `parseClasses()` | `id` is the first matching descendant `EventClassId` or `Id`; `name` is selected from a direct child. Duplicate IDs are silently first-wins. |
| Parsed entry | `parsePersonEntry()` | `eventorClassId` comes from a selected entry class; `className` is resolved from the class-ID map, then the entry class name, then `Öppen Motion`. |
| Internal class | `handleCreateEventorCompetition()` | Generated ID `evtcls-${now}-${index + 1}`; Eventor ID stored separately. Dedup keys differ when an ID is missing in one source. |
| Competitor class assignment | `handleCreateEventorCompetition()` | Eventor ID match, then lowercased trimmed name, then first internal class. |
| Firestore class document | `saveCompetitionImportToFirestore()` | Document path uses the generated internal ID; fields retain the internal `classId` and optional `eventorClassId`. Firestore does not normalize class names. |

For the reported outcome, the available mapping evidence is only:

| Actual Eventor class | Observed imported label | Eventor ID | Generated internal ID |
|---|---|---|---|
| Vit | Vit | Not supplied | Not recoverable without import payload |
| Gul | Gul | Not supplied | Not recoverable without import payload |
| Orange | Vit | Not supplied | Not recoverable without import payload |
| Svart | Gul | Not supplied | Not recoverable without import payload |

## Deduplication, lookup, and normalization findings

- `parseClasses()` uses a `Map` keyed by external ID, or by name if the ID is
  empty. If multiple XML elements produce the same ID, the first parsed name
  wins and later conflicting names are discarded without an error.
- The UI import merge uses `eventor:<id>` for identified classes but
  `name:<lowercase-name>` for unidentified classes. It does not reconcile
  those identities after both lists are merged.
- `classIdByEventorId` maps each internal class's external ID to its generated
  internal ID. `classIdByName` maps the first internal class with a given
  trimmed, locale-lowercased name.
- Entry assignment falls back to `classes[0].id` when both identity and name
  lookups fail. This is a silent success-shaped fallback that can place a
  competitor in an unrelated class.
- Name normalization is only `trim()` plus `toLocaleLowerCase()`. It does not
  map `Orange` to `Vit` or `Svart` to `Gul`.
- Firestore load uses `classId` (or the document ID) as the internal class ID
  and carries `eventorClassId` as a separate optional field. Firestore class
  lookup does not rewrite these names or IDs.

## Likely failure point

The exact failing mapping cannot be established without the raw Eventor XML.
The strongest code-level defects are in:

1. **`onImportEventorEvent()` — `src/App.tsx`:** the UI supplies `eventXml` as
   `classesXml`, rather than the separate class-list response used by the
   server endpoint.
2. **`handleCreateEventorCompetition()` — `src/App.tsx`:** it merges the
   parser's classes and entries using ID-based and name-based keys that are
   not reconciled, then silently assigns an unresolved entry to the first
   class.
3. **`parseClasses()` / `parsePersonEntry()` — `src/utils/eventorXml.ts`:**
   class IDs are found through descendant searches that also accept generic
   `Id` elements; duplicate parsed IDs are first-wins.

The symptom is consistent with bad or incomplete class identity/name data
arriving before the Firestore write. It is not evidence that Firestore itself
changed the class labels.

## Minimal fix

Use one authoritative Eventor class list for the import and carry the external
class ID through parsing, internal-class creation, and entry assignment.
Reconcile classes by external ID first; use normalized names only when the
source truly has no external ID. If an entry has an external ID that is not in
the class list, report the unresolved mapping instead of assigning
`classes[0]`.

Concretely, the current UI import should use the existing server import
response (which fetches `eventclasses` separately) or otherwise obtain and
parse that resource; `parseEventorXml()` should not be given the Event
document as a substitute class list. Also make class-ID extraction scoped to
the expected direct Eventor class fields and reject duplicate-ID/name
conflicts rather than silently accepting the first.

Before applying the fix, capture the affected event's `eventXml`,
`entriesXml`, and `eventclasses` XML (with personal data redacted), plus the
resulting `ParsedEventorXml` class and entry arrays. Those values are required
to confirm the exact external IDs that caused `Orange → Vit` and
`Svart → Gul`.
