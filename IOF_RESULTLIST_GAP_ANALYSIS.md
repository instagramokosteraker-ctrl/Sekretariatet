# IOF ResultList Gap Analysis

## Scope and conclusion

This analysis compares `buildIofResultListXml()` in
[src/utils/iofXml.ts](src/utils/iofXml.ts) with the IOF Interface Standard 3.0
schema and published Eventor/MeOS guidance. No application code was changed.

**Conclusion: the current export does not have a reliable chance of being
accepted as-is.** It contains a confirmed XSD sequence violation: each person's
`<Name>` writes `<Given>` before `<Family>`, while IOF 3.0 requires
`<Family>` before `<Given>`. A strict XSD validator must reject that output for
any person result. Other mismatches may not make the file XSD-invalid, but
undermine a complete, correctly matched Eventor result upload.

The Eventor-specific technical upload guide was not accessible for verifying
all upload-side requirements. IOF schema validity is necessary, but it does
not prove that Eventor will accept the file, match its records, or publish the
results as intended. A controlled Eventor upload is still required.

## What the exporter currently produces

The XML root is `ResultList` in the IOF 3.0 namespace, with `iofVersion="3.0"`,
`createTime`, and `creator`. It includes an event name/start date and time,
one `ClassResult` per app class, and individual `PersonResult` entries for
competitors in statuses `OK`, `MP`, `DNF`, `DNS`, and `PRELIMINARY_FIN`.
Each entry includes a name, club name, bib, optional start/finish timestamps,
selected result time/position, status, SI number, and splits derived from
`validation.splits`.

The exporter is surfaced as a download button in
[src/components/SpeakerResultsView.tsx](src/components/SpeakerResultsView.tsx).

## IOF 3.0 schema comparison

| Area | Finding | Classification |
|---|---|---|
| Root and namespace | The root element, IOF namespace, version, and creation timestamp are structurally appropriate. | Schema-aligned |
| Event | `Event/Name` is present. `Event/Id` is optional in the XSD but omitted. Event start date/time are present. | Valid, but event identity is missing |
| Class | `Class/Name` is present. `Class/Id` is emitted, but it is a PasserSI-generated ID rather than a known shared Eventor identity. | Schema-valid; interoperability risk |
| Person name | Emits `Given` then `Family`; IOF `PersonName` sequence requires `Family` then `Given`. | **Confirmed XSD violation** |
| Person/organisation IDs | Both are optional in IOF 3.0. The output omits person and organisation IDs. | Schema-valid; identity/matching risk |
| Result element order | `BibNumber`, times, `Position`, `Status`, split times, and `ControlCard` are emitted in the XSD sequence order. | Schema-aligned |
| Status values | `OK`, `MissingPunch`, `DidNotFinish`, `DidNotStart`, and `Active` are valid IOF 3.0 values. | Enum-valid; one semantic mapping is wrong |
| Result-list status | The root omits its `status` attribute; the XSD default is `Complete`, described as all competitors and official post-event results. The output can omit registered, checked, and in-forest competitors. | Schema-valid; completion claim can be false |
| Split status | `Missing` is a valid split status. It is also used for split records that are punched but have no usable elapsed time. | Schema-valid; incorrect meaning in cases below |
| Course/splits | Class course metadata is optional. However, when the competitor's course is known, IOF describes a split for each course control in course order, even when not punched or not started. The exporter only serializes splits that happen to exist in `validation`. | May be schema-valid; incomplete result data |
| Control card | `ControlCard` is optional and its text is schema-valid. The exporter emits the competitor SI number unconditionally, including imported placeholder numbers. | Schema-valid; possible false identity/data |

The XSD's `PersonName` sequence is `Family`, then `Given`. Its
`ResultList/@status` defaults to `Complete`; the description of `Complete`
requires all competitors and is intended for official results after the event.
The XSD also defines `SplitTime` statuses `OK`, `Missing`, and `Additional`,
and states that every known course control should be defined even if not
punched or the competitor has not started.

## Status mapping and result completeness

### Mapping issues

- `PRELIMINARY_FIN` is mapped to IOF `Active`. IOF defines `Active` as
  currently on course and `Finished` as finished but not yet validated.
  `PRELIMINARY_FIN` is not an accurate `Active` result. If it means a runner
  has finished but awaits validation, `Finished` is the closer IOF status;
  otherwise, exclude it from an official complete export until adjudicated.
- `OK`, `MP`, `DNF`, and `DNS` map to valid IOF enum values.
- For `MP` and `DNF`, a known elapsed time is omitted because `<Time>` is only
  emitted for `OK`. The XSD permits omission, but its official example
  includes finish time and elapsed time for a `MissingPunch` result. If
  PasserSI has a trustworthy `runningTimeSec`, it should be retained for
  finished non-OK results too.
- An `OK` competitor with a null `runningTimeSec` is output as status `OK`
  without a time or place. This is schema-permitted, but should be flagged or
  withheld from an official result export because the result is incomplete.
- There is no PasserSI `DSQ` status, so the exporter cannot represent a
  disqualification distinct from a missing punch. Do not silently map an
  adjudicated disqualification to `MissingPunch`; add a supported status
  mapping if disqualification is required.

### Complete-list issue

The root's omitted status defaults to `Complete`, but the exporter filters out
`REGISTERED`, `CHECKED`, and `IN_FOREST` competitors. It includes
`PRELIMINARY_FIN` as a result. Thus it can both omit entered competitors and
include non-final runners while declaring an official complete list. A runner
who has not started should be included as `DidNotStart` in a final complete
list if Eventor considers that person entered; currently the export only
includes a runner explicitly set to `DNS`.

For official publication, the export should either:

1. Include every competitor for the event and mark the root `status="Complete"`
   only after finalization; or
2. Explicitly label a non-final export as `Snapshot` (or `Delta` only when it
   actually contains changes), and include only status/result combinations
   appropriate for that mode.

## Tie and position handling

`OK` runners are sorted by elapsed time, then assigned `Position = idx + 1`.
Equal times therefore receive different positions based on their array order.
The output does not express a tie and shifts subsequent positions (for example
1, 2, 3 instead of shared first place followed by the next competition
position). This is not an XSD violation, but it is an incorrect result
ranking. Positions should be assigned by elapsed time with equal times sharing
the same rank and subsequent rank following the selected competition-ranking
convention. Eventor's display convention should be confirmed in the upload
pilot.

## Split-time issues

1. **Punched but time unavailable is mislabeled Missing.** The current code
   emits `status="Missing"` whenever a split is not `OK` with a non-null
   `cumulativeSec`. A split with `status === 'OK'` but a null time means the
   control was matched/punched but its time is unavailable; IOF says this is
   `status="OK"` with the `<Time>` omitted, not `Missing`.
2. **Broken-control decisions are conflated with runner misses.** The app's
   `BROKEN_CTRL` validation entries are serialized as `Missing`. Whether that
   control should be reported as missing depends on the event's official
   adjudication; a broken control must not automatically imply that the runner
   failed to punch it.
3. **Extra punches are dropped.** `validation.extraControls` is not serialized.
   IOF supports `SplitTime status="Additional"` for punches that do not belong
   to the course.
4. **Known controls can be omitted.** Validation is only created on season
   load when there is a readout and an effective finish time. A known-course
   runner without such a validation object, including a DNS runner, exports
   no splits. IOF's schema documentation says all controls of a known course
   belong in the split sequence even when a competitor has not started.
5. **Imported classes have no course link.** Eventor competition import
   creates classes with `courseId: null` and imports `courses: []`. Consequently
   there is no course/control sequence from which to produce official splits.
   This is a source-data gap, not just an XML formatting issue.
6. **Finish is correctly not a SplitTime.** The exporter filters control code
   `999` (the app's finish marker); IOF specifies that start and finish are
   represented by `StartTime`/`FinishTime`, not split entries.

Until a course/control sequence is known and validated, the exporter should
not imply that it provides complete split times. Omitting all splits is
preferable to publishing a partial or misordered sequence as complete.

## Identity and Eventor interoperability

IOF allows `Id` to be omitted on `Event`, `Class`, `Person`, and `Organisation`,
so their absence is **not itself an XSD error**. However, the IOF guidance says
IDs should be shared between systems and strongly advises using official
identities rather than exposing internal database IDs.

The current exporter omits the Eventor event and person/organisation IDs, and
emits the internal PasserSI class ID as `<Class><Id>`. Since these IDs are
optional, Eventor may still be able to associate results by names and event
context; that behavior is not established by the accessible public material.
If Eventor interprets the class ID as an external identity, a generated
PasserSI ID is not a suitable substitute for the Eventor class ID. Prefer
preserved Eventor IDs when available; until then, omit an internal ID rather
than presenting it as a shared identity.

The exporter also writes `<ControlCard>${runner.siNumber}</ControlCard>` for
every competitor. Eventor import creates a synthetic SI number for entries
without one (`8,900,000 + bib`) and marks those as rental cards. Such a
placeholder can therefore be published as if it were the runner's actual
control card. Do not export synthetic card values as real card identities.

## Eventor-specific expectations and confidence

The IOF standard defines the XML structure but explicitly leaves optional
fields flexible; communicating systems must agree which elements are
required. The IOF IT page links a technical description for use of IOF XML
with IOF Eventor. MeOS's current manual says Eventor supports manual IOF-XML
transfer as a fallback and documents direct result/split upload. These sources
support the general conclusion that an IOF result list is a relevant
publication format, but they do not establish that this particular file is
acceptable to the current Swedish Eventor upload workflow.

**Assessment:** there is a realistic chance of acceptance only after the
confirmed XSD error is fixed. As-is, acceptance by a strict schema-validating
upload is unlikely. After the XML is schema-valid, acceptance remains
plausible but unproven because Eventor's current parser requirements,
identity matching behavior, and upload feedback have not been tested with this
file. Eventor can potentially reject or misassociate results even if they
validate against IOF 3.0.

## Minimal changes required before a controlled Eventor test

### Blocking / correctness minimum

1. Emit person names in IOF-required order: `<Family>` then `<Given>`.
2. Add schema validation of representative files against the IOF 3.0 XSD;
   include runners with multiple-word names, all exported statuses, and splits.
3. Make the result-list completeness explicit. Do not default to `Complete`
   while omitting entrants or including unresolved preliminary results.
4. Map `PRELIMINARY_FIN` to `Finished` only when that accurately means
   finished/unvalidated; otherwise exclude it from final output. Report missing
   elapsed times for would-be `OK` results instead of silently publishing them
   as ordinary final results.
5. Handle equal elapsed times with shared positions.
6. Serialize split status according to the actual punch state, include
   additional punches where supported, and emit the complete course sequence
   when course data is known. Do not represent a broken-control adjudication
   as an athlete missing punch without an explicit decision.
7. Suppress synthetic SI numbers from `<ControlCard>`.

### Required for reliable Eventor matching and complete splits

8. Preserve and use Eventor event, class, person, and organisation IDs where
   available. Until persisted identities are implemented, omit generated
   internal IDs rather than claim them as shared external IDs.
9. Import/configure the actual courses and ordered controls and map classes to
   courses before promising split-time publication.
10. Run a controlled upload to the intended Eventor event, verify the event,
    class, and runner associations, and record Eventor's exact validation
    response. Do not represent XSD validation alone as proof of Eventor
    acceptance.

Changing the creator string from `LIVE-Appen MeOS Web` to the actual exporting
application name is also advisable, but it is not an XSD blocker.

## Sources

- [IOF 3.0 XSD](https://raw.githubusercontent.com/international-orienteering-federation/datastandard-v3/master/IOF.xsd)
- [IOF ResultList example](https://raw.githubusercontent.com/international-orienteering-federation/datastandard-v3/master/examples/ResultList1.xml)
- [IOF Data Standard 3.0 overview](https://orienteering.sport/iof/it/data-standard-3-0/)
- [IOF IT resources and Eventor XML technical-description link](https://orienteering.sport/iof/it/)
- [MeOS Eventor Connection manual](https://www.melin.nu/meos/en/show.php?base=5600&id=5680)
- [MeOS Export of Results and Split Times](https://www.melin.nu/meos/en/show.php?base=5600&id=5616)
