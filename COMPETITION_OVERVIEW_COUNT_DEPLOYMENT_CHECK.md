# Competition overview count deployment check

**Checked:** 2026-11-19 (Europe/Stockholm)  
**Production URL:** https://sekretariatet.vercel.app/

## Result

The production page is currently serving a JavaScript bundle containing the
Firestore-count fix. This rules out a missing deployment at the served-bundle
level. The exact Vercel deployment commit SHA is not published by the page or
available in GitHub's deployment records, so the deployment SHA cannot be
independently attested. Based on the served bundle and repository state, the
most likely source commit is `6a0c9f131feb7c7466ac31e3c3a04973764d0739`.

The remaining causes cannot be separated from available read-only evidence:
the affected Firestore counters may be zero/missing, or a browser tab may still
be running an older app instance. No later count overwrite was found in the
Public Portal render path.

## Fix and repository state

- `mergePublicCompetitionSummaries()` is implemented in
  [`src/utils/publicCompetitionSummaries.ts`](./src/utils/publicCompetitionSummaries.ts).
- For matching competition IDs, the merge spreads the API summary first and
  Firestore summary second. Firestore therefore supplies `competitorCount` and
  `finishedCount`; the explicit `classCount` fallback is preserved.
- `main`, `origin/main`, and `origin/HEAD` were at
  `6a0c9f131feb7c7466ac31e3c3a04973764d0739` when checked. That commit modifies
  the merge helper and its tests.
- Focused validation passed: `npx vitest run
  src/utils/publicCompetitionSummaries.test.ts` (3 tests).

## Production bundle verification

The live page at https://sekretariatet.vercel.app/ returned
`/assets/index-DQeqvqLw.js`, the same hashed asset referenced by the local
`dist/index.html`.

The live asset's decoded UTF-8 content matched the local `dist` asset exactly:

- SHA-256: `972999E64A82C34E4A89D2D34588F366BE57A52D00C38B01121514C6C422A2DA`
- The bundled merge body uses `{...e,...t,classCount:t.classCount||e.classCount}`
  for matching IDs, where `t` is the Firestore summary. This is the fixed
  source-priority behavior.
- The production HTML and JavaScript asset responses both used
  `Cache-Control: public, max-age=0, must-revalidate`. The JS response was a
  Vercel edge `HIT`, but its content hash and live HTML reference match the
  fixed bundle; this is not evidence of an old CDN bundle.

GitHub's repository Deployments API returned no deployment records, and there
were no GitHub Actions workflow runs. The production response exposes a Vercel
request ID, not a deployment commit SHA. Thus `6a0c9f1...` is the likely build
commit, not an independently verified deployment metadata value.

## Assessment of the reported possibilities

| Possibility | Assessment | Evidence / limitation |
|---|---|---|
| **A. Deployment missing** | **No, for the current page response.** | The live page points to the exact fixed bundle also present in local `dist`. Deployment SHA itself is unavailable. |
| **B. Old cached bundle** | **Not indicated at the production URL; still possible in an already-open client.** | Current HTML is revalidated and references the fixed hashed asset. A browser tab that has not reloaded can continue executing the JS it loaded earlier; the live check cannot inspect the user's browser state. |
| **C. Firestore counts actually are 0** | **Unknown.** | No production Firestore values or affected competition IDs were available for this check. Firestore summary loading defaults missing count fields to zero, so zero/missing parent fields can still produce `0/0`. |
| **D. Another code path overwrites the counts** | **No overwrite found in the Public Portal path.** | [`PublicPortalView`](./src/components/PublicPortalView.tsx) calls the merge and renders the merged fields. No subsequent count calculation or assignment occurs between that merge and the overview card. A different screen may render its own summaries but does not feed this card. |

## Conclusion

The deployed bundle contains the fix, so redeploying solely to ship this merge
change is not supported by the evidence. To explain a remaining `0/0`, check
the affected competition document's `competitorCount` and `finishedCount` in
Firestore, confirm the matching ID is present in the Firestore summary
listener, and reload the affected browser tab. Those live data/client checks
were outside the access available here.
