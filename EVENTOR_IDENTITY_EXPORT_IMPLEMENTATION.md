# Eventor Identity Export Implementation

## Result: PASS

The IOF 3.0 ResultList exporter now uses preserved Eventor identities when
available. If an identity is absent, its corresponding `<Id>` is omitted, so
legacy and non-Eventor competitions continue to produce valid XML.

## Identity mapping

| Domain property | ResultList location | Behavior |
|---|---|---|
| `CompetitionMeta.eventorEventId` | `Event/Id` | Emits the Eventor ID when non-empty; does not substitute `CompetitionMeta.id`. |
| `CompClass.eventorClassId` | `Class/Id` | Emits the Eventor ID when non-empty; does not substitute the internal class/document ID. |
| `Competitor.eventorPersonId` | `Person/Id` | Emits the Eventor ID when non-empty; does not substitute the internal competitor ID. |
| `Competitor.eventorOrgId` | `Organisation/Id` | Emits the Eventor ID when non-empty; does not substitute the club name or another internal value. |

ID text is XML-escaped while preserving the original string. Empty or
whitespace-only optional values are omitted. No Eventor issuer/type attribute
is added because the accepted Eventor profile value has not been verified.

## Backward compatibility

When Eventor IDs are absent, the exporter omits the corresponding `<Id>`
elements. IOF 3.0 permits these IDs to be absent, and the regression test
validates the no-ID output against the pinned official XSD. In particular,
class export no longer writes a PasserSI/Firestore class ID as an IOF class
identity.

## Regression coverage

Updated [src/utils/iofXml.test.ts](src/utils/iofXml.test.ts) to verify:

- all four Eventor IDs appear at their corresponding XML entities;
- internal competition, class, and competitor IDs are not emitted in place of
  Eventor IDs;
- output with all identities absent omits `<Id>` elements and remains valid;
- the identity-present and identity-absent documents both validate against the
  pinned official IOF 3.0 XSD.

The existing pinned XSD test still checks the schema checksum before
validation.

## Validation

| Command | Result |
|---|---|
| `npm run build` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test:iof` | **PASS** — 1 file, 7 tests, including XSD validation |

The build emitted existing Vite configuration and large-chunk warnings; it
completed successfully.

## Eventor interoperability

**PASS — XML schema validation.** Both identity-bearing and identity-absent
ResultLists pass the pinned IOF 3.0 XSD.

This does not prove that Eventor will match or update existing records using
these IDs. A controlled upload of an identity-bearing result file is still
required to verify Eventor-specific matching and duplicate behavior.
