# Manual Finish Deployment Fix

## Root cause

Vercel failed while loading its generated API entrypoint, before dispatching
any request to Express. `api/index.ts` imported `../server` without an
extension. Vercel's generated `/var/task/api/index.js` therefore caused Node
ESM to resolve `/var/task/server`, which did not exist. The repository build
only ran Vite and emitted the client bundle; it did not build the root
`server.ts` module for the function runtime.

The reported `ERR_MODULE_NOT_FOUND` was a module resolution failure, not a
manual-finish handler or Firestore error.

## Fix

- `api/index.ts` now imports `../server.js`, the exact runtime artifact name.
- `package.json` now builds `server.ts` into a root `server.js` using the
  already-installed esbuild dependency. Local TypeScript modules are bundled;
  Node/package dependencies remain external.
- The production `build` script runs this backend bundle step before the
  existing Vite client build.
- `.gitignore` excludes the generated root `server.js`. Vercel generates it
  during the build; it is not checked in as source.
- `vercel.json` routing was not changed. Its API rewrite was already directed
  at the correct `/api` entrypoint.

The runtime path is now:

```text
/var/task/api/index.js
  imports ../server.js
  resolves to /var/task/server.js
```

The decision is therefore a build-output and server-bundling fix, together
with an explicit `.js` import. Changing only the import extension would fail
while `server.js` is absent; changing only the build without the import would
leave Node requesting the extensionless `/var/task/server`.

## Build output

`npm run build` emits:

- `server.js` at the project root: bundled server application and local
  TypeScript modules.
- `dist/`: the existing Vite production client output.

The Vercel function entrypoint remains the generated
`/var/task/api/index.js`. Its relative static import now names a JavaScript
artifact produced by the deployment build.

## Verification

- `npm run build` — passed; esbuild generated root `server.js` (about 242 KB)
  and Vite generated the production client output.
- `npm run lint` (`tsc --noEmit`) — passed with the explicit `.js` import.
- Local Vercel-mode smoke test — imported `api/index.ts` and the generated
  `server.js`, confirmed the POST manual-finish route is mounted, and sent a
  POST to `/api/emergency/manual-finish`. It returned the expected `401`
  authentication response instead of a module-load `500`; no data was
  mutated.
- The smoke test ran with `VERCEL=1`, so it did not start the local development
  server or write the local season database.

The actual hosted Vercel artifact was not redeployed or inspected in this
workspace. The production build and local function-entry smoke test validate
the module graph, but a deployment is still required to verify the hosted
function package.

## Files changed

- `api/index.ts`
- `package.json`
- `.gitignore`
- `MANUAL_FINISH_DEPLOYMENT_ROOT_CAUSE.md` (marked resolved)
- `MANUAL_FINISH_DEPLOYMENT_FIX.md`

## Deployment impact

The previous missing import affected every Express-backed endpoint routed to
the shared `/api` function, not only manual finish. The fix restores the
shared function's server module. `/api/eventor` remains separately routed and
was not affected by this specific import failure.

No Firestore rules, manual-finish mutation behavior, or route authorization
logic was changed.
