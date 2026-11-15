 # Eventor Result Publication Roadmap

## Executive summary

PasserSI already has a downloadable IOF XML 3.0 `ResultList` exporter, including
result statuses and derived split times. It is a useful starting point, but it
is not yet a dependable Eventor publication workflow: the export uses
PasserSI-generated IDs, omits Eventor identity IDs, and has not been validated
against the IOF schema or an Eventor upload.

The largest data gap is loss of Eventor identities during competition import.
The parser sees the event ID, class IDs, and person IDs, but the competition
model does not retain them. Organisation IDs are kept in some runner database
records, not reliably on each competition entry. The imported classes also
have no course assignments, so their splits cannot be calculated from
Eventor-imported data alone.

MeOS offers both direct Eventor publishing and standalone IOF XML export. The
best fit for PasserSI is to harden the existing file export first, preserve
Eventor identities next, and only then consider a server-side publisher. Direct
publishing is conditional on confirming the current Eventor write interface
and obtaining suitable credentials; the public technical details could not be
verified during this assessment.

This is planning only. No application code, Firestore rules, or Eventor
configuration was changed.

## Current PasserSI model

| Area | Current representation | Publication implications |
|---|---|---|
| Competition | `CompetitionMeta` has a PasserSI ID, name, organizer, date, start time, and lifecycle status. Eventor import generates a new `evt-...` ID. The Eventor event ID is not a competition field. | Cannot reliably associate a saved competition with its Eventor event after import. |
| Classes and courses | Classes have a PasserSI ID, name, and optional course link. Eventor imports generate `evtcls-...` class IDs and set `courseId` to `null`; imported course data is empty. | No Eventor class identity is preserved. No imported course/control sequence is available to calculate official splits. |
| Competitors | Each competitor has name, club name, class ID, SI number, timing fields, and status. `Competitor` has no Eventor person or organisation ID. | Names, club text, and SI number are not stable Eventor identity keys. An SI card may be rented, shared, or changed. |
| SI assignments | `siCardAssignments` associate a card/SI number with a competitor. | This is card ownership/assignment data, not an Eventor person identity. It must not be used as a substitute for PersonId. |
| Punches and splits | Full card punches are stored on competitor documents as parallel `punchCodes` and `punchTimes` arrays. Validation derives course matches and cumulative splits from punches and course data. `stationPunches` holds live radio/online station observations; it is not the full card readout. | Final split publication needs the actual course sequence and valid runner readouts. Radio observations alone are not a complete split record. |
| Results and statuses | There is no separate results collection. Result state lives on competitor records: start/finish/running times and status. Runner statuses are `REGISTERED`, `CHECKED`, `IN_FOREST`, `PRELIMINARY_FIN`, `OK`, `MP`, `DNF`, and `DNS`; competition lifecycle statuses are `UPCOMING`, `LIVE`, and `COMPLETED`. Validation and split results are derived when the season is loaded. | There is no explicit DSQ runner status. A publish operation needs to map supported statuses, create and retain a consistent final-results snapshot, and avoid treating the lifecycle status as proof that results were reviewed or published. |

Relevant implementation: [competition and competitor types](src/types/sportident.ts#L66),
[Eventor import mapping](src/App.tsx#L2035),
[Firestore import persistence](src/firebase.ts#L3071), and
[readout validation](src/utils/readoutValidation.ts#L207).

### Eventor identities currently lost or incomplete

- The import parser captures an Eventor event ID and parsed class IDs. It
  reduces entries to class names and a person ID, but does not retain the entry
  class ID or organisation ID in `ParsedEventorEntry`.
- The import handler creates new internal competition and class IDs. It maps
  entries to classes by class name and does not copy `personId` onto the
  competitor.
- A `RunnerDbEntry` may preserve Eventor person and organisation IDs when the
  entry has an SI number. That is useful supporting data, but it is not a
  reliable per-entry identity mapping for all competitors.
- The club's configured Eventor organisation ID represents the configured
  club. It cannot safely replace the organisation ID of every imported
  competitor, who may represent another club.
- `EventorIntegrationStatus` has a `connectedEventId` property, but it is
  initialized as `null`; the imported Eventor event ID is not saved with the
  competition.

See [Eventor parser types and extraction](src/utils/eventorXml.ts#L1),
[entry parsing](src/utils/eventorXml.ts#L184), and
[competition creation](src/App.tsx#L2035).

## What Eventor and IOF XML need

An IOF 3.0 `ResultList` can carry the event, class results, each person's result,
status, place, start/finish times, elapsed result time, control card number,
course, and split times. Split times are cumulative elapsed seconds from the
start and are associated with control codes in course order. Missing controls
should be represented as missing; they should not be silently omitted if the
export claims to contain a complete split sequence.

For reliable identity matching, PasserSI should preserve and emit the shared
Eventor identifiers wherever available:

- **Event ID** to associate the result list with the right Eventor competition.
- **Event class ID** to associate each class result with the right class.
- **Person ID** to associate a result with the right runner.
- **Organisation ID** to identify the organisation represented by that runner.

The IOF 3.0 schema makes several entity IDs optional and supports names as well.
Therefore this assessment does **not** claim that Eventor rejects every
ID-less XML file. Rather, using Eventor IDs follows IOF's shared-identity
guidance and avoids ambiguous name-based matching. Eventor-specific validation
rules and accepted fields must be confirmed with the federation's current
technical documentation or a controlled test upload.

For a complete official result list, PasserSI must also:

- Distinguish a complete result list from a live snapshot or a delta.
- Map PasserSI statuses to valid IOF statuses, publish places only for
  eligible `OK` results, and handle ties correctly.
- Use verified elapsed times and start/finish timestamps.
- Have the correct course/control sequence to publish meaningful split times.
- Avoid exporting preliminary or otherwise non-final results as official
  results without an explicit user choice.

Sources: [IOF Data Standard 3.0 overview](https://orienteering.sport/iof/it/data-standard-3-0/),
[IOF 3.0 schema](https://raw.githubusercontent.com/international-orienteering-federation/datastandard-v3/master/IOF.xsd),
and [IOF ResultList example](https://raw.githubusercontent.com/international-orienteering-federation/datastandard-v3/master/examples/ResultList1.xml).

## MeOS model

MeOS documents an event-centric **Eventor Connection** with actions to publish
start lists and results. Its result publication includes result and split
times and uses an Eventor API key supplied by the club's Eventor
administrator. MeOS also offers a separate Result & Splits export to IOF XML
2.0.3 or 3.0. Its manual recommends the Eventor web interface as a fallback
when direct communication fails, noting that the web workflow can provide
better error messages.

This is a useful architectural comparison:

- MeOS treats Eventor as a configured competition connection and offers both
  a direct workflow and a file-based fallback.
- PasserSI currently imports Eventor event data, but creates separate internal
  competition/class/competitor IDs and has no direct result-publishing action.
- PasserSI already offers a downloadable IOF XML result list, but it has not
  yet connected that output to durable Eventor identity mappings or validated
  it with Eventor.

MeOS sources: [Eventor Connection](https://www.melin.nu/meos/en/show.php?base=5600&id=5680),
[Export of Results and Split Times](https://www.melin.nu/meos/en/show.php?base=5600&id=5616),
and [Register Entries](https://www.melin.nu/meos/en/show.php?base=5600&id=5603).

## Existing IOF XML exporter

`buildIofResultListXml()` in [src/utils/iofXml.ts](src/utils/iofXml.ts#L30) is
already used by [SpeakerResultsView](src/components/SpeakerResultsView.tsx#L58)
to download an IOF XML 3.0 result list. It emits result statuses, times,
control-card numbers, class results, and split elements from
`validation.splits`.

The current output needs verification and hardening before it is treated as an
Eventor-ready publication artifact:

- Event has a name and date, but no Eventor event ID.
- Class IDs are PasserSI-generated IDs, not preserved Eventor class IDs.
- Person and organisation names are emitted without their Eventor IDs.
- Imported classes have no course link, so their course block and computed
  splits are absent.
- Places are assigned by sorted array index, so ties are not represented as
  shared places.
- `PRELIMINARY_FIN` is included as IOF `Active`; the export has no final-results
  confirmation step.
- XML is not currently validated against the IOF schema or tested by uploading
  it to Eventor. The generator's documentation comment is not a substitute for
  those checks.

## Approaches

| Dimension | A. Manual IOF XML upload | B. Direct Eventor publish |
|---|---|---|
| Implementation effort | About **8–15 days** for a dependable manual workflow (Phase 1 export plus Phase 2 identity preservation); add **4–8 days** for the split/WinSplits work in Phase 4. | About **18–35 days** through direct publishing (Phases 1–3), or **22–43 days** including Phase 4. The Phase 3 estimate assumes a supported write interface is available; access/approval delays are excluded. |
| Ongoing maintenance | Low-to-medium: IOF schema/version changes, Eventor upload behavior, and export validation. | High: all export maintenance plus credentials, API compatibility, retries, API errors, and production write monitoring. |
| Operational risk | Medium-low. The user can inspect the file and upload it, but can choose the wrong event/file or upload stale results. | Medium-high. A credential or mapping error can publish incorrect results; network failures can leave uncertain publish state or duplicate attempts. |
| Infrastructure | Existing browser download and Eventor web access. No new server-side write credential is needed. | Trusted backend endpoint, secret management, authorization checks, audit/publication state, retry/idempotency handling, and monitoring. |
| User experience | Download from PasserSI, upload in Eventor, inspect Eventor's validation result. More manual steps, but a useful fallback. | In-app preview and publish action with a clear success/failure response; fewer manual steps, but depends on Eventor write access and reliable integration. |

**Recommendation:** Implement A first as the initial publishing path and retain it
as a fallback even if B is later added. Treat B as conditional: MeOS documents
direct publishing, but the current Eventor API endpoint, request format,
permissions, version policy, and result-write behavior were not independently
verified in accessible technical documentation. Do not infer a write endpoint
from the existing read/import API.

The current PasserSI Eventor proxy exposes only `test`, `import-event`, and
`sync-club` actions in [api/eventor.ts](api/eventor.ts#L1). It does not expose a
result write action. The existing Eventor key is managed by the client-side
integration, which is not an appropriate foundation for a new production write
credential without an explicit security design.

## Gaps to close

1. **Persist external identities.** Add optional, namespaced Eventor IDs to the
   competition, class, and individual competitor records (or to a clearly
   related identity mapping). Preserve them as opaque strings; do not reuse
   Firestore document IDs or SI numbers.
2. **Keep identity at entry level.** Extend the import entry model to retain
   event class and organisation IDs alongside person ID. Do not rely on an
   SI-number-only runner database record to recover a competitor identity.
3. **Handle existing imports safely.** Backfill only with exact, verified
   matches. Where IDs cannot be proven from existing runner records, require
   re-import or explicit user reconciliation; names alone are not a safe
   automatic migration key.
4. **Complete course data.** Configure or import the actual course and ordered
   controls, map each class to its course (including forked courses), and
   verify that card punches match that course before publishing splits.
5. **Make finalization explicit.** Add a result preview/review and a complete
   result snapshot or publication record containing at least the competition,
   result revision, timestamp, and outcome. `COMPLETED` is a competition
   lifecycle value, not proof that results were reviewed or successfully
   published.
6. **Validate output semantics.** Validate against IOF 3.0 XSD; correct status
   mappings, tie places, timestamps, missing/extra controls, and final-versus-
   preliminary behavior. Test representative accepted and rejected files in
   Eventor and WinSplits.
7. **Respect Firestore schemas and authorization.** Any stored identity fields
   need corresponding typed Firestore persistence, rules validation, and tests.
   Keep Eventor person identity separate from SI card assignment logic.

## Phased plan

Effort estimates are engineering person-days for one engineer familiar with
PasserSI. They exclude Eventor access approval, external support delays, and
unplanned schema/API changes.

### Phase 1 — IOF XML export

**Estimate: 3–5 days.**

- Harden the existing IOF 3.0 ResultList builder rather than starting a second
  exporter.
- Add a result preview and an explicit complete/final export action.
- Validate the XML against the IOF XSD; correct result-list status, rank/tie
  behavior, status mapping, times, and split ordering.
- Keep manual Eventor upload as the publication workflow and document the
  upload/verification steps.
- Pilot with a controlled competition and capture Eventor's accepted/rejected
  file feedback.

**Acceptance:** the XML validates against the selected IOF schema, its contents
match the reviewed PasserSI results, and a controlled Eventor upload is
accepted. Reliable matching of old entries still depends on Phase 2 identity
preservation.

### Phase 2 — Preserve Eventor identities

**Estimate: 5–10 days.**

- Persist Eventor event ID on the competition, class ID on each class, and
  person/organisation IDs on each competition entry.
- Preserve the IDs during API and XML imports; extend parsed entries to carry
  class and organisation IDs instead of reducing identity to class name.
- Add migration/re-import tooling with conflict reporting and no unsafe
  name-only automatic matches.
- Update Firestore serialization, validation rules, and import tests.
- Include these IDs in the IOF XML when available.

**Acceptance:** imported competitors, classes, and their competition all
retain their external IDs through save/load and export, without confusing SI
card assignment with runner identity.

### Phase 3 — Direct Eventor publish

**Estimate: 10–20 days after Phase 2, conditional on API confirmation.**

- First obtain current Eventor technical documentation and verify the
  supported result-write endpoint, accepted IOF version, authentication,
  permissions, and behavior for updates/republication.
- If supported, implement publishing only through a trusted backend endpoint;
  enforce authenticated admin authorization and keep write credentials out of
  browser storage.
- Add preview/confirmation, event-ID checks, idempotent retries, an auditable
  publication record, response/error display, and a manual XML fallback.
- Test in a non-production Eventor event before enabling production publishing.

**Gate:** if a supported Eventor write interface and suitable credentials
cannot be confirmed, defer this phase. Do not use undocumented endpoints or
browser-side write calls.

### Phase 4 — Split times / WinSplits integration

**Estimate: 4–8 days.**

- Complete course/control mapping and verify that split values are cumulative
  elapsed times in the official course order.
- Test missing controls, extra punches, forked courses, and readout edge cases.
- Validate both Eventor's split ingestion and WinSplits compatibility. MeOS
  documents WinSplits split publishing where supported by the Eventor version;
  confirm the behavior available to PasserSI rather than assuming it.
- Keep split publication tied to the same reviewed result revision as final
  results.

**Acceptance:** representative full, missing, and forked-course readouts produce
correct splits in the chosen recipient workflow.

## Recommended implementation order

1. **Phase 1: IOF XML export** — finish and validate the existing file-based
   path; use it as the first controlled publication workflow.
2. **Phase 2: preserve Eventor identities** — required for unambiguous,
   repeatable matching and a dependable direct publisher.
3. **Phase 3: direct Eventor publish** — proceed only after the current write
   API and permissions are confirmed; keep manual upload as fallback.
4. **Phase 4: split times / WinSplits** — build on verified course data and
   final-result snapshots. The exporter already emits split elements, but the
   imported competition currently lacks the course/control data to make them
   reliable.

## Estimated effort, risks, and prerequisites

| Phase | Estimate | Main prerequisite or risk |
|---|---:|---|
| 1. IOF XML export | 3–5 days | IOF schema validation and a controlled Eventor upload are still needed. |
| 2. Preserve Eventor identities | 5–10 days | Historical entries may not have recoverable IDs; ambiguous matches require user reconciliation. |
| 3. Direct Eventor publish | 10–20 days | Current Eventor write API, credential permissions, and update semantics are unverified. |
| 4. Splits / WinSplits | 4–8 days | Accurate class-to-course mapping and complete card readouts are prerequisites. |

The main operational risks are publishing against the wrong event, matching a
runner or class by name alone, publishing preliminary/stale results, and
reporting success after an uncertain API response. Use stable Eventor IDs,
explicit review, publication audit state, and a tested manual XML fallback to
mitigate them.

## Research references and limitations

- [MeOS Eventor Connection manual](https://www.melin.nu/meos/en/show.php?base=5600&id=5680)
- [MeOS Result & Splits export manual](https://www.melin.nu/meos/en/show.php?base=5600&id=5616)
- [MeOS entry registration manual](https://www.melin.nu/meos/en/show.php?base=5600&id=5603)
- [IOF Data Standard 3.0 overview](https://orienteering.sport/iof/it/data-standard-3-0/)
- [IOF 3.0 XSD](https://raw.githubusercontent.com/international-orienteering-federation/datastandard-v3/master/IOF.xsd)
- [IOF ResultList example](https://raw.githubusercontent.com/international-orienteering-federation/datastandard-v3/master/examples/ResultList1.xml)

The MeOS manual documents direct Eventor result publishing and file export.
However, the current Eventor API technical documentation was not accessible
enough to verify endpoint paths, exact request/response semantics, or which
optional IOF fields each Eventor instance accepts. Those are prerequisites to
Phase 3, not assumptions in this roadmap.
