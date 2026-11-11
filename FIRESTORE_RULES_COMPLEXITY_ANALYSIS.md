# Firestore Rules Complexity Analysis

## Result

The readout auto-create batch exceeds the Firestore Rules 1,000-expression evaluation limit. The current emulator diagnostics attribute the limit to the competitor create/update rule expression and the competition update expression; they do not identify an individual helper or provide per-helper expression counts. The source trace below identifies the highest-cost repeated validation paths. No rule change is made by this analysis.

## Batch and rule paths

`readoutAutocreateBatch` in [firestore.rules.test.ts](./firestore.rules.test.ts#L647) has four writes:

1. `set competitions/evt_live/competitors/cmp_readout_test` — a **competitor create**, not a competitor update.
2. `set competitions/evt_live/siCardAssignments/8500118` — an assignment create.
3. `set competitions/evt_live/readoutReceipts/ro_readout_test` — a receipt create.
4. `update competitions/evt_live` — the competition counter update.

The suite fails at `assertSucceeds(readoutAutocreateBatch.commit())` in [firestore.rules.test.ts](./firestore.rules.test.ts#L702).

### Competitor create

The create rule validates the full competitor schema with `isValidCloudCompetitor`, checks identity/owner/timestamps and the parent competition, then calls `hasActiveSIAssignmentAfter`. The readout authorization branch additionally calls `readoutCompetitorMatchesRunnerDb`, which checks the post-write competitor, processed receipt, and RunnerDb identity.

This is the most substantial single validation chain for the readout path:

`competitor create` → `hasActiveSIAssignmentAfter` and `readoutCompetitorMatchesRunnerDb` → `hasProcessedReadoutReceiptAfter`.

### Assignment create

The assignment create rule validates the full assignment schema, checks the competitor mutation with `hasCompetitorSIOrLifecycleMutationAfter`, and checks post-write parity with `assignmentMatchesCompetitorAfter`. Its READOUT branch then calls `readoutAssignmentMatchesRunnerDb`, which calls `readoutCompetitorMatchesRunnerDb` again and compares the competitor's SI, card series, and owner to the assignment.

That means the same readout competitor/receipt/RunnerDb relationship is independently revalidated for both the competitor write and the assignment write. The generic assignment/competitor pairing checks also repeat several of the same identity and ownership comparisons for the assignment write.

### Receipt create

The receipt rule validates the receipt schema and ties its path, competition, owner, client readout ID, creation time, parent state, and role to the request. These checks are necessary, but their values are also compared in `hasProcessedReadoutReceiptAfter`.

### Competition update

The parent competition update rule validates the full incoming competition with `isValidCloudCompetition`, checks immutable identity/owner and timestamps, then evaluates the role-specific update branches. The readout counter branch checks the non-completed state, exact count transitions, and affected-key allowlist. The emulator reports the expression ceiling on this update expression as well.

## Repeated work and recursion

The source contains no recursive rule-function call. It does contain nested validation chains and repeated reads/field checks:

- `hasActiveSIAssignmentAfter` reads fields from the same post-write assignment repeatedly and does the same for the competitor.
- `readoutCompetitorMatchesRunnerDb` repeatedly reads the same post-write competitor, and calls `get()` repeatedly for the same RunnerDb path (name, club, and card series).
- `hasProcessedReadoutReceiptAfter` repeatedly reads fields from the same post-write receipt.
- `readoutAssignmentMatchesRunnerDb` re-enters `readoutCompetitorMatchesRunnerDb`, then reads the same competitor again for SI, card series, and owner.
- `canCreateReadoutCompetitor` is checked in `readoutAssignmentMatchesRunnerDb` and again inside the nested `readoutCompetitorMatchesRunnerDb`.
- Competitor, assignment, and receipt owner checks overlap by design: each record must independently match the authenticated readout owner.

Firestore may cache document-access calls for its access-call limits, but repeated `get`/`getAfter` expressions, map field comparisons, schema validation, and nested helper evaluation still consume rule-expression work. The emulator's reported 1,000-expression limit is distinct from the document-access-call limit.

## Minimal recommended optimization

Keep all existing validation and authorization predicates, but avoid recomputing the same post-write maps and readout identity checks within each rule evaluation:

1. After an `existsAfter` guard, fetch each required post-write competitor, assignment, or receipt once and pass its `.data` map to a data-only comparison helper. In particular, replace repeated reads in `hasActiveSIAssignmentAfter` and `hasProcessedReadoutReceiptAfter` with one comparison over the fetched maps.
2. In the readout identity helper, fetch the competitor and RunnerDb entry once, then compare the required fields from those maps. Do the same for the receipt.
3. Make the data-comparison helper independent of role checks. Retain `canCreateReadoutCompetitor()` at each allow-rule call site, but evaluate it only once per write. Have the assignment helper compare the cached competitor map to the assignment rather than invoking the full readout check and then fetching the competitor fields again.
4. Preserve `hasCompetitorSIOrLifecycleMutationAfter`, the active-assignment/competitor parity checks, receipt provenance, RunnerDb identity checks, and all owner/ID/SI/card-series comparisons. Do not remove any of these unless an exact equivalent check remains in the same authorization path.

Rules-language `let` bindings and small data-only helpers can implement this without changing the allowed states. Keep `getAfter` reads behind the corresponding existence checks so missing documents continue to deny rather than cause unsafe fallback behavior. After this optimization, rerun the positive readout batch and negative spoofed-readout/assignment cases; confirm the competition counter limits and affected-key checks remain enforced.

## Risk and security impact

- **Expected risk:** low-to-moderate. Reusing fetched maps is behavior-preserving in principle, but moving guards or role checks can accidentally change short-circuit behavior or leave a call site without authorization.
- **Permissions broadened:** none, provided the existing predicates are retained and role checks remain at every allow-rule call site.
- **Security guarantees:** unchanged under that constraint. The intended optimization removes repeated evaluation, not schema validation, paired-write enforcement, receipt/RunnerDb provenance, or ownership and identity parity.
- **Deployment:** none. This is a recommendation only; `firestore.rules` was not changed for this analysis.
