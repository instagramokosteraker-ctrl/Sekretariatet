# Live Synchronization Architecture Decision

**Decision date:** 2026-11-16  
**Decision:** **Use Firestore listeners** for live client synchronization.

## Context

The current WebSocket route is not attached to the Vercel request server.
`server.ts` creates an `http.Server` and installs the `/api/ws` upgrade
listener, but does not listen on or export that server when running on
Vercel. [api/index.ts](./api/index.ts) exports the Express app as an ordinary
request handler, and [vercel.json](./vercel.json) rewrites `/api/*` to that
handler. The current authentication middleware also does not accept the
WebSocket query-string token. See
[WEBSOCKET_RUNTIME_ANALYSIS.md](./WEBSOCKET_RUNTIME_ANALYSIS.md).

The Secretariat and public portal both rely on socket messages for ongoing
updates. Current Firestore listeners cover some configuration and summary
data, but not the complete live competitor result state.

## Existing WebSocket dependencies

| View/function | Current dependency |
|---|---|
| **Secretariat synchronization** | `App` loads `/api/state` once (with a one-shot Firestore fallback), then consumes authenticated `state:sync` messages. The server sends a full state on connect and broadcasts it after many mutations. There is no general-state polling loop. |
| **Speaker view** | `SpeakerResultsView` does not open its own socket. It receives `competitors`, classes, courses, and stations from `App`; its cross-station/live updates therefore depend indirectly on Secretariat `state:sync`. |
| **Public portal** | The portal connects anonymously and calls `loadData()` when it receives a server `public:ping`. A socket close retries the connection but does not reload the data. There is no periodic event/results fetch loop. |

When the socket is unavailable, the initial snapshot and local actions can
still work, but separate clients do not receive ongoing changes through this
channel. Public results and Speaker/Secretariat views can consequently become
stale.

## Options compared

| Option | Implementation effort | Operational complexity | Reliability during live events | Scaling behavior | Cost |
|---|---|---|---|---|---|
| **A. Fix the current WebSocket implementation on Vercel** | **High** for a production fix. Routing/entrypoint and authentication must be corrected. Simply exporting or exposing the existing local server is insufficient because its `wss.clients` and `seasonDb` are instance-local. Cross-instance fanout and authoritative state need a shared pub/sub/state design or a managed realtime provider. | **High.** Requires connection lifecycle, token validation, reconnect behavior, shared fanout, monitoring, and deployment/runtime configuration. | **High only after** adding shared fanout and a durable shared source of state. A narrow upgrade-path fix leaves users connected to different function instances with incomplete broadcasts. | A single-instance `wss.clients` set does not fan out across Vercel instances. A broker/provider can scale horizontally, but adds another service and integration. | **Variable, likely medium-to-high.** Persistent concurrent connections and message fanout may incur provider/function costs; shared pub/sub is an additional service. Exact cost depends on concurrent clients and message volume. |
| **B. Replace WebSocket state delivery with Firestore listeners** | **Medium to high.** Secretariat/Speaker can subscribe to competition result data; public needs a deliberately public result projection and rules. Live status, passage, and finish writes must reach canonical Firestore reliably, rather than relying on a per-instance server mirror. | **Low to medium.** Firebase already exists in the app and manages listener reconnection. Work remains around listener lifecycle, query scope, Firestore rules, write consistency, and billing monitoring. | **High** when Firestore is the authoritative live state. Listeners reconnect and resume from shared persisted data; updates do not depend on which Vercel instance handled a request. | Firestore manages fanout across clients. Read delivery scales with listeners and changed documents, so broad subscriptions and many spectators can create read amplification. Subscribe only to the selected competition/class and keep public payloads small. | **Low-to-medium at club-scale, potentially high for large audiences.** Initial listener snapshots and each changed document are billed per client; reconnects can cause additional reads. Cost grows with viewers and result updates. |
| **C. Replace WebSocket with polling** | **Low initially.** Add periodic HTTP/Firestore reads to the existing clients and tune interval, timeout, visibility, and backoff behavior. | **Low to medium.** No persistent connection broker, but interval tuning, jitter, throttling, cache validation, and server capacity become ongoing concerns. | **Moderate.** A poll eventually recovers after temporary failures, but live data is delayed by the interval and a failed request can miss multiple intermediate states. Polling the current Vercel in-memory mirror would not solve its instance-consistency issue. | Request load is linear in clients and inverse to the polling interval. For example, 300 open tabs polling every 5 seconds generate about 60 requests/second before retries or other traffic. | **Low at small scale, potentially high at event scale.** Function invocations, response bandwidth, and underlying reads multiply with viewers and polling frequency. Longer intervals reduce cost but increase staleness. |

No exact cost estimate is possible without expected concurrent viewer counts,
result-update rates, region, and current Firebase/Vercel pricing configuration.

## Firestore feasibility and constraints

- The app already uses Firestore and has `onSnapshot` subscriptions for
  competition metadata, classes, courses, club settings, runner database,
  rental-return fields, and public competition summaries.
- These subscriptions do **not** currently deliver the full live competitor
  result state. A live-result subscription would be new.
- Current rules allow public reads of existing competition and competitor
  documents. A direct listener on the raw competitor collection is therefore
  technically possible, but those documents contain internal fields such as
  SI-card identity and readout data. The production public portal should use a
  limited public result projection and narrowly scoped read rules rather than
  expose raw competitor documents to every spectator.
- The Secretariat currently schedules full-season synchronization to Firestore
  with a debounce after state changes. A listener-based design should make
  live status, passage, and finish changes reach the shared source promptly
  and reliably; listener delivery cannot be stronger than the underlying
  write path.
- The app's current configuration listeners and Firestore writes remain
  useful, but they are not a substitute for a selected-event live-results
  subscription.

## Recommendation

**Use Firestore listeners.**

Firestore is already part of the production data path and provides shared,
durable state without depending on Vercel process affinity or an in-memory
WebSocket client set. It can update Secretariat and Speaker clients from the
same competition data, while the public portal can listen to a separately
published, read-only result projection. This is the best balance of reliability
and operational complexity for the current application.

The recommendation is conditional on treating Firestore as the authoritative
source for live result updates and limiting public listeners to an intentional
public data shape. Merely adding listeners to the current raw documents would
not be an acceptable public-data design.

### Why not the alternatives?

- **Keep WebSockets:** fixing only the handshake does not fix instance-local
  state and broadcast membership. A robust solution would require additional
  shared infrastructure and more operational ownership than the existing
  Firestore-based approach.
- **Use polling:** it is a viable fallback for low-frequency refreshes, but
  public result freshness either requires frequent reads and linear request
  growth or accepts visibly stale results. It also must read a durable shared
  source to avoid the Vercel in-memory-state problem.

This is an architecture decision only. No implementation changes were made.
