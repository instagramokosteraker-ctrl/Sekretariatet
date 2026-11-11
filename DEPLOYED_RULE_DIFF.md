# Deployed Firestore Rules Diff

- Assessment: 2026-11-11.
- Project/database: `ai-studio-applet-webapp-72c01` / `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`.
- Method: read-only Firebase Console release/source inspection, compared with repository `firestore.rules` and commit `90f0e9f`.
- No rules were deployed or edited; no production data was written.

## Active release identified

The Firebase Console Security rules version list showed `Yesterday • 8:23 AM` as the newest, star-marked release on the 2026-11-11 assessment date (i.e. Nov 10 at 8:23 AM in the Console's displayed timezone). The star-marked release was selected and its rules editor inspected. The Console did not expose an immutable release ID or source hash in the inspected view; therefore the release is identified by its project/database, star/current marker, and displayed timestamp, not by a revision hash.

The editor displayed 1,955 numbered source lines (1–1,955). The full visible CodeMirror content was collected read-only and compared at token level, ignoring whitespace and comments, to avoid treating formatting-only differences as policy changes. The Rules API request was unavailable without API authorization; there was no local Firebase CLI or `gcloud` CLI for an independent source export.

Repository comparison:

- `90f0e9f` (`2026-11-10 21:19:26 +0100`, “Implement assignment boundary hardening with transaction safety and identity validation”) contains the reviewed `firestore.rules`.
- Current working-tree `firestore.rules` is byte-identical to that commit's blob: `ec58bae9f5d83b7b1b9cea3ba5efeeccb2bd365e`.
- The star-marked Console release predates that commit by about 12 hours 56 minutes.

## Material differences

| Area | Repository / `90f0e9f` | Star-marked deployed release | Material effect |
|---|---|---|---|
| Competitor schema / readout receipt | The competitor validator permits and validates optional `readoutReceiptId`. | That field and its validation are absent. | The deployed validator is not equivalent to the readout auto-create flow and may reject its competitor payload. |
| Assignment and readout guard helpers | Defines `hasActiveSIAssignmentAfter`, `hasRetiredSIAssignmentAfter`, `hasCompetitorSIOrLifecycleMutationAfter`, and `assignmentMatchesCompetitorAfter`; also defines receipt/RunnerDb checks for readout-created competitor and assignment records. | These helper functions are absent. | The deployed rules have no reusable paired-write, post-write parity, retirement, or readout provenance predicates. |
| Competition count update for readout creation | Contains a readout-role count-transition branch with expected counter changes. Readout receipt and RunnerDb validation is enforced by separate helper predicates. | The branch is absent. | Rules no longer enforce the repository's readout creation/counter coupling. |
| SI assignment create | Requires a meaningful competitor mutation in the same commit, validates the post-write assignment against the competitor (including IDs, SI, series, and owner), and permits only admin or the validated readout path. | Validates assignment shape/path/parent and requires admin; it does not require or compare a corresponding competitor mutation. | An admin can create an assignment independently of its competitor document. |
| SI assignment update | Requires the paired competitor mutation and post-write parity. It preserves immutable fields but permits an owner change only for the specific `RETIRED` → `ACTIVE` transition. | Does not require a paired competitor mutation; requires ownerUid to remain unchanged; no retired-to-active owner transition exception. | An admin can independently alter mutable assignment fields without checking competitor identity, SI, series, lifecycle, or owner parity. The narrower immutable-owner rule does not restore pair integrity. |
| SI assignment delete | `allow delete: if false`. | Allows a verified admin to delete an existing assignment under the parent competition. | Direct assignment deletion is allowed and can leave the competitor unpaired. |
| Competitor create | Requires a matching active assignment after the write; the readout role path additionally validates a processed receipt and matches RunnerDb identity. | Lacks the active-assignment predicate and readout-specific checks; create is governed by admin/super-admin authorization. | An authorized admin can create a competitor with no matching active SI assignment. |
| Competitor update / SI reassignment | Requires either the matching active assignment for a card-series change, or retirement of the old SI plus a matching active assignment at the new SI. Owner and immutable identity fields are preserved. | Lacks the active/retired assignment predicates; an admin can update competitor SI/card-series through the allowed field set without paired assignment writes. | SI/card-series reassignment can bypass the assignment lifecycle and leave stale or conflicting assignment records. |
| Competitor delete | Requires the matching SI assignment to be retired in the same operation. | The retirement predicate is absent; authorized deletion can proceed without retiring the assignment. | Direct competitor deletion can strand an active assignment. |

Other compared source tokens were equal; the differences above are the complete material policy differences found. Formatting and comments are not counted as material differences.

## Requested bypass determinations

| Question | Result | Evidence |
|---|---|---|
| Assignment create without paired competitor mutation? | **Yes** | Deployed assignment `allow create` has no `hasCompetitorSIOrLifecycleMutationAfter` or `assignmentMatchesCompetitorAfter` predicate and allows admins. |
| Assignment update without paired competitor mutation? | **Yes** | Deployed `allow update` has no paired mutation or parity predicate and allows admins. |
| Direct assignment delete? | **Yes** | Deployed assignment rule allows admin delete; repository rule denies it. |
| Ownership bypass? | **Yes, at assignment/competitor parity boundary.** | Assignment create/update does not compare the assignment owner and identity to the competitor. Create still requires assignment `ownerUid == request.auth.uid`; this is not evidence that the deployed rule lets a client arbitrarily rewrite an existing competitor's immutable `ownerUid`. |
| SI reassignment bypass? | **Yes** | Deployed competitor update lacks checks to retire the previous SI and establish a matching active assignment for the new SI. |

## Assignment Boundary Hardening impact

**Yes.** Current production rules invalidate the assumption that Firestore Rules independently enforce the Assignment Boundary Hardening invariant for every authenticated client writer. An authorized client can call Firestore directly and create/update/delete assignment documents or change competitor SI identity without the paired transaction writes required by the repository rules.

This does **not** show that the canonical application code's transaction is non-atomic. It shows the production rules do not protect the boundary from an alternate direct client path. Rules also do not constrain Admin SDK writers. Until the reviewed rules are deployed and their active release is re-attested, repository-local transaction guarantees alone cannot establish production-wide enforcement.

## Conclusion and closure

Deployed-rule assurance is **FAIL**, not a conditional pass. Keep readiness **NO-GO**. A pass requires an approved production deployment of the reviewed rules, capture of the exact active release ID/source or hash, confirmation that the deployed assignment create/update/delete and competitor create/update/delete predicates match the repository, and passing emulator rules regression tests. No production deployment was performed as part of this assessment.
