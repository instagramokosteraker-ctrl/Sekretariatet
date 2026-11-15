# Eventor Result Publication Pilot

## Purpose and scope

Verify that an IOF 3.0 ResultList containing preserved Eventor identities is
accepted by Eventor and associates results with the intended existing event,
classes, people, and organisations.

This pilot is a **manual upload through Eventor's supported web workflow**.
It does not call an undocumented write API or enable direct publishing.
ResultList identity-bearing and identity-absent output has already passed the
pinned IOF 3.0 XSD tests; this pilot verifies Eventor-specific behavior, which
the XSD cannot establish.

## Preconditions

- Obtain approval from the event owner/organizer and an Eventor administrator.
- Prefer a non-production/test event with existing Eventor event, class,
  person, and organisation records. If no test event is available, use only an
  explicitly approved event that has not yet had its official results
  published.
- Confirm with the Eventor administrator how an upload can be cancelled or
  corrected, and whether re-upload updates existing results or can create
  duplicates. If the behavior is unknown, do not proceed on a live event.
- Select a small but representative result set containing:
  - the target event's Eventor event ID;
  - at least two existing classes with Eventor class IDs;
  - at least two existing people with Eventor person IDs;
  - at least two represented organisations if the event has them;
  - final, reviewed results for the selected competitors.
- Make sure the PasserSI competition, class, and competitor Firestore records
  contain the matching IDs, and that each selected competitor belongs to the
  intended internal class.
- Generate the ResultList from that exact competition revision. Run
  `npm run test:iof` and retain the successful pinned-XSD validation result.
- Do not use fabricated, borrowed, or name-inferred Eventor IDs.

## Baseline evidence to capture

Before upload, record a timestamped baseline:

1. Target Eventor event ID, event name, and date.
2. For each selected class: Eventor class ID and existing Eventor class name.
3. For each selected person: Eventor person ID, existing event entry, and
   expected class.
4. For each represented organisation: Eventor organisation ID and name.
5. Existing counts of classes, entries/competitors, and any published results
   relevant to the selected records.
6. PasserSI competition/class/competitor document IDs alongside their
   corresponding Eventor IDs, to show internal IDs were not substituted.
7. The exact XML file name, SHA-256 checksum, export time, and the confirmed
   ResultList status (`Complete` only for reviewed final results; otherwise
   `Snapshot`).

Use the Eventor UI or an administrator-approved export/API to capture the
baseline. Store only the minimum data needed; redact personal information
from evidence shared outside the authorized event team.

## Pilot procedure and expected behavior

### 1. Event identity matching

**Check:** Confirm the exported `<Event><Id>` is exactly the selected
Eventor event ID. In Eventor's upload workflow, select the intended event and
review the event identity shown before committing.

**Expected:** Eventor accepts the file for that existing event. It does not
create a second event or associate results with another competition. A file
event ID that conflicts with the selected event is a stop condition, not an
override prompt to accept blindly.

### 2. Class identity matching

**Check:** For each selected class, compare the exported
`ClassResult/Class/Id` with the baseline Eventor class ID. After upload,
inspect the existing class records and their result rows.

**Expected:** Results appear under the existing classes with matching IDs.
The class count does not increase, and Eventor does not create a duplicate
class based only on the class name.

### 3. Person identity matching

**Check:** Compare each exported `PersonResult/Person/Id` with the baseline
Eventor person ID. After upload, inspect the existing Eventor person/entry
records and confirm that each selected result belongs to that same person.

**Expected:** Existing people receive the intended results. No duplicate
person or competitor/entry is created, and no result is attached by name to a
different person.

### 4. Organisation identity matching

**Check:** Compare each exported `PersonResult/Organisation/Id` with the
baseline organisation represented by that competitor. Include runners from
different organisations where possible.

**Expected:** Each result remains associated with the existing intended
organisation. No duplicate organisation is created, and a club name or
PasserSI internal value is not used in place of the Eventor organisation ID.

### 5. Result association and integrity

**Check:** For every pilot competitor, compare the Eventor result with the
reviewed PasserSI result: person, class, organisation, status, elapsed time,
position, and available splits. Confirm the result appears once. Recheck the
baseline counts and inspect unrelated classes/people for unintended changes.

**Expected:** Each intended result is associated exactly once with the correct
existing event, class, person, and organisation. Eventor reports successful
validation/import without identity warnings, and no unrelated result or
identity record changes.

Do not repeat an upload after a timeout or ambiguous UI response until the
administrator verifies the current Eventor state. Treat an uncertain outcome
as potentially committed.

## Abort and recovery criteria

Cancel before commit, or stop and contact the Eventor administrator, if any of
the following occurs:

- the selected event ID and file event ID do not match;
- Eventor proposes creating duplicate classes, people, entries, or
  organisations;
- any selected identity maps to a different Eventor record;
- a result is associated with the wrong class/person/organisation;
- Eventor reports unsupported IDs, an unexpected update/overwrite, or
  ambiguous partial success;
- post-upload counts or unrelated records change unexpectedly.

Do not improvise a second upload or manual identity correction. Preserve the
XML checksum, Eventor response, timestamps, and before/after evidence; use the
administrator-confirmed recovery procedure.

## Pass criteria

The pilot passes only when **all** of the following are true:

- [ ] Eventor accepts the identity-bearing ResultList.
- [ ] Results are associated with the intended existing event.
- [ ] Results are associated with the intended existing classes.
- [ ] Results are associated with the intended existing people.
- [ ] Results are associated with the intended existing organisations.
- [ ] There are no duplicate competitors/entries or classes; no duplicate
      people, organisations, or events are created.
- [ ] Each selected result appears exactly once with the expected class,
      person, organisation, status, time, and position.
- [ ] No unrelated records or results are modified.
- [ ] Before/after evidence and Eventor's import/validation response are
      retained and reviewed by the event owner.

Any mismatch or unresolved duplicate warning is **FAIL**. A schema-valid XML
file or an Eventor “upload successful” message by itself is not a pass.

## Evidence required before direct Eventor publishing is safe

A successful manual pilot is necessary evidence of identity matching, but it
is **not sufficient** to authorize a direct publisher. Direct publishing
should be considered only after all of the following are available:

1. **Supported write contract:** current authoritative Eventor documentation
   or written Eventor/federation confirmation of the endpoint, method, content
   type/payload, accepted IOF version, identity semantics, and required fields.
2. **Authorization and credentials:** confirmed API-key permissions and
   credential ownership, plus an approved server-side secret-management
   design. No write secret may be stored in browser code or local storage.
3. **Write/update semantics:** documented create-versus-update behavior,
   duplicate handling, republication rules, idempotency, rate limits, response
   and error meanings, partial failures, and how to reconcile an uncertain
   timeout.
4. **Controlled integration test:** a non-production or explicitly approved
   Eventor test event demonstrates the actual API request and response,
   including correct identity matching, duplicate prevention, and safe retry
   behavior.
5. **Application safeguards:** authenticated admin authorization, explicit
   event-ID and final-result confirmation, preview, durable audit/publication
   state, safe retry policy, operational error reporting, and a manual XML
   fallback are designed and tested.
6. **Operational approval:** the event owner and credential owner approve the
   production procedure, rollback/recovery plan, monitoring, and support
   responsibilities.

If authoritative write semantics, suitable credentials, or a controlled test
cannot be obtained, direct publishing remains **NO-GO**. Continue using the
manual Eventor upload workflow.

## Pilot outcome record

Complete this section after an approved run:

- Eventor event ID:
- PasserSI competition document ID:
- Pilot date/time and approver:
- Eventor environment/event:
- XML SHA-256:
- Eventor upload/validation outcome:
- Event/class/person/organisation matching results:
- Before/after duplicate and count checks:
- Result association checks:
- Exceptions or recovery actions:
- Overall result: PASS / FAIL
- Evidence location (access-controlled):
