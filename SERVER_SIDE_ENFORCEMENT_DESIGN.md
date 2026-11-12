# Server-Side Enforcement Design

## Summary

The current competitor write path is too expensive for Firestore Rules because it combines:

- full document schema validation
- ownership checks
- role checks
- active assignment parity
- receipt provenance
- RunnerDb identity validation
- parent competition state checks
- update-path field continuity checks

This is a cross-document integrity problem, not just a simple auth problem. Firestore Rules should enforce only cheap, high-confidence gates; the business-critical integrity checks should run in a trusted server-side transaction.

This design preserves Atomic SI Matching, Assignment Boundary Hardening, and ownership guarantees while removing the Rules expression-limit blocker.

## 1) What should remain in Firestore Rules

The Rules layer should remain responsible for the following, all of which are cheap and boundary-oriented:

### Authentication and auth context

- `request.auth.uid` exists
- identity is present and valid
- user is signed in
- role/permission checks that are cheap and static
  - `isAdmin()`
  - `isSuperAdmin()`
  - `hasOfficialRole(...)`

These checks are intended to answer: "Is this caller allowed to attempt this write?"

### Ownership and caller intent

- `request.auth.uid` matches `ownerUid` for user-owned writes
- path identity matches resource identity
- resource ownership is consistent with the authenticated caller for the allowed role branch

These are simple authorization checks and should remain in Rules.

### Path validation

- document IDs are valid
- competition/competitor/assignment IDs are syntactically valid
- path/object identity matches the document path
- fundamental document shape sanity checks that do not require expensive cross-document logic

Examples:

- `isValidId(...)`
- `incoming().competitionId == competitionId`
- `incoming().competitorId == competitorId`
- `incoming().createdAt == request.time`
- `incoming().updatedAt == request.time`

These are cheap and should remain in Rules.

### Basic schema validation

Rules may still enforce a minimal document structure and field type guard, but only the small, cheap subset that is safe and local.

Allowed in Rules:

- required field presence for the minimal write document
- type guards for scalar fields
- range checks that are local and cheap
- status enum checks that are local and never require a cross-document lookup
- obvious write-shape sanity checks

What should not be in Rules:

- full competitor schema validation with large nested validation chains
- full assignment parity validation against another document
- RunnerDb identity validation
- receipt provenance validation
- cross-document competitor/assignment consistency checks
- complex after-state mutation checks that require multiple reads and field comparisons

## 2) What should move to server-side transactions

The following validations belong in a trusted server-side transaction, not in Firestore Rules:

### Assignment parity

These checks require reading the assignment and/or competitor in the same transaction and validating them together:

- active assignment exists for the target SI
- assignment `competitionId` matches the competitor
- assignment `siNumber` matches the competitor
- assignment `cardSeries` matches the competitor
- assignment `ownerUid` matches the competitor
- `competitorDocumentId` matches the competitor document ID
- retired-active transition rules remain valid
- reassignment of SI or card series satisfies the canonical assignment contract

This is exactly the sort of enforcement that scales poorly in Rules but is straightforward in a transaction.

### RunnerDb identity validation

The readout path must compare competitor identity against the authoritative RunnerDb record.

This should be enforced server-side:

- read RunnerDb by `siNumber`
- compare `fullName`, `club`, and `cardSeries`
- treatment of the existing `Klubblös` special case remains in the backend logic
- reject mismatches before committing the competitor write

This is a cross-document rule and should not be implemented inside Rules.

### Receipt provenance

The readout flow requires the receipt to be present and processed, and to match the competitor being created.

This should be enforced in the transaction:

- read the receipt by ID
- verify it is `PROCESSED`
- verify `receipt.competitorId == competitorId`
- verify `receipt.siNumber == siNumber`
- verify `receipt.cardSeries == cardSeries`
- verify the receipt owner matches the caller or approved system flow

This is a required integrity check, but it is too expensive for a Rules expression budget.

### Cross-document integrity checks

These checks are logically server-side because they depend on multiple documents and exact business state:

- assignment/competitor matching
- readout workflow consistency
- lifecycle state of the parent competition
- duplicate SI conflict resolution
- retired/active assignment transitions
- no partial commit across competitor + assignment + receipt

This is the correct place for enforcement because the backend can perform the reads and then atomically commit only after the invariants pass.

## 3) Preserve the critical guarantees

This design preserves the critical invariants already identified by the rules and architecture work.

### Atomic SI Matching

The system must keep `siCardAssignments/{siNumber}` as the canonical mapping layer.

Server-side transaction flow:

1. Validate caller and path
2. Read the target assignment document
3. Read the current competitor document
4. Check active/retired state and ownership
5. Write competitor + assignment together
6. Abort on any conflict or invalid mutation

This preserves the single authoritative SI-to-competitor mapping and closes the assignment escape hatch.

### Assignment Boundary Hardening

The existing hardening requirement remains:

- no standalone assignment mutation path
- no direct SDK writer path from an untrusted or untracked caller
- assignment and competitor mutations must occur in the same transaction
- conflict or mismatch aborts the full transaction

This remains true in the server-side model.

### Ownership guarantees

Rules still enforce:

- authenticated caller exists
- caller matches owner for direct-owner operations
- role can attempt the mutation

The transaction enforces:

- the assignment matches the competitor's `ownerUid`
- the target transaction is valid for the current `competitionId`, `siNumber`, and `cardSeries`
- there is no silent owner or identity drift

This preserves the current trust model while moving business validation off the Rules execution path.

## 4) Minimal architecture change required

The minimal architecture change is not a large rewrite. It is a boundary shift:

### Keep in Firestore Rules

- auth checks
- basic role checks
- basic path validation
- minimal local schema sanity
- safe status gating

### Move to backend transaction layer

- competitor-to-assignment parity
- assignment lifecycle validation
- RunnerDb identity matching
- receipt provenance
- cross-document integrity checks
- final business-logic verification before commit

### Commit model

Use a single server-side transaction for the atomic unit:

- competitor create/update
- assignment create/update/retire
- receipt create/update if required by the flow
- any related competition counter update, if still needed, as a separately authorized follow-up

This is minimal because it does not change the rules of the domain model. It only moves the expensive, cross-document validation out of the Rules engine and into the backend transaction path where the evaluation budget is not constrained by Firestore Rules.

## 5) Recommended contract

The final rule contract should be:

- Rules: allow the write only if the caller is permitted and the document is structurally plausible.
- Backend transaction: validate the full business state and reject invalid combinations before commit.

This gives a clean separation:

- Rules = authorization and safety boundaries
- Backend = domain integrity and consistency

## 6) Would this remove the Firestore Rules expression-limit blocker?

Yes, in practical terms it should remove the blocker.

Why:

- the problematic competitor create/update paths are dominated by heavy cross-document validation
- those checks are the ones that exceed Firestore Rules' expression budget
- moving them to a backend transaction removes them from the Rules request path entirely
- Rules then only evaluate a small, cheap authorization layer, which fits the intended use of Firestore Rules

The result is not merely a workaround. It is the correct architectural split for this workload.

This design keeps the same security guarantees while making the system compatible with Firestore Rules constraints.
