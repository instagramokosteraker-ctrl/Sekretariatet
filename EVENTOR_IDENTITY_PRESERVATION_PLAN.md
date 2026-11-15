# Eventor Identity Preservation Plan

## Status and scope

Planning only; no code, Firestore data, or rules were changed.

Phase 2 should preserve Eventor's external identities alongside PasserSI's
existing Firestore document IDs. The two ID sets serve different purposes:
Firestore IDs remain the app's internal references, while Eventor IDs are
opaque foreign keys used for synchronization and IOF XML matching.

## Current identity inventory and loss points

| Identity | Available during import | Where it is lost or degraded | Intended destination |
|---|---|---|---|
| Event ID | `ParsedEventorCompetition.eventId` is set from the requested Eventor event ID when available, or parsed from the XML event. | `handleCreateEventorCompetition()` uses the event only for display/fallback text. It creates a new `evt-...` internal ID and does not pass Eventor's ID to `CompetitionMeta` or `createCompetitionInFirestore()`. | Competition document and `CompetitionMeta.eventorEventId`. |
| Class ID | `parseClasses()` extracts IDs into `ParsedEventorClass.id`. `parsePersonEntry()` also reads an entry's class ID to look up its class name. | `ParsedEventorEntry` retains only `className`, not the extracted class ID. The import handler deduplicates classes by name, creates generated `evtcls-...` IDs, and maps competitors by name. | Each class document and `CompClass.eventorClassId`; retain internal `CompClass.id` for all app references. |
| Person ID | `parsePersonEntry()` extracts `PersonId`/`Id` into `ParsedEventorEntry.personId`; it is copied to `ParsedEventorRunner.eventorPersonId` only for entries with an SI number. | `handleCreateEventorCompetition()` ignores `entry.personId` when creating `Competitor`. For entries without SI numbers, the `RunnerDbEntry` path does not preserve it either. | Each competition competitor document and `Competitor.eventorPersonId`. |
| Organisation ID | `parsePersonEntry()` reads the entry-level organisation ID, falling back to an import/global organisation ID. It copies the result to `ParsedEventorRunner.eventorOrgId` only when there is an SI number. `ParsedEventorXml.organization` can also contain an organisation ID. | `ParsedEventorEntry` omits its organisation ID. The competitor receives only a display club name. An entry with no SI number loses its organisation identity; the global club setting is not a reliable substitute for the competitor's represented organisation. | Each competition competitor document and `Competitor.eventorOrgId`. |

Code locations: [Eventor parser types and extraction](src/utils/eventorXml.ts#L1),
[entry parsing](src/utils/eventorXml.ts#L184),
[competition import mapping](src/App.tsx#L2035), and
[import persistence](src/firebase.ts#L3071).

### Existing identity fields are not equivalent substitutes

- `CompetitionMeta.id`, `CompClass.id`, and `Competitor.id` are PasserSI IDs.
  Keep them as Firestore document/reference IDs.
- `ClubSettings.eventorOrgId` is one configured club ID; it does not identify
  the organisation represented by every competitor in an imported event.
- `RunnerDbEntry.eventorPersonId` and `eventorOrgId` are already stored in the
  runner database. They are useful for migration candidates, but are not
  reliably available for every competitor or necessarily tied to that
  competition's entry.
- `EventorIntegrationStatus.connectedEventId` is currently initialized as
  `null` and used as a settings input value. It is not a durable,
  competition-specific foreign key.

## Proposed application data model

Add optional, namespaced identity properties. Keep values as strings exactly
as supplied by Eventor; do not convert numeric-looking IDs to numbers, use
them as Firestore paths, or overwrite internal document IDs.

```ts
interface CompetitionMeta {
  eventorEventId?: string;
}

interface CompClass {
  eventorClassId?: string;
}

interface Competitor {
  eventorPersonId?: string;
  eventorOrgId?: string;
}
```

These are optional strings, not required nullable properties. If an ID was not
provided or cannot be trusted, omit it. This keeps old competitions and
non-Eventor competitions representable without artificial empty IDs. IDs
should be trimmed and length-checked at import boundaries, then retained
without path sanitization or numeric coercion.

Extend `ParsedEventorEntry` to include the entry-level class and organisation
IDs in addition to its current person ID and class name. Preserve the class ID
when class identity came from a class-list record or an entry-level class
element. The parser should distinguish an entry's explicit OrganisationId
from a fallback/global organisation ID: only persist the fallback on a
competitor if the Eventor response semantics establish that it is the
competitor's represented organisation.

## Firestore schema and read/write changes

No new collection is required. Store each external ID directly on the object it
identifies:

| Firestore document | Optional fields | Existing internal key retained |
|---|---|---|
| `competitions/{competitionId}` | `eventorEventId` | `competitionId` and document ID |
| `competitions/{competitionId}/classes/{classId}` | `eventorClassId` | `classId` and document ID |
| `competitions/{competitionId}/competitors/{competitorId}` | `eventorPersonId`, `eventorOrgId` | `competitorId` and document ID |

Required implementation touchpoints:

1. **Types and import:** extend `CompetitionMeta`, `CompClass`,
   `Competitor`, `ParsedEventorEntry`, and the Eventor importer mapping.
   Pass `parsed.event.eventId` through competition creation; map classes to
   Eventor class IDs as well as names; and carry person/organisation IDs onto
   the corresponding competitors, including competitors without SI numbers.
2. **Competition persistence:** extend
   `CreateCompetitionInFirestoreParams` and the competition document payload
   in [src/firebase.ts](src/firebase.ts#L7135). Ensure any code path that
   creates a missing competition document from a snapshot also preserves its
   optional Eventor ID. Existing document updates should not clear the field
   when a snapshot omits it.
3. **Class persistence:** include `eventorClassId` in class create data and in
   the Eventor import's class upsert path. Load it in
   `loadFullSeasonFromFirestore()` and `subscribeClassesFromFirestore()`.
4. **Competitor persistence:** include the two identity fields when creating
   imported competitors through the existing assignment-aware transaction.
   Load them into `Competitor` from competitor documents. Non-import
   competitor updates should leave them untouched unless an explicit,
   authorized identity correction is being performed.
5. **Competition reads:** map `eventorEventId` from the competition document
   into `CompetitionMeta` in full-season loading and metadata subscriptions.
6. **Rules:** extend `isValidCloudCompetition`,
   `isValidCloudClass`, and `isValidCloudCompetitor`'s allowed key lists in
   [firestore.rules](firestore.rules). Validate each optional field as a
   bounded string only when present. Do not make any Eventor ID mandatory.
   Add identity fields to class/import update allow-lists only where the
   intended admin import or correction path needs to set them. Preserve the
   current competitor/SI assignment transaction invariants and all existing
   authorization predicates.
7. **Tests:** cover parser retention, import projection, Firestore
   serialization/hydration, omitted IDs on legacy records, and preservation
   of existing IDs during unrelated updates. Include rules tests for the
   optional string fields and rejection of invalid types/oversized values.

The current rules use explicit `hasOnly` key lists for all three document
types, so adding fields only to TypeScript or Firestore writes would cause
create/update denials until both validation and relevant field allow-lists are
updated. Preserve the existing named-database deployment discipline and test
the candidate rules in the emulator before deployment.

### Write and correction policy

- A new Eventor import may create identity fields from source IDs.
- An import with a missing ID must not replace a non-empty ID already on the
  document with `null`, `''`, or `undefined`.
- If an import supplies an ID different from a stored non-empty ID, do not
  silently overwrite it. Report a conflict and require an explicit,
  authorized reconciliation.
- Normal competitor edits, SI-card assignment changes, readouts, and
  unrelated snapshot updates should not mutate or remove Eventor IDs.
- If identity corrections are supported, expose them through a narrow
  admin-only operation and audit old/new values; do not broaden general
  update authorization merely to support migration.

## Backward compatibility

1. Readers treat missing `eventorEventId`, `eventorClassId`,
   `eventorPersonId`, and `eventorOrgId` as absent. Legacy documents remain
   valid and continue to load.
2. New non-Eventor competitions omit all Eventor fields.
3. Keep all existing PasserSI document IDs and references unchanged. Do not
   rename competition, class, or competitor documents to Eventor IDs; doing so
   would break the app's document paths, competitor/class references, and
   SI-card assignment links.
4. Firestore rules allow the fields only when present and do not require them
   for existing documents or ordinary updates.
5. Exporters emit an Eventor ID only when one is present. If absent, omit the
   corresponding external `<Id>` rather than substituting a PasserSI document
   ID.

## Existing competitions

No historical migration is required or planned. Existing competitions may
remain without Eventor identities indefinitely. The implementation applies
only to newly imported Eventor competitions; it does not backfill old events,
infer IDs from names or SI numbers, or alter existing competition documents.
Readers treat missing fields as absent, and exporters must not substitute
PasserSI IDs when an Eventor identity is unavailable.

## Export implications

Use the identifiers on the hydrated domain objects when building IOF XML:

- `CompetitionMeta.eventorEventId` → `<Event><Id>…</Id></Event>`
- `CompClass.eventorClassId` → `<Class><Id>…</Id></Class>`
- `Competitor.eventorPersonId` → `<Person><Id>…</Id></Person>`
- `Competitor.eventorOrgId` → `<Organisation><Id>…</Id></Organisation>`

The IOF schema permits these IDs to be absent. The export should emit each only
when present, preserve the Eventor value exactly, and never emit internal
Firestore IDs as substitutes. IOF's `Id` supports an optional `type`
attribute; use an Eventor issuer/type only if the Eventor/IOF profile confirms
the accepted value. Validate the changed XML against the IOF 3.0 XSD and then
repeat the controlled Eventor upload, verifying that records match existing
Eventor event/class/person/organisation identities rather than creating
duplicates.

## Suggested acceptance criteria

- API and XML import preserve every explicit Event, Class, Person, and
  per-entry Organisation ID through parse → model → Firestore write → reload.
- IDs remain exact strings; internal Firestore paths and references are
  unchanged.
- Missing IDs remain absent, with no fabricated fallback identities.
- Legacy documents without IDs load, edit, and export as before.
- Ordinary SI assignment/readout/competitor updates preserve existing IDs.
- Conflicting re-import identities are surfaced and not silently overwritten.
- IOF XML emits external IDs at the corresponding entity elements and still
  validates against IOF 3.0 XSD.
- A controlled Eventor upload confirms the IDs improve matching for event,
  class, person, and organisation without duplicate records.
