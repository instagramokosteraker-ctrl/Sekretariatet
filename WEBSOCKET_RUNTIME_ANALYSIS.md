# WebSocket Runtime Analysis

**Investigation date:** 2026-11-16  
**Endpoint:** `wss://sekretariatet.vercel.app/api/ws`

## Conclusion

**Classification: C — unsupported WebSocket implementation on this deployment.**

Vercel supports WebSockets in Node.js Functions, but this project does not expose
its WebSocket-capable `http.Server` as the Vercel Function. Instead, Vercel
rewrites `/api/ws` to the ordinary Express Function at `/api`, whose default
export calls `app(req, res)`. The `upgrade` listener is attached to a separate
server object that is never listened on or exported when `VERCEL` is set.

The endpoint is therefore present and used in the standalone server, but is not
working as a WebSocket endpoint on the current Vercel deployment. This is an
integration/configuration defect, not a general lack of Vercel WebSocket
support. It is not dead code.

## Request trace

```text
Browser WebSocket client
  -> wss://sekretariatet.vercel.app/api/ws[?token=...]
  -> vercel.json rewrite: /api/:path... -> /api
  -> api/index.ts default handler
  -> Express app(req, res)
  -> /api authentication middleware

Standalone-server path only:
  server.ts startServer()
  -> http.createServer(app)
  -> server.on('upgrade')
  -> pathname === '/api/ws'
  -> wss.handleUpgrade(...)
  -> wss 'connection' handler
```

### Source locations

- **Client URLs**
  - Secretariat: `src/App.tsx`, WebSocket URL includes `?token=...`.
  - Public portal: `src/components/PublicPortalView.tsx`, connects to `/api/ws`
    without a token.
- **Vercel route/entrypoint:** `vercel.json` rewrites non-Eventor `/api/*`
  requests to `/api`; `api/index.ts` imports `app` from `../server.js` and
  exports an Express request handler.
- **Server and upgrade implementation:** `server.ts` creates
  `new WebSocketServer({ noServer: true })` and attaches `server.on('upgrade')`
  for `/api/ws`.
- **Connection behavior:** `server.ts` reads the `token` query parameter only
  inside the WebSocket `connection` callback. Authenticated clients receive
  `state:sync`; unauthenticated clients receive `public:ping`.
- **Deployment target:** the supplied host and `vercel.json` identify Vercel.
  `package.json` builds a root `server.js` bundle, but that bundle exports the
  Express `app`, not the locally created HTTP server.

## Does `/api/ws` exist?

The WebSocket implementation exists in `server.ts` and is reachable when the
standalone Node server listens. It is not a dedicated Vercel function route:
there is no `api/ws.ts`, and `api/index.ts` contains no WebSocket upgrade
handling or `/api/ws` Express route.

On Vercel, `startServer()` still creates the local HTTP server and attaches the
upgrade listener, but `server.listen(...)` is explicitly skipped when
`process.env.VERCEL` is set. The local server is not exported from
`server.ts` or `api/index.ts`. The Vercel handler invokes only the Express app.
Consequently, a Vercel WebSocket upgrade cannot reach this `server.on('upgrade')`
listener or its `wss.handleUpgrade()` call.

## Authorization behavior and observed response

The Express middleware gates `/api/*` requests before ordinary route handling.
It calls `getRequestSessionUser()`, which reads `x-passersi-token` or the
`Authorization` header. It does not read the WebSocket token query parameter.
The middleware also does not exempt `/ws` or `/api/ws`.

The standalone-server upgrade path bypasses this Express middleware and checks
the query token only after a connection is established. That is why public
WebSocket clients are allowed in the standalone server, but are rejected when
the same request is dispatched as an ordinary Vercel Function request.

I made a non-mutating WebSocket handshake to the deployed URL without a token.
It did **not** return the reported 500. The observed response was:

```text
HTTP status: 401
Server: Vercel
X-Powered-By: Express
X-Vercel-ID: arn1::iad1::29b5s-1794851071392-6930a3d32f13
Body: {"error":"Inloggning krävs för sekretariatet."}
```

This confirms that this probe reached the Express Function and was rejected by
its API authentication middleware before any WebSocket upgrade took place. A
Secretariat client also sends its token in the query string, not in either
header read by that middleware, so the current Vercel Express path cannot
authenticate it through that middleware either.

## Reported 500 and stack trace

The browser-reported `500 Internal Server Error` was not reproduced by the
unauthenticated probe above. The available repository code does not log a
WebSocket exception for the observed 401: this is an intentional middleware
response, not a thrown exception, so there is no stack trace for it.

The first source-level failure for the Vercel path is that the rewritten
request is dispatched to `app(req, res)` rather than to an exported WebSocket
server. For the captured anonymous request, the first concrete failing
operation is the API auth middleware's missing-header-token check, which
returns 401. The request never reaches `server.on('upgrade')`.

The exact exception and stack for the user's reported 500 cannot be established
from this workspace. The Vercel CLI is unavailable, no deployment log was
provided, and the live probe produced a different status. The 500 could arise
in the Vercel upgrade/function boundary or from a deployed version/configuration
that differs from this checkout; attributing it to a particular thrown
exception without the corresponding Vercel invocation log would be speculative.

## Vercel support and deployment compatibility

Vercel's current documentation says WebSockets are supported on Vercel
Functions. Its Node.js examples use `ws`, create an HTTP server, attach the
WebSocket server, and **export the HTTP server as the function's default
export**. WebSockets require Fluid Compute; Vercel says it is enabled by
default for projects created on or after 2025-04-23. The setting for this
specific project was not inspectable from the workspace.

The current deployment shape does not match that documented Node.js setup:

| Requirement/behavior | Current project |
|---|---|
| Vercel supports WebSockets | Yes, on Functions with Fluid Compute |
| WebSocket-capable HTTP server exported by the function | No |
| Upgrade listener connected to Vercel's function server | No; attached to a local server that is never listened on or exported |
| `/api/ws` routed to a WebSocket server function | No; rewrite targets the shared `/api` Express handler |
| Token accepted by Express API middleware | No; client sends query token, middleware reads headers |

Therefore the implementation is incompatible with the current Vercel
entrypoint, even though Vercel itself supports the protocol. The active
deployment is broken for this endpoint. The exact Vercel project Fluid Compute
setting remains unverified.

There is an additional scaling concern independent of the failed handshake:
the current broadcaster iterates only over the in-memory `wss.clients` set,
and state is held in the in-memory `seasonDb`. Vercel can place different
connections and requests on different Function instances. Vercel's guidance
calls for external state/pub-sub coordination when state must be shared between
instances. Exporting a server alone would not prove cross-instance broadcast
correctness.

## User-visible and performance impact

- **Public portal:** it relies on `public:ping` WebSocket messages to call
  `loadData()` again. The race page has no periodic polling in this component,
  so after its initial load it can remain stale until a manual reload or
  navigation.
- **Secretariat:** it relies on authenticated `state:sync` messages and shows
  `Synkar` while `wsConnected` is false. Initial HTTP/Firestore hydration and
  Firestore listeners provide partial fallback behavior, but they do not
  replace every WebSocket-driven state update.
- **Retry traffic:** Secretariat retries every 2.5 seconds and the public view
  every 3 seconds after close: approximately 24 or 20 failed handshakes per
  open tab per minute. This adds Function invocations/request and error-log
  volume; with multiple open tabs, it scales linearly. Each failed request is
  short-lived, so per-request compute is likely modest, but sustained retry
  traffic is avoidable.
- **Urgency:** high during live events because public results may stop
  refreshing and Secretariat reports a disconnected/syncing state; moderate
  outside race operations. No data-loss behavior was identified in this
  investigation.

## Required runtime evidence to identify the reported 500

Retrieve the Vercel Function log for the exact failed upgrade invocation,
including its request ID and timestamp. Confirm whether the log reports a
Function invocation exception, an upgrade rejection, or a routing/runtime
error. Also confirm whether Fluid Compute is enabled for the deployed project.
Those details are necessary to name the exact server-side 500 exception and
stack; neither is available from the source checkout or the captured 401 probe.

## References

- Vercel, [WebSockets](https://vercel.com/docs/functions/websockets), updated
  2026-08-10; accessed 2026-11-16.
- Vercel, [WebSocket support is now in Public Beta](https://vercel.com/changelog/websocket-support-is-now-in-public-beta),
  published 2026-06-22; accessed 2026-11-16.
