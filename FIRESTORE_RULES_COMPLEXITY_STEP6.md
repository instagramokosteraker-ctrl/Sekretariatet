# Firestore Rules Complexity — Step 6

## Result and path comparison

The latest recorded connected suite run failed with the 1,000-expression limit reported on both:

- competitor `allow create` at [firestore.rules](./firestore.rules#L1729);
- competition `allow update` at [firestore.rules](./firestore.rules#L1366).

The emulator does not report per-helper or per-document expression counts, so it cannot prove which path crosses the ceiling first. **Best source-based estimate: A) competitor create is slightly more likely to be the primary source**, with low confidence. Its one allow expression combines the full competitor schema validator with active assignment parity and receipt/RunnerDb authorization. The readout counter update uses the similarly large competition schema validator, but its admin alternatives short-circuit and its successful counter branch performs a narrower set of checks. B is nevertheless independently reported over the limit and remains a real blocker.

No rules were changed and the suite was not rerun in this step.

## Competition `allow update` call chain

For the positive `readoutAutocreateBatch` update of `competitions/evt_live`, the rule at [firestore.rules](./firestore.rules#L1366) evaluates:

1. Common guards: `isVerifiedUser()`, `isValidCloudCompetition(incoming())`, `isValidId(competitionId)`, `resource != null`, immutable competition ID/owner/createdAt comparisons, and `updatedAt == request.time`.
2. The authorization/update OR:
   - Action 1: owner/admin, active status, admin check, then a 22-key allowlist.
   - Action 2: super-admin, then the same 22-key allowlist.
   - Action 3: admin reopening a completed competition with a status-only allowlist.
   - Action 4: READOUT/FOREST/SPEAKER counter update: active status, both counters increment exactly once, and a three-key affected-key allowlist.
   - Action 5: READOUT/FOREST/SPEAKER finished-count-only update: active status, a bounded finished-count transition, and a two-key affected-key allowlist.

For this batch's non-admin READOUT caller, Action 1's owner comparison is false and its `isAdmin()` check fails; Action 2's `isSuperAdmin()` check fails; Action 3's `isAdmin()` check fails. Action 4's READOUT role check and exact counter transition pass, so Action 5 is short-circuited. The two 22-key allowlist expressions and the Action 5 counter branch are not evaluated on this path.

## Document-access call counts

Counts are for the executed readout counter branch in this batch. `existing()` reads the current write's resource map; it is not a Firestore `get()` call.

| Helper/path | `get()` | `getAfter()` | `exists()` | `existsAfter()` |
|---|---:|---:|---:|---:|
| `isAdmin()` in Action 1 owner/admin fallback | 0 | 0 | 1 | 0 |
| `isSuperAdmin()` in Action 2 | 0 | 0 | 1 | 0 |
| `isAdmin()` in Action 3 | 0 | 0 | 1 | 0 |
| `canCreateReadoutCompetitor()` → matching READOUT `hasOfficialRole` | 1 | 0 | 1 | 0 |
| `isValidCloudCompetition`, ID checks, resource/incoming comparisons, counter/diff checks | 0 | 0 | 0 | 0 |
| Parent-competition helper calls | 0 | 0 | 0 | 0 |
| **Total for this update evaluation** | **1** | **0** | **4** | **0** |

The single `get()` and one `exists()` for the role assignment are in `roleAssignments/readout_uid`. The three other `exists()` calls are checks for `admins/readout_uid`: one in `isAdmin()` for Action 1, one in `isSuperAdmin()`, and one in `isAdmin()` for Action 3. Since this fixture has no admin document, the `isSuperAdmin()` call does not reach its conditional `get(admins/...)`.

There are **no calls** to `parentCompetitionExists()` or `parentCompetitionData()` in the competition update rule. It reads its own existing document through `resource`/`existing()`, not through a parent lookup.

## Repeated checks

- **Parent reads:** none. Repeated `existing().status`, `existing().ownerUid`, and counter field references access the same resource map; they do not issue repeated document reads.
- **Role checks:** the admin/super-admin alternatives repeat admin-profile existence checks on this READOUT path. The counter authorization has two syntactic `canCreateReadoutCompetitor()` calls, but only Action 4 executes for the batch; Action 5 is short-circuited. If Action 4 fails and Action 5 is considered, the role helper may be evaluated again.
- **Ownership:** the common immutable-owner check compares incoming owner with stored owner. Action 1 separately compares the stored owner with the caller as part of the admin path. These enforce different conditions; neither is a repeated document fetch.
- **Schema validation:** `isValidCloudCompetition(incoming())` is called once in this update rule. The repeated field accesses in the OR branches do not rerun that validator.
- **Counter validation:** `isValidCloudCompetition` checks counter types, ranges (0–50,000), and `finishedCount <= competitorCount`. Action 4 additionally requires both counts to increment exactly once; Action 5 permits only a bounded finished-count change. These transition constraints are not duplicates of the schema bounds. For the batch, only Action 4 runs.
- **Affected-key allowlists:** Actions 1 and 2 contain the same 22-key list, but neither list executes for the READOUT counter update because both role guards fail first. They may contribute on admin/super-admin updates, not on this request path.

## Helper cost estimates and ranking

These are source-level estimates, not measured emulator expression counts.

1. **`isValidCloudCompetition(data)` — highest single helper cost.** Approximately 80–90 atomic field predicates in the source: strict key sets; ID/name/date/status/time formats; numeric bounds; optional booleans and legacy fee field; counter constraints; arrays/maps; four optional PIN validations; owner and timestamps. It performs no document reads.
2. **Update authorization OR and affected-key comparisons.** Not a helper, but the largest surrounding rule expression. The two admin allowlists each name 22 fields. They are skipped on the test's successful READOUT path; Action 4 evaluates one three-key allowlist.
3. **`canCreateReadoutCompetitor()` → `hasOfficialRole()` / `isOfficialRole()`.** A small predicate chain plus one role-assignment `exists` and `get` when READOUT matches first. It is called syntactically in both counter branches, but only once in the positive batch.
4. **`isAdmin()` / `isSuperAdmin()` → `isBootstrappedAdmin()` / `isVerifiedUser()`.** Small token checks plus admin-profile existence checks; on this path, three admin `exists()` expressions are executed. `get()` in `isSuperAdmin()` is skipped because the admin document is absent.
5. **`isValidId(competitionId)` and `isVerifiedUser()` / `isSignedIn()`.** Small path/token checks and no document access.
6. **`incoming()`, `existing()`, and `resource != null`.** No document-access calls; these provide maps or simple guards. Their many field comparisons are counted in the rule/validator costs above.

The validator estimate treats compound conditions as atomic predicates for source counting; the Rules emulator's expression meter may count implementation details differently. It does not expose a per-helper expression count.

## A vs. B evidence

**A) competitor create is marginally more likely**, based on the executed path, not the emulator's error wording:

- Its rule combines a large competitor validator with the assignment after-state check and the readout receipt/RunnerDb identity chain. Those validations all execute in the READOUT create branch.
- The test fixture's competition update also runs a large validator, but its readout path short-circuits the admin allowlists and the second counter branch. It performs no `getAfter()` calls and only one role-assignment read.
- The existing emulator evidence explicitly reports both rule statements over the expression limit. It does not distinguish a primary path or give remaining counts, so the preference for A is provisional; B is not ruled out as an independent over-limit evaluation.

The last recorded test failure and competitor-create evidence are in [FIRESTORE_RULES_COMPLEXITY_STEP5.md](./FIRESTORE_RULES_COMPLEXITY_STEP5.md). No new emulator run was made because the request capped testing at one run and the available evidence already contains a connected run.
