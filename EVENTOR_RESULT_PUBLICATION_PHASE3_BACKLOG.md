# Phase 3 Backlog Item: Verify Eventor Result-Publishing Contract

## Summary

**Type:** Time-boxed technical spike  
**Priority:** Phase 3 blocker  
**Estimate:** 2–3 engineering days, excluding waits for Eventor/federation support  
**Status:** Not started

## User story

As the PasserSI maintainer, I need to verify Eventor's currently supported
result-publication interface, authentication, permissions, and update
semantics before implementation, so that direct publishing uses a supported
contract and cannot accidentally publish to the wrong event or create
duplicate/incorrect results.

## Goal

Produce a documented **GO / NO-GO** decision for direct Eventor result
publishing, based on authoritative current Eventor documentation or written
confirmation from Eventor/federation support. Do not infer a write endpoint
from the existing read/import API.

## Work items

1. Locate authoritative documentation for Eventor result publication, or
   request written technical confirmation from the Eventor/federation API
   owner.
2. Verify and record:
   - supported endpoint, HTTP method, content type, and payload format;
   - accepted IOF version and required/optional ResultList elements;
   - authentication mechanism, required API-key permissions, and credential
     ownership;
   - how the target Eventor event is selected and matched;
   - whether publication creates or updates results, and how republication,
     duplicate requests, and partial failures behave;
   - response/error formats, rate limits, and any test/non-production
     environment.
3. Confirm whether event, class, person, and organisation identities must be
   sent, and which Eventor/IOF identifier representation is accepted.
4. Propose the trusted-backend request path, authorization boundary, secret
   storage location, audit data, and retry/idempotency strategy. Do not place a
   write credential in browser storage.
5. Capture a redacted example request and response if the official contract
   provides one. Do not include credentials or personal data.
6. Publish the findings and a GO / NO-GO recommendation. If the interface or
   permissions cannot be verified, defer direct publishing and retain manual
   IOF XML upload as the supported path.

## Acceptance criteria

- [ ] Findings cite current authoritative documentation or written Eventor/
      federation confirmation.
- [ ] Endpoint, method, content type, payload, IOF version, and identity
      requirements are recorded.
- [ ] Authentication, required permissions, credential owner, and safe
      server-side handling are recorded; no secret values are included.
- [ ] Create/update and republication behavior, idempotency, partial-failure
      behavior, rate limits, and error responses are documented, or explicitly
      marked unverified.
- [ ] Test-environment availability and the procedure for a controlled test
      are documented.
- [ ] A GO / NO-GO decision identifies unresolved risks and prerequisites.
- [ ] No production write, undocumented endpoint call, credential exposure,
      or application code change is part of this spike.

## Dependencies and constraints

- Access to current Eventor technical documentation or an Eventor/federation
  technical contact.
- A club/federation administrator who can confirm credential permissions and
  provide a non-production test event if one exists.
- The current PasserSI `/api/eventor` proxy supports read/import actions only;
  it is not evidence that a result-write endpoint exists.
- Phase 2 identities are now reported stored on the imported competition,
  classes, and competitors. The ResultList serializer now emits those IDs
  when present and has passed the pinned IOF 3.0 XSD tests. The controlled
  Eventor matching pilot remains outstanding.

## Out of scope

- Implementing or calling a result-write endpoint.
- Deploying credentials or changing the existing Eventor proxy.
- Production publishing or testing against a live competition.
- Replacing the manual XML upload workflow.

## Follow-up after a GO decision

Create a separate implementation item for a trusted backend publish endpoint,
admin authorization, final-result preview/confirmation, Eventor identity
validation, idempotent retries, an auditable publication record, response
handling, and a controlled non-production end-to-end test. Include ResultList
identity serialization if the verified contract uses IOF XML.
