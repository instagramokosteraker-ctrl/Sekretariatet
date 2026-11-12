# Firestore Rules Complexity — Step 5

## Result

**FAIL.** The one connected run of `runFirestoreRulesDirtyDozenSuite()` still fails at `assertSucceeds(readoutAutocreateBatch.commit())` in [firestore.rules.test.ts](./firestore.rules.test.ts#L702). The emulator reports the 1,000-expression limit at competitor create ([firestore.rules](./firestore.rules#L1729)) and competition update ([firestore.rules](./firestore.rules#L1366)); it also reports the limit on other competitor-update cases ([firestore.rules](./firestore.rules#L1760)).

## Competitor create evaluation path

For the positive READOUT write in the failing batch, `/competitions/{competitionId}/competitors/{competitorId}` evaluates:

1. `isVerifiedUser`, `isValidId(competitionId)`, and `isValidId(competitorId)`.
2. `isValidCloudCompetitor(incoming())`, followed by path-ID, owner, and timestamp equality checks.
3. `parentCompetitionExists(competitionId)`.
4. `hasActiveSIAssignmentForCompetitorAfter(...)` to require an active matching assignment.
5. The authorization OR:
   - owner/admin branch;
   - `isSuperAdmin()`;
   - non-completed parent plus READOUT/FOREST/SPEAKER role, then receipt provenance and RunnerDb identity.

On the READOUT fixture, the owner/admin branch fails and checks `admins/readout_uid`; the super-admin branch checks the same admin document again; the final branch checks the competition status and READOUT role. `parentCompetitionData` is called for the owner comparison and status check.

## Document-access counts

Counts below are the calls executed for the test's non-admin READOUT branch. They count rule expressions, not distinct underlying document paths; Firestore may cache access results.

| Helper/path | Before: `get()` | Before: `getAfter()` | Before: `exists()` | Before: `existsAfter()` | After: `get()` | After: `getAfter()` | After: `exists()` | After: `existsAfter()` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `parentCompetitionExists` | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| Active assignment parity | 0 | 2 | 0 | 2 | 0 | 1 | 0 | 1 |
| Readout competitor guard | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| Receipt provenance | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 |
| RunnerDb identity | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 |
| Competition owner/status reads | 2 | 0 | 0 | 0 | 2 | 0 | 0 | 0 |
| Admin-profile checks (`isAdmin`, `isSuperAdmin`) | 0 | 0 | 2 | 0 | 0 | 0 | 2 | 0 |
| READOUT role lookup | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 |
| **Total** | **4** | **4** | **5** | **4** | **4** | **2** | **5** | **2** |

`isValidCloudCompetitor`, `isValidId`, `isVerifiedUser`, the data-only parity comparators, and the receipt/RunnerDb field comparators do not call `get`, `getAfter`, `exists`, or `existsAfter`.

The change eliminates the competitor `existsAfter`/`getAfter` pair previously used by assignment parity and the second competitor `existsAfter`/`getAfter` pair used by readout authorization. The assignment after-state and receipt after-state reads remain guarded by their existence checks.

## Repeated validation and parity

- **Receipt:** competitor creation performs one `hasProcessedReadoutReceiptAfter` check. The receipt's full schema is separately validated by the receipt-create rule in this batch; that is a different write authorization. Within the competitor-create helper chain, receipt validation/provenance is not repeated.
- **RunnerDb:** the competitor-create path fetches the RunnerDb entry once and compares full name, club (including the existing `Klubblös` exception), and card series. The assignment-create rule independently repeats this identity chain for its own authorization; it cannot be removed from competitor authorization on that basis.
- **Assignment:** competitor creation reads one after-state assignment and verifies state, competition ID, SI number, competitor ID, `competitorDocumentId`, owner, and card-series parity. The assignment's own create rule separately validates its schema and paired mutation. These checks serve distinct write rules and remain.
- **Ownership:** the competitor owner is checked against the caller; assignment owner is checked against the competitor; receipt owner is checked against the caller. The admin/competition owner branch is separate. These checks concern different documents or trust boundaries and were retained.
- **Parity:** the former generic comparator also compared the incoming competitor's ID, competition ID, SI number, and owner back to the same values passed from `incoming()`. The create-specific comparator now avoids those four self-comparisons. It still checks every assignment field against the validated incoming competitor, including assignment `ownerUid`, `siNumber`, `cardSeries`, both competitor identity fields, competition ID, and active state.
- `isValidCloudCompetitor`'s ID-format checks overlap with explicit path-ID validation and incoming/path equality. They remain unchanged in this step; the full schema validator is the largest validation helper in the create path.

## Helper cost ranking

Ranking is a source-based estimate; the emulator reports the failing rule statement, not expression counts per helper.

1. **`isValidCloudCompetitor(data)` — most expensive.** It validates the full competitor map, including strict keys, optional fields, multiple ID helpers, numeric ranges, status enum, timestamps, and punch-array constraints. It performs no document reads but has the largest source predicate chain.
2. **`readoutCompetitorIdentityMatchesRunnerDbData`** — invokes receipt provenance and RunnerDb existence/identity comparison. It has two document lookups (`existsAfter`/`getAfter` for receipt and `exists`/`get` for RunnerDb) plus field comparisons.
3. **`hasActiveSIAssignmentForCompetitorAfter` / `activeSIAssignmentMatchesCompetitorCreate`** — one guarded assignment after-state lookup plus assignment/competitor identity and parity checks. This step removed the redundant competitor after-state lookups.
4. **`isAdmin()` and `isSuperAdmin()`** — token checks and, for this non-admin fixture, two `exists(admins/readout_uid)` evaluations.
5. **`parentCompetitionData` / `parentCompetitionExists`** — two competition `get()` calls and one parent `exists()` on the READOUT branch.
6. **`canCreateReadoutCompetitor` / `hasOfficialRole` / `isOfficialRole`** — role enum and role-assignment check; the READOUT fixture performs one role-assignment `exists` and `get`.
7. **`hasProcessedReadoutReceiptAfter`, `processedReadoutReceiptMatchesCompetitor`, and `runnerDbMatchesReadoutCompetitor`** — these are the provenance/identity leaves counted in item 2; each has a small predicate set in addition to its guarded document lookup.
8. **`isVerifiedUser`, `isValidId`, and direct equality/timestamp guards** — no document lookups and smaller per-call predicate sets.

## Optimization and security impact

The create rule now passes `incoming()` to a create-specific active-assignment parity helper and invokes `readoutCompetitorIdentityMatchesRunnerDbData` directly after the existing path ID, competition ID, and role checks. It no longer fetches the competitor after-state just to retrieve the document that is already `incoming()`.

The assignment remains required to be active and match the incoming competitor's competition, SI number, ID, document ID, owner, and card series. The role, receipt provenance, RunnerDb identity, parent lifecycle, and caller-owner checks are unchanged. No security predicate was dropped; only comparisons of the incoming competitor to its own arguments and redundant after-state competitor reads were removed.

## Next exact hotspot

The limit still occurs at competitor `allow create` ([firestore.rules](./firestore.rules#L1729)); within that path, `isValidCloudCompetitor(incoming())` is the strongest remaining source-level expression suspect. The batch also independently exceeds the limit at competition `allow update` ([firestore.rules](./firestore.rules#L1366)). No further hotspot was modified or investigated in this step.

## Verification

Ran `runFirestoreRulesDirtyDozenSuite()` once with the test-only emulator at `127.0.0.1:8080` using `demo-passersi-rules-test`; the run exited with code 1. An initial invocation could not connect because the emulator had stopped; the connected suite run was made once after restarting it. The emulator was stopped afterward. No deployment was performed.
