# WebSocket Dependency Audit

**Audit date:** 2026-11-16  
**Endpoint:** `/api/ws`

## Conclusion

**Classification: A — critical live-event functionality is broken when the
WebSocket is unavailable.**

The current Secretariat and public portal both use `/api/ws` to receive
cross-client change notifications. In the deployed Vercel configuration
described in [WEBSOCKET_RUNTIME_ANALYSIS.md](./WEBSOCKET_RUNTIME_ANALYSIS.md),
the endpoint does not complete a WebSocket upgrade. This means the app can
load an initial snapshot, but remote changes do not continue to arrive in
real time.

The impact is specifically on **live data freshness and cross-client
visibility**, not on the ability to persist every operation. The WebSocket
does not carry normal client write actions; those use HTTP/API and Firestore
operations. There is no evidence that losing the socket alone loses saved
data.

## Dependency inventory

### Secretariat client

In [App.tsx](./src/App.tsx#L1219):

- On session start, the client fetches `/api/state` once. If that request fails
  or is not successful, it performs a one-time full-season read from Firestore
  and initializes the app from that snapshot.
- It then connects to `/api/ws?token=...`. `state:sync` messages replace the
  current app snapshot through `applySnapshot`.
- On socket close, it marks the connection disconnected and retries after
  2.5 seconds. It does **not** refetch `/api/state` on each close or on a
  timer.
- The UI displays `Live (n)` when connected and `Synkar` otherwise. This
  connection indicator is additional UX impact, not the only impact.

The server sends `state:sync` on connection and broadcasts a full state after
many operations, including competitor, competition, course, and class changes
([server.ts](./server.ts#L2232), [server.ts](./server.ts#L2850)). Without the
socket, a different browser or Secretariat station will not receive these
updates through this channel. Its initial view can remain stale for statuses,
passages, finish times, and other server state until a separate reload or
navigation causes a new fetch.

### Public portal

In [PublicPortalView.tsx](./src/components/PublicPortalView.tsx#L360):

- The portal connects to `/api/ws` without a token.
- Any incoming message triggers `loadData()`, which refetches the selected
  public event/overview.
- On close, it retries after 3 seconds. The retry reconnects the socket; it
  does not call `loadData()`.
- There is no periodic public event/results polling timer.

Thus, a public race page can retain the result snapshot loaded on entry while
live results continue to change on the server. A manual reload or route change
causes another fetch.

### Server message use

- Authenticated sockets receive `state:sync` with the full app snapshot.
- Unauthenticated sockets receive `public:ping` with a changed short code;
  the public client treats any message as a cue to reload its data.
- Server mutations call `broadcastFullState()`, which sends these messages to
  connected clients ([server.ts](./server.ts#L2232-L2250)).
- The server accepts a `ping` message and replies `pong`, but neither current
  client sends this heartbeat. It is not a required application feature in
  the inspected client code.

The endpoint is therefore active, relied upon, and not dead code. The prior
runtime analysis found that the current Vercel request reaches the Express
handler rather than the WebSocket upgrade listener, and is rejected by API
authentication before the upgrade path. This makes both the tokenized
Secretariat connection and the public connection unavailable on that
deployment.

## Existing fallback coverage

| Area | Existing fallback/listener | Does it replace live result sync? |
|---|---|---|
| Secretariat initial state | One `/api/state` request; on failure, a one-time `loadFullSeasonFromFirestore()` read ([App.tsx](./src/App.tsx#L1231-L1245)) | No. It is initialization, not a reconnect refresh or live competitor subscription. |
| Secretariat settings and configuration | Firestore listeners for club settings, active competition ID, runner database, rental-return fields, courses, competition metadata, and classes ([App.tsx](./src/App.tsx#L671-L884)) | No. The competitor listener applies only `rentalReturned`; courses/classes/metadata do not subscribe to competitor results. |
| Public overview | Firestore subscription to public competition summaries | Partial. Competition list/count summaries can update, not the selected event's live result rows. |
| Public branding/series | Club-settings listener; it refreshes branding and reads season standings from Firestore | Partial. It does not subscribe the race page to live competitor times/statuses. |
| Public selected event | `loadData()` tries the public API and may fall back to a one-time Firestore read ([PublicPortalView.tsx](./src/components/PublicPortalView.tsx#L150-L240)) | No. The selected event data is not continuously subscribed or polled. |
| General state polling | No periodic `/api/state` or public-event/results fetch loop found | No polling fallback exists. |
| Socket reconnect | Retry after 2.5 seconds (Secretariat) or 3 seconds (public) | No. It retries the handshake, not the data request. |

Other periodic work is unrelated: the offline readout queue retries queued
operations, and a standalone-server ROC integration polls its external source.
The ROC poller broadcasts ingested changes over the WebSocket when it has
clients, but it does not refresh disconnected browsers. It also runs only
outside Vercel in the inspected server code.

## What breaks and what continues

**Breaks or degrades**

- Public race results, placing/status changes, and passage updates stop
  refreshing after the initial page load.
- Secretariat stations do not receive each other's full-state updates.
- The Secretariat connection indicator remains at `Synkar`; connected monitor
  counts and related live presence information cannot be relied on.
- A newly opened connection cannot receive the server's initial `state:sync`
  snapshot because the upgrade does not complete.

**Continues independently of the WebSocket**

- Initial HTTP/API or Firestore snapshot loading can still populate a page.
- Existing HTTP endpoints and direct Firestore writes remain separate from the
  WebSocket transport.
- Firestore listeners continue updating the settings/configuration fields
  listed above.
- Offline readout queue retries and the standalone ROC poller continue their
  own work; neither is a general live-state fallback for clients.

## Impact and urgency

| Rank | Assessment | Reason |
|---|---|---|
| **User impact: High (5/5 during an event)** | Critical freshness gap | Public viewers can see stale results; operators on separate stations can miss live changes and see a persistent syncing state. Impact is lower outside live operations. |
| **Performance impact: Medium (3/5)** | Repeated failed handshakes | Each open Secretariat tab retries about 24 times/minute; each public tab about 20 times/minute. Request volume and error logs scale with open tabs/viewers. These are failed connection attempts, not successful state-stream traffic. Existing Firestore listeners remain active independently. |
| **Urgency: High during live events; Moderate otherwise** | Operational visibility | The socket is the only inspected continuous cross-client state channel for live results. The impact is freshness/coordination rather than direct data loss. |

## Final assessment

The current implementation depends on `/api/ws` for live state propagation.
Firestore provides partial initialization and configuration updates, but no
continuous selected-event competitor-results subscription; there is no
general-state polling fallback. Therefore the feature is **not effectively
dead** and its unavailability is **more than reduced UX**: live results and
cross-station state can be stale during race operations.

This audit is analysis only; no implementation changes were made.
