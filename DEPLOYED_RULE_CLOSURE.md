# Deployed Firestore Rules Closure

- Assessment: 2026-11-11 11:03 CET.
- Project/database: `ai-studio-applet-webapp-72c01` / `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`.
- Verdict: **FAIL**.
- Scope: read-only reinspection of the Firestore Security Rules page and comparison with the existing source-level review. No rules or production data were changed.

## Release identification and limits

The latest previously identified Console release was the star-marked release displayed as `Yesterday • 8:23 AM` on November 11, 2026 (November 10 in the Console's displayed timezone). The current Console page still renders the 1,955-line rules source, including lines 1,922–1,955. This is consistent with the previously inspected source, but the currently loaded page does not expose a release ID, hash, deployment timestamp, or star marker. An immutable active-release attestation is therefore **not established** by this reinspection.

The prior full source comparison is recorded in [DEPLOYED_RULE_DIFF.md](./DEPLOYED_RULE_DIFF.md): the Console source was compared token-by-token with repository `firestore.rules` at commit `90f0e9f`. The working repository source hash recorded there is `ec58bae9f5d83b7b1b9cea3ba5efeeccb2bd365e`. That comparison found material policy differences; there is no evidence in this execution that the stale release was replaced.

## Bypass results

Based on the latest identified star-marked source:

| Required property | Result | Evidence |
|---|---|---|
| Assignment create requires a paired competitor mutation | **FAIL — bypass allowed** | Admin assignment create has no paired competitor mutation or post-write parity predicate. |
| Assignment update requires a paired competitor mutation | **FAIL — bypass allowed** | Admin assignment update has no paired mutation or parity predicate. |
| Direct assignment delete is blocked | **FAIL — delete allowed** | The deployed rule permits admin deletion; repository rules deny it. |
| Ownership parity is enforced | **FAIL — parity bypass allowed** | Assignment owner/identity are not compared to the competitor. Create still requires the assignment owner to be the authenticated user; this does not establish arbitrary rewriting of immutable competitor ownership. |
| SI reassignment requires retirement of the previous SI | **FAIL — bypass allowed** | Competitor SI/card-series updates lack the required old-assignment retirement and new active-assignment checks. |

Other material differences already identified include missing assignment lifecycle helpers, missing active-assignment checks on competitor creation, missing retirement checks on competitor deletion, and missing readout receipt/counter validation.

## Rule regression execution

The repository exports `runFirestoreRulesDirtyDozenSuite()` in `firestore.rules.test.ts`, but this execution did not run it or the paired-write regression matrix:

- Firebase CLI was not installed in the repository; a temporary `npm exec` invocation returned Firebase CLI `15.35.0`.
- No `firebase.json` is present.
- Node is `v26.13.0`; Firebase CLI emitted an engine warning for `superstatic`, which supports Node 20, 22, or 24.
- Java is not available on PATH, so the Firestore Emulator prerequisite is missing.

No emulator test result is claimed. No production Rules Playground simulations were run.

## Closure decision

**FAIL.** The current identified production source allows assignment create/update/delete and SI-reassignment bypasses; active release identity is not attested in this reinspection; and the regression suite remains unrun. Do not treat repository rules or application transactions as proof of production-wide enforcement. Closure requires an approved rules deployment, an immutable active-source/release attestation, and passing emulator positive/negative tests against that exact artifact.
