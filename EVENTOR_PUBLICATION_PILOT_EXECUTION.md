# Eventor Publication Pilot — Execution Record

## Status

**Not executed.** This document is the operator checklist and result template
for the manual Eventor ResultList upload. An authorized Eventor operator must
select and approve the pilot event, capture its baseline, upload the reviewed
file, and complete the result record below. Do not upload to a live event
without event-owner approval and a confirmed recovery procedure.

The pilot validates Eventor-specific identity matching. It does not authorize
or test direct API publishing.

## Pilot acceptance target

Use one approved Eventor event and a small set of existing entries that cover:

- the Eventor event ID;
- at least two existing classes with Eventor class IDs;
- at least two existing people with Eventor person IDs;
- at least two represented organisations, if available.

All selected records must have reviewed final results. The exported XML must
be generated from the same PasserSI competition revision whose IDs are
recorded in the baseline.

## Exact evidence to collect

Capture a timestamped, access-controlled before/after evidence set. Keep the
XML file and its SHA-256 checksum. Redact names and other personal data from
any evidence shared outside the authorized event team; retain the Eventor IDs
needed to establish identity matching.

### Event matching

**Before upload**

- Target Eventor event ID, name, date, and Eventor page/reference.
- PasserSI `competitionId` and `eventorEventId`.
- The `<Event><Id>` value in the exported XML.
- The UI event selected for upload.

**After upload**

- Eventor's validation/import response and any event-related warning.
- Evidence that the result list is attached to the existing event with the
  same Eventor event ID.
- Existing event count/reference, showing no second event was created.

### Class matching

For every selected class, collect:

- Eventor class ID and existing Eventor class name/reference before upload.
- PasserSI internal class document ID and stored `eventorClassId`.
- The exported `ClassResult/Class/Id` value.
- The Eventor class reference and associated result rows after upload.
- Before/after class count and the list/set of class IDs.

Evidence must show that matching uses the Eventor class ID, not merely a
similar class name, and that no new class record was created.

### Person matching

For every selected competitor, collect:

- Existing Eventor person ID and event entry/reference before upload.
- PasserSI internal competitor document ID and stored `eventorPersonId`.
- The exported `PersonResult/Person/Id` value.
- The Eventor person/entry reference to which the result is attached after
  upload.
- Before/after person and entry counts, plus the relevant IDs.

Evidence must show that the result is attached to the same existing Eventor
person/entry and not to a newly created or same-name person.

### Organisation matching

For every selected competitor, collect:

- Existing represented Eventor organisation ID and name/reference before
  upload.
- PasserSI stored `eventorOrgId`.
- The exported `PersonResult/Organisation/Id` value.
- The organisation associated with that result after upload.
- Before/after organisation count and the relevant organisation IDs.

Where possible, include competitors representing at least two organisations.
Evidence must show the expected organisation association for each competitor;
a club-name match alone is insufficient.

### Duplicate detection

Capture pre-upload and post-upload:

- Event IDs and event count.
- Class IDs and class count.
- Person IDs and person count.
- Organisation IDs and organisation count.
- Entry/competitor references and counts for the selected event.
- Result rows keyed by event ID + class ID + person ID.

For the selected entries, verify:

- no new event, class, person, organisation, or duplicate entry was created;
- each intended result appears exactly once;
- no unrelated selected or unselected record was changed;
- Eventor did not report an unresolved duplicate, merge, or identity warning.

If the UI's counts are not sufficient to distinguish existing from newly
created records, obtain an administrator-approved export or record-level
inspection. Do not infer identity from display names.

## Pilot execution checklist

### A. Authorization and safe target

- [ ] Event owner/organizer approved the test and result data.
- [ ] Eventor administrator approved the target and confirmed the recovery
      procedure.
- [ ] Target is a non-production/test event; or, if unavailable, the event
      owner explicitly approved the controlled upload before official results
      are published.
- [ ] Eventor's expected upload/update/re-upload behavior is understood well
      enough to avoid duplicate or irreversible writes.
- [ ] Baseline evidence is captured and stored in an access-controlled
      location.
- [ ] The event ID in PasserSI, Firestore, XML, and the intended Eventor event
      agrees exactly.

**Stop here** if any approval, target, ID, or recovery behavior is uncertain.

### B. Prepare and validate the export

- [ ] PasserSI competition, class, and competitor Firestore records contain
      the expected Eventor IDs for the selected sample.
- [ ] Selected class/person/organisation IDs match the approved Eventor
      baseline exactly.
- [ ] Selected results have been reviewed and are final.
- [ ] ResultList status is appropriate (`Complete` only for complete reviewed
      results; otherwise `Snapshot`).
- [ ] Generate the XML from the recorded competition revision.
- [ ] Run `npm run test:iof`; retain the passing official IOF 3.0 XSD result.
- [ ] Inspect the generated XML and record its SHA-256 checksum.
- [ ] Confirm the XML contains the expected Event, Class, Person, and
      Organisation IDs and does not substitute internal Firestore IDs.
- [ ] Confirm the file contains only the approved event and result set.

**Stop here** for any missing/wrong ID, schema error, unreviewed result, or
unexpected record in the file.

### C. Upload once and inspect

- [ ] Open the Eventor-supported manual ResultList upload workflow.
- [ ] Select the exact approved Eventor event; compare its ID/reference to the
      file's Event ID.
- [ ] Review Eventor's preview/validation messages before committing.
- [ ] Cancel if Eventor proposes a different event, duplicate identities,
      unexpected creation/overwrite, or any unclear mapping.
- [ ] Upload once only.
- [ ] Save the Eventor response, warnings, timestamp, and account/role used
      (never save credentials).
- [ ] Do not retry after timeout or ambiguous success until an administrator
      checks Eventor's current state.

### D. Verify post-upload state

- [ ] Event is attached to the intended existing Eventor event.
- [ ] Every selected result is under its intended existing class.
- [ ] Every selected result is attached to its intended existing person/entry.
- [ ] Every selected result has its intended existing organisation.
- [ ] Each result appears exactly once with the expected status, time,
      position, and available splits.
- [ ] No duplicate event, class, person, organisation, or competitor/entry was
      created.
- [ ] Before/after counts and ID sets show no unintended or unrelated changes.
- [ ] Event owner and operator reviewed the evidence and signed the outcome.

## Result template

Complete one record per pilot. Use `PASS`, `FAIL`, or `NOT VERIFIED` for every
check. `NOT VERIFIED` does not count as a pass.

### Run information

- Pilot date/time:
- Operator:
- Event owner/approver:
- Eventor administrator/approver:
- Eventor environment (test/approved live):
- Eventor event ID:
- Eventor event name/reference:
- PasserSI competition document ID:
- PasserSI `eventorEventId`:
- Result revision / export time:
- ResultList status (`Complete` / `Snapshot`):
- XML file name:
- XML SHA-256:
- IOF 3.0 XSD test result and run time:
- Baseline evidence location (access-controlled):

### Identity match observations

| Entity | Eventor ID | PasserSI internal ID | Stored Eventor ID | XML ID | Eventor post-upload reference | Match? | Evidence reference |
|---|---|---|---|---|---|---|---|
| Event |  |  |  |  |  | PASS / FAIL / NOT VERIFIED |  |
| Class 1 |  |  |  |  |  | PASS / FAIL / NOT VERIFIED |  |
| Class 2 |  |  |  |  |  | PASS / FAIL / NOT VERIFIED |  |
| Person 1 |  |  |  |  |  | PASS / FAIL / NOT VERIFIED |  |
| Person 2 |  |  |  |  |  | PASS / FAIL / NOT VERIFIED |  |
| Organisation 1 |  |  |  |  |  | PASS / FAIL / NOT VERIFIED |  |
| Organisation 2 (if available) |  |  |  |  |  | PASS / FAIL / NOT VERIFIED |  |

### Duplicate and result checks

| Check | Before | After | Expected | Outcome | Evidence reference |
|---|---:|---:|---|---|---|
| Events / target event ID |  |  | Same event; no duplicate | PASS / FAIL / NOT VERIFIED |  |
| Classes / selected class IDs |  |  | No class created; IDs unchanged | PASS / FAIL / NOT VERIFIED |  |
| People / selected person IDs |  |  | No person created; IDs unchanged | PASS / FAIL / NOT VERIFIED |  |
| Organisations / selected org IDs |  |  | No organisation created; IDs unchanged | PASS / FAIL / NOT VERIFIED |  |
| Entries for selected people |  |  | No duplicate entry | PASS / FAIL / NOT VERIFIED |  |
| Results keyed by event/class/person IDs |  |  | Exactly one intended result each | PASS / FAIL / NOT VERIFIED |  |
| Unrelated records/results |  |  | No changes | PASS / FAIL / NOT VERIFIED |  |

- Eventor import response/warnings:
- Any mismatch, duplicate, or unexpected mutation:
- Recovery or follow-up action:
- Event owner sign-off:
- Overall outcome: **PASS / FAIL / NOT VERIFIED**

## Phase 2 closure decision

The Eventor identity export/pilot acceptance can be closed as **PASS** only
when the evidence shows all of the following in the same controlled run:

1. The Event ID matches the intended existing Eventor event.
2. Every selected class ID matches an existing Eventor class.
3. Every selected person ID matches the intended existing Eventor person/entry.
4. Every selected organisation ID matches the organisation represented by
   that competitor.
5. Results appear exactly once under the correct event, class, person, and
   organisation, with no duplicate events, classes, people, organisations, or
   entries.
6. Eventor accepts the file without unresolved identity warnings, and the
   before/after evidence shows no unrelated changes.

A passing XSD test, all four IDs present in Firestore/XML, or a generic
“upload successful” message alone is insufficient. Any mismatch or
`NOT VERIFIED` item leaves the pilot **FAIL / OPEN** until investigated and
retested. A successful manual pilot validates the manual workflow; it does not
by itself authorize direct Eventor API publishing.
