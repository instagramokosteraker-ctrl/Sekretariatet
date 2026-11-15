# Eventor Identity Trace

## Scope and evidence

This trace uses one reported new import:

- Eventor competition ID entered: `59797`
- Firestore competition document ID reported: `evt-1794746557864-xnwuab`
- Representative competitor document ID reported: `evtcmp-1794746557864-12`
- The supplied competitor record reports `classId: evtcls-1794746557864-2`,
  `eventorPersonId: "31889"`, and `eventorOrgId: "636"`.

The supplied text identified as “raw XML” was confirmed to come from Firestore,
not from Eventor. No Eventor event/entries XML response or separate class
document was provided. Therefore the fields below can be verified only as far
as those concrete Firestore values and the checked-in source allow; the report
does not infer what the production XML contained.

## Representative class

| Trace point | Value/evidence |
|---|---|
| Parsed `ParsedEventorClass.id` | **Not available.** The Eventor XML was not supplied. In the current parser, `parseClasses()` reads `EventClassId` or `Id` from an Eventor `EventClass`/`Class` element. |
| Mapped `eventorClassId` | **Not available for this class.** The current import maps a non-empty parsed class ID onto the newly generated `CompClass.eventorClassId`. The internal ID `evtcls-1794746557864-2` is a PasserSI class document ID, not evidence of an Eventor class ID. |
| Firestore class document | **Not supplied.** The provided `classId: "evtcls-1794746557864-2"` is on the competitor record and identifies its PasserSI class association. It is not the class document's full contents and does not prove whether that document has `eventorClassId`. |
| Stage classification (A-D) | **Cannot determine from the available evidence.** The actual class ID in XML and the full class document are both missing. A missing `eventorClassId` in a complete class document could originate in the XML, parser, mapping, or writer; the partial competitor record cannot distinguish these. |

Current source behavior:

1. `parseClasses()` reads the external ID into `ParsedEventorClass.id`.
2. `handleCreateEventorCompetition()` uses that ID as the class definition's
   `eventorClassId`, then copies it onto the new `CompClass`.
3. `createCompetitionInFirestore()` includes a non-empty `eventorClassId` in
   the new class child document when `preserveEventorIdentities` is true.
   `saveCompetitionImportToFirestore()` includes it in class `createData` as
   well; its later update payload does not include that field and so does not
   remove it.

These are the current-repository code paths in
[src/utils/eventorXml.ts](src/utils/eventorXml.ts),
[src/App.tsx](src/App.tsx), and [src/firebase.ts](src/firebase.ts).

## Representative competitor

Firestore path reconstructed from the supplied document IDs:

`competitions/evt-1794746557864-xnwuab/competitors/evtcmp-1794746557864-12`

| Trace point | Value/evidence |
|---|---|
| Parsed person ID | **Not available.** No Eventor XML was provided. `parsePersonEntry()` reads `PersonId` or `Id` from the person/competitor element. |
| Parsed organisation ID | **Not available.** No Eventor XML was provided. `parsePersonEntry()` reads `OrganisationId`, `OrganizationId`, or `Id` from an organisation element nested in the entry. It does not use a global/fallback organisation ID for this competitor field. |
| Mapped `eventorPersonId` | **Not available as an intermediate value.** The current import copies a non-empty parsed `personId` to the new competitor's `eventorPersonId`. |
| Mapped `eventorOrgId` | **Not available as an intermediate value.** The current import copies a non-empty parsed entry-level `eventorOrgId` to the new competitor's `eventorOrgId`. |
| Firestore competitor document | The supplied record reports `eventorPersonId: "31889"` and `eventorOrgId: "636"` (and `classId: "evtcls-1794746557864-2"`). Thus both identity fields are present on this representative competitor document. |

### Competitor stage classification

For this specific competitor, Firestore persistence is **not the failing
stage** for `eventorPersonId` or `eventorOrgId`: both fields are present in the
provided record. The production XML and intermediate parsed/mapped objects
were not supplied, so their source values cannot be independently confirmed.
The current source maps these IDs from parsed entries into the new competitor
and includes non-empty values in the competitor create payload.

Accordingly, the supplied concrete example does **not** demonstrate missing
person/organisation identities. It demonstrates a competitor document with
both fields present. If other competitors lack them, those records require
their own XML/document evidence before assigning A, B, C, or D.

## Overall determination for this import

- **Class ID:** The missing `eventorClassId` cannot be attributed to A, B, C,
  or D from the supplied evidence. No Eventor class XML or full Firestore
  class document was provided. `evtcls-1794746557864-2` is an internal
  PasserSI class ID and must not be mistaken for an Eventor class ID.
- **Competitor person ID:** For competitor `evtcmp-1794746557864-12`, the
  supplied Firestore value is `"31889"`; it is not missing in that document.
  The raw Eventor person ID and intermediate mapping were not provided.
- **Competitor organisation ID:** For the same competitor, the supplied
  Firestore value is `"636"`; it is not missing in that document. The raw
  entry-level Eventor organisation element was not provided.

The current repository source contains no mapping or create-write omission
that would explain the supplied competitor's stored values being absent: they
are present. No claim is made about other competitors or the class document.

## Minimal evidence needed to finish the class trace

For the same competition, provide:

1. The raw Eventor XML fragment containing the representative
   `EventClass`/`Class` element and its external ID element; and
2. The full Firestore document at
   `competitions/evt-1794746557864-xnwuab/classes/evtcls-1794746557864-2`.

For a competitor whose IDs are actually missing, provide its raw entry XML and
the corresponding full Firestore competitor document. With those matched
records, the first point where the identity disappears can be classified as
XML input (A), parser (B), mapping (C), or persistence (D).
