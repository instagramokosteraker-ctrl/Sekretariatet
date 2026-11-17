# Firestore Live Sync Implementation Plan

**Status:** Phases 1 and 2 implemented; Phase 3 remains planned. See
[FIRESTORE_LIVE_SYNC_PHASE1_IMPLEMENTATION.md](./FIRESTORE_LIVE_SYNC_PHASE1_IMPLEMENTATION.md)
and
[FIRESTORE_LIVE_SYNC_PHASE2_IMPLEMENTATION.md](./FIRESTORE_LIVE_SYNC_PHASE2_IMPLEMENTATION.md).  
**Architecture decision:** Use Firestore listeners, as accepted in
[LIVE_SYNC_ARCHITECTURE_DECISION.md](./LIVE_SYNC_ARCHITECTURE_DECISION.md).

## Objective

Replace WebSocket-dependent live refresh for Secretariat, Speaker, and Public
Portal with competition-scoped Firestore listeners. Firestore must be the
shared, durable source for live result changes; a Vercel process-local state
snapshot is not sufficient.

This plan does not change result ranking, Bom, or validation. Actual punches
and validated result fields may be synchronized. Effective status, live
placing, and projected times remain client-derived and must not be written to
Firestore.

## Current flow and findings

| Area | Current flow | Finding |
|---|---|---|
| Secretariat | `App` loads `/api/state` (with Firestore fallback) and subscribes to active-competition competitors, radio/prewarning punches, and competition metadata. | Phase 1 now synchronizes competitor fields and actual radio passages through Firestore for authorized roles. Other socket payload fields remain on their existing paths. |
| Speaker | `SpeakerResultsView` receives competitors, classes, courses, and stations from `App`. | Shared competitor updates plus a competition-scoped public-result listener supply validated result fields and actual radio splits. Speaker does not need raw station-punch access. |
| Public Portal | The selected event is bootstrapped from `/api/public/events/...` or a safe Firestore projection. | The portal listens to selected-competition public results and safe competition/radio metadata; its `/api/ws` refresh loop is removed. |

The existing Firestore load and subscription helpers are in
[src/firebase.ts](./src/firebase.ts); app-level subscriptions are in
[src/App.tsx](./src/App.tsx); the two views are
[src/components/SpeakerResultsView.tsx](./src/components/SpeakerResultsView.tsx)
and [src/components/PublicPortalView.tsx](./src/components/PublicPortalView.tsx).
The WebSocket payload is assembled in [server.ts](./server.ts).

## WebSocket payload inventory

This inventory covers the `state:sync` payload used by the Secretariat. The
public socket sends only an invalidation (`public:ping`); the portal then
fetches a separate `PublicRacePayload`.

| Payload field | Current Firestore source | Existing realtime coverage | Required treatment |
|---|---|---|---|
| `activeEventId` | `/clubSettings/default.activeEventId` | Active-event listener exists. | Retain it as the selected-competition source of truth. Do not select the latest or a default competition on view changes. |
| `isEmptySeason` | Derived from the season's competitions. | No separate listener. | Derive from the competition summaries listener. |
| `isFreshColdStart` | Server process/startup state. | No Firestore source. | Keep as bootstrap/API state or remove from ongoing client synchronization if no view uses it. |
| `demoCleared` | `/clubSettings/default.demoCleared` | Club-settings listener exists but does not expose this field. | Extend the settings model only if a current UI depends on it. |
| `clubSettings` | `/clubSettings/default` | Listener exists. | Retain; avoid adding unrelated live results to this global settings document. |
| `seriesStandings` | Computed from season competitions and results; no dedicated canonical document. | Public settings changes can trigger a reload, but result changes do not. | Publish a small season standings summary or recompute from live result sources; prefer a summary document to avoid subscribing every portal to every competition. |
| `competitionsList` | `/competitions` and IDs listed in `/clubSettings/default` | Public summary listener exists. | Retain the current summary listener; keep it separate from per-competition result listeners. |
| `competition` | `/competitions/{competitionId}` | Metadata listener exists. | Extend its mapped fields as needed; derive effective status locally from stored metadata and the competition clock. |
| `courses` | `/competitions/{competitionId}/courses` | Listener exists. | Retain where the view needs course metadata. |
| `classes` | `/competitions/{competitionId}/classes` | Listener exists. | Retain; Public Portal may use the selected-class query for results. |
| `stations` | `/competitions/{competitionId}/stations` | Staff configuration is loaded through existing paths; public control labels come from `publicMetadata/summary`. | Do not grant public reads to raw station documents. A dedicated station listener remains a separate staff synchronization gap. |
| `competitors` | `/competitions/{competitionId}/competitors` | Phase 1 extends the existing `onSnapshot` listener to map status, start/finish times, readout data, and other competitor fields into App state. | Keep this as the single active-competition competitor listener. Preserve local-only fields where the Firestore document does not contain them. |
| Radio splits / punch passage data | `/competitions/{competitionId}/stationPunches` | Phase 1 adds a listener filtered to `RADIO` and `PREWARNING` for Admin, Readout, and Forest roles. | Keep the query limited to actual radio/prewarning punches, matched to both competitor ID and SI number. Never expose raw punch documents to public listeners. |
| `runnerDb` | `/runnerDb` | Listener exists for signed-in users. | Retain; it is not part of the public result stream. |
| `emergency` | Competition document fields such as `brokenControls` and `controlTimeOffsets`. | Phase 1 extends the existing competition metadata callback to publish emergency fields. | Keep this on the existing document listener; avoid a second listener on the same document. |
| `eventor` | Server-side integration state; no current Firestore state document. | No listener. | Keep integration status on its existing API/action path. Do not copy credentials or secrets to Firestore. |
| `roc` | Server/event runtime integration state; no current Firestore state document. | No listener. | Keep on its API/action path unless a separate, explicit persistence requirement is approved. |
| `events` | Bounded in-memory event feed (`ev.events`); not in the cloud season snapshot. Some punch records overlap with `stationPunches`. | No Firestore listener. | If the Readout activity feed must remain cross-client, persist a bounded event feed; station punches alone do not reproduce all event types. |
| `connectedMonitors` | Derived from the in-process WebSocket client set. | No Firestore source. | Treat as a separate presence feature or intentionally remove it. Firestore leases/heartbeats would be approximate, not an exact socket count. |

`PublicRacePayload` additionally includes `radioControls`, emergency data,
competition summaries, and series standings. It remains a bootstrap path;
selected-event result and radio-control changes are now delivered by the
competition-scoped Firestore projections. The payload's `events` field is not
currently rendered by `PublicPortalView`.

## Listener and query design

All competition subscriptions must be scoped to the currently selected
`competitionId`, and must be unsubscribed when that ID or the user's
authorization changes.

| Consumer/data | Proposed source and query | Listener behavior |
|---|---|---|
| Secretariat competitors | `competitions/{competitionId}/competitors` collection; all competitors for the event. A class filter may be applied only when the screen truly needs one class. | Reuse the current rental-return listener and parse the full competitor document. Apply changed documents to the active App state while preserving unrelated local-only fields. |
| Secretariat radio passages | `competitions/{competitionId}/stationPunches`, filtered to `stationFunction in ['RADIO', 'PREWARNING']`. | Listen to actual punch documents and rebuild/merge radio splits. Use station configuration to interpret active controls. No predicted times or ranking values are persisted. |
| Competition and emergency metadata | `competitions/{competitionId}` document. | Extend the existing metadata callback to publish the emergency fields required by the UI. |
| Classes/courses | Existing `classes` and `courses` subcollections. | Keep the existing listeners; use their updates to refresh the affected view without reloading the full season. |
| Staff station configuration | `competitions/{competitionId}/stations` collection. | Add an `onSnapshot` listener for authorized staff. Speaker access needs an explicit rule or a narrower speaker projection; current rules do not allow Speaker to list station documents. |
| Public result rows | Proposed `competitions/{competitionId}/publicResults/{competitorId}` documents, queried by `classId` when a class is selected. | Subscribe only to the selected event/class. One document per competitor limits update fanout and avoids rewriting one large event document. |
| Public control/competition metadata | Proposed `competitions/{competitionId}/publicMetadata/summary` document, alongside existing public class/course documents. | Include only fields the portal needs, such as competition display metadata and active radio-control labels. Do not grant public access to the raw station collection to enable this view. |
| Public series standings | Proposed single season-level public summary document (for example, `/publicSeason/standings`). | Update when validated result inputs change; subscribe once per portal session, not once per race. |
| Secretariat activity feed | Proposed `competitions/{competitionId}/liveEvents/{eventId}`, ordered by timestamp descending and bounded to the latest 250 entries. | Add only if cross-client Readout activity history is a required behavior. Persist the event kinds the current feed displays; do not assume station punches cover manual, readout, or operational events. |

The selected-competition listener's initial Firestore snapshot should be treated
as authoritative once it arrives. While it is pending, the UI may retain its
last/API-loaded snapshot, but should not let a late response for a previous
competition overwrite the newly selected event.

## Firestore rules and data safety

Raw competitor reads are now limited to verified staff roles because
competitor documents can contain SI-card identity and readout data. Public
clients must subscribe only to the restricted result projection, not the raw
competitor collection.

Rules allow only Admin, Readout, and Forest roles to list `stationPunches`,
which contain SI identity and raw hex. Speaker receives actual radio splits
from `publicResults` instead; public control metadata is exposed only through
`publicMetadata/summary`.

Firestore rules cannot redact selected fields from a readable document. Do not
grant public reads to raw competitor, station, or station-punch documents to
make subscriptions work.

The public result projection should contain only display-safe actual data
(identity/club/class, status, official finish result, and actual radio
passages). It must exclude SI numbers, raw card bytes, internal validation
details, and operational integration state. Its writes must be tied to the
canonical validated-result/punch write paths. It must not store live placing,
effective status, or projected passage/finish times.

Use Firestore rules emulator tests for:

- Public reads of the public result projection and metadata.
- Rejection of public reads of raw competitors, station punches, and stations
  after cutover.
- Authorized staff/Speaker reads and unauthorized role rejection.
- Writes that keep canonical results and public result documents consistent.

## Implementation phases

### Phase 1 — Live competitors and results

1. Establish the Firestore competitor collection as the shared source for
   active-competition status, start/finish times, validated readout fields,
   ordinary controls, and other existing competitor data.
2. Extend the existing competitor `onSnapshot` subscription, which currently
   applies only rental-return fields. Avoid adding a second listener for the
   same competitor collection.
3. Add a selected-competition listener for radio/prewarning `stationPunches`.
   Combine its actual punches with competitor documents and station metadata
   to update radio splits. Handle initial snapshots and subsequent changes
   without dropping locally maintained data.
4. Extend the existing competition metadata listener for emergency fields.
   Keep the existing class/course listeners and selected competition context.
5. Audit each live write path (online punches, manual finish, SI readout, and
   validation) to confirm the authoritative Firestore document is updated
   promptly. Listener behavior cannot be more reliable than these writes.
6. Preserve current ranking behavior: calculate effective status, Plac, sort
   order, and any visible projection in the client only. Do not write these
   derived values to Firestore.
7. Remove Secretariat's dependency on `state:sync` for the data delivered by
   this phase only after independent-client updates are verified.

**Exit criteria:** A change from a second authorized client updates active
Secretariat results without a WebSocket; stored status and validation remain
unchanged by the listener; changing competitions stops old listeners.

### Phase 2 — Speaker and Public Portal result updates (implemented)

1. Feed `SpeakerResultsView` from the same live competitor/result state used
   by Secretariat. Do not add a separate Speaker result-ranking engine.
2. Populate the public-safe per-competitor result projection from the
   canonical actual result writes. Include actual radio passages, never live
   projected values or SI-card internals.
3. Publish safe competition/control metadata and subscribe by selected
   competition and class. Keep API/one-shot loading for bootstrap only.
4. Restrict raw competitor reads to verified staff and test public access to
   projections versus raw competitors, stations, and station punches.
5. Retain the public competition-summary listener; do not subscribe each
   public viewer to every competition's raw results.

**Exit criteria:** Speaker and two public clients receive actual result
updates through Firestore; public views read no SI/card internals; changing
competition/class detaches the previous result listener.

### Phase 3 — Remaining operational synchronization

1. Decide whether the Readout activity feed must update across clients; if so,
   add bounded `liveEvents` documents for the displayed event types.
2. Publish a season-level `publicSeason/standings` projection if series
   standings must remain available when the API bootstrap is unavailable.
3. Decide the disposition of `connectedMonitors`; Firestore leases/heartbeats
   are approximate and separate from result synchronization.
4. Retain existing API/action paths for `eventor`, `roc`, and other non-result
   state until an explicit replacement is implemented.

## Read-cost estimate

Firestore bills initial query snapshots by documents returned and listener
updates by documents changed and delivered to each active listener. Reconnects
may cause a fresh snapshot, depending on how long the client was disconnected.
Use these variables for event-specific estimates:

- `N`: competitors in the selected event/class.
- `P`: matching radio/prewarning punch documents retained for the event.
- `S`: active station metadata documents.
- `Vstaff` / `Vpublic`: simultaneous staff / public listener clients.
- `Uc` / `Up`: competitor / public-result document changes.

Approximate listener reads, excluding metadata and retries:

```text
Staff initial reads  ~= Vstaff * (N + P + S)
Public initial reads ~= Vpublic * N
Staff update reads   ~= Vstaff * (changed competitor + punch documents)
Public update reads  ~= Vpublic * Up
```

The current competitor listener already reads the competitor collection for
rental-return updates. Reusing it for complete competitor data avoids a
second `N`-document listener snapshot per staff client. The additional Phase 1
initial read is primarily `P` punch documents per staff client.

Illustrative race: 100 competitors, 200 matching radio/prewarning punch
documents, 4 staff clients, and 100 public clients:

- Staff initial result/punch reads: about `4 * (100 + 200) = 1,200`
  documents, before station/metadata reads. Of these, the 400 competitor
  snapshots are already associated with the existing rental listener.
- Public initial result reads: about `100 * 100 = 10,000` public projection
  documents if every viewer watches the whole event; selecting one class
  reduces this to that class's competitor count.
- 100 public result-document changes delivered to all 100 viewers add about
  `100 * 100 = 10,000` document reads.

These are read units, not a dollar quote. The database region, pricing tier,
free-tier usage, concurrency, and reconnect pattern are not established here;
calculate currency cost using the project's current Firestore rate and actual
event metrics. Large `P` values or spectator audiences can dominate cost.
Monitor initial snapshot size, changed-document fanout, concurrent listeners,
and reconnect reads. If punch history grows substantially, consider a
canonical per-competitor live-passage document instead of replaying every
historical punch into every staff listener.

## Scalability, consistency, and cutover

- Subscribe only to the selected competition; apply a class filter for views
  that do not need the full event. Do not install a global listener for every
  competitor in every competition.
- Keep public results as one document per competitor rather than one large
  document per event. This limits write contention and only notifies listeners
  for changed runners.
- Use transaction/batch boundaries already used by the canonical punch and
  readout write paths when updating related actual-result documents.
- Reconstruct state idempotently from document IDs and actual event values;
  tolerate duplicate listener delivery and reconnect snapshots.
- Make listener errors visible and retain a clear stale/offline indicator;
  do not silently present an old snapshot as live.
- Do not remove all WebSocket code merely because Phase 1 is complete. The
  `eventor`, `roc`, event feed, and monitor-count fields have no equivalent
  Firestore source. Keep their existing API/action path or explicitly decide
  they are out of scope before removing the corresponding `state:sync`
  dependency.
- Keep REST/API actions for mutations and initial bootstrap where needed;
  Firestore listeners replace ongoing synchronization, not the action API.

## Overall acceptance criteria

- Secretariat receives cross-client competitor status, actual passage, finish,
  and validated readout changes from the selected competition.
- Speaker uses the same up-to-date result state and an explicitly authorized
  station/result data source.
- Public Portal listens only to public-safe result and metadata documents.
- Switching the selected competition/class releases old listeners.
- Live ranking, effective status, and projected times remain derived and are
  never written to Firestore.
- Bom continues to use only validated SI readout data.
- The non-result fields in the current WebSocket payload have an explicit
  retained source or an explicit removal decision before the socket dependency
  is retired.
