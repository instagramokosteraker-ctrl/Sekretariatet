# Competition overview count analysis

> Historical note: This analysis describes the pre-fix behavior. Firestore is
> now authoritative for counts when a matching Firestore summary exists; see
> [COMPETITION_OVERVIEW_COUNT_FIX.md](./COMPETITION_OVERVIEW_COUNT_FIX.md).

## Finding

The public season overview renders `{finishedCount}/{competitorCount} i mål`
from a `CompetitionSummary`; it does not calculate the counts from class,
competitor, or `publicResults` documents itself.

For competitions present in both the API response and the Firestore listener,
`mergePublicCompetitionSummaries()` deliberately keeps the API's two count
fields, even though it spreads the Firestore summary afterward. Consequently,
an API summary of `0/0` masks nonzero counts in the Firestore competition
document and the UI displays `0/0`.

This is the precise code-level explanation for the reported symptom when the
Firestore parent document has nonzero counters but the API's summary is stale
or incomplete. This repository inspection did not query the deployed Firestore
database, so the exact live values for the affected competitions cannot be
confirmed here.

## Data flow

1. [`PublicPortalView`](./src/components/PublicPortalView.tsx) first fetches
   `/api/public/season` and stores `overview.competitions` as the API list. If
   that request fails, it tries `/api/public/competitions`, then loads summaries
   from Firestore.
2. The same view subscribes to
   `subscribePublicCompetitionSummaries()` for Firestore summary documents.
3. `mergePublicCompetitionSummaries(apiCompetitionsList,
   firestoreCompetitionsList)` combines entries by competition ID.
4. The overview card renders `ev.finishedCount/ev.competitorCount` as “i mål”.

## Sources and fields

| Source | File/function | `competitorCount` | `finishedCount` |
|---|---|---|---|
| API summary | [`server.ts`, `buildCompetitionsSummaryList()`](./server.ts) | `ev.competitors.length` from the server's in-memory `seasonDb.eventsMap` | Count of competitors with status `OK`, `MP`, or `PRELIMINARY_FIN` |
| Firestore summary | [`firebase.ts`, `subscribePublicCompetitionSummaries()`](./src/firebase.ts) | `competitions/{id}.competitorCount` | `competitions/{id}.finishedCount` |
| Firestore fallback | [`firebase.ts`, `loadPublicCompetitionSummariesFromFirestore()`](./src/firebase.ts) | Same parent-document field | Same parent-document field |
| Card display | [`PublicPortalView.tsx`, `renderGroup()`](./src/components/PublicPortalView.tsx) | `ev.competitorCount` | `ev.finishedCount` |

The Firestore summary parser defaults missing counter fields to zero. It does
not count competitor documents or read `publicResults`. The public result
projection is loaded for an individual race page, not used to calculate the
season overview cards.

## Firestore versus rendered values

For a competition whose ID is present in both sources,
[`mergePublicCompetitionSummaries()`](./src/utils/publicCompetitionSummaries.ts)
returns the API's counts:

```ts
return {
  ...apiSummary,
  ...firestoreSummary,
  competitorCount: apiSummary.competitorCount,
  finishedCount: apiSummary.finishedCount,
};
```

Thus, for example, if Firestore contains `competitorCount = 24` and
`finishedCount = 6`, while the API summary contains `0` and `0`, the merged
summary and rendered card are `0/0`. These numbers illustrate the code path;
they are not measurements of the affected production competitions.

The API count is calculated from a separate server-side season object, not by
reading the Firestore counters. On non-Vercel deployments that object is loaded
from the server's season database; `buildCompetitionsSummaryList()` counts its
competitor arrays. A stale or incomplete server copy can therefore disagree
with current Firestore documents. The public Firestore listener receives
updates, but the merge function still preserves the API counts.

When there is no API summary for an ID, the Firestore-only entry is appended
and its Firestore counters are rendered. When there is no Firestore summary,
the API counts are rendered directly.

## Existing test behavior

[`publicCompetitionSummaries.test.ts`](./src/utils/publicCompetitionSummaries.test.ts)
currently asserts that API counts win when API counts are nonzero and Firestore
metadata has zero counts. This encodes the current source-priority policy; it
does not cover the inverse case of a stale API `0/0` masking current nonzero
Firestore counts.

## Minimal fix

If the reported competitions' Firestore parent counters are confirmed to be
current, the minimal fix is to stop explicitly restoring the API count fields
after the Firestore spread. For matching IDs, use the Firestore counters and
retain API counts only when no Firestore summary exists. Update the merge test
to cover API `0/0` with nonzero Firestore counters.

The current test documents the opposite stale-data case, so simply switching
priority trades one failure mode for another if either source may be stale.
The more reliable follow-up is to give the overview one authoritative count
source (or freshness/version metadata) rather than choosing a source based on
the numeric count. `publicResults` should not be used as the competitor total:
it is a result projection, not the complete registration list.

## Expected versus actual

- **Expected:** for a competition with registered competitors and current
  counts in Firestore, its overview card should show those Firestore
  `finishedCount` and `competitorCount` values.
- **Actual from this code path:** if the matching API `CompetitionSummary`
  contains `0/0`, the merged summary and card show `0/0`, regardless of
  nonzero Firestore counters.
- **Unverified live values:** access to the production Firestore data and the
  affected API payloads is needed to confirm which competitions currently have
  the mismatch.
