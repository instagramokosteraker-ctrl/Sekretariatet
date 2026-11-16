# Manual Finish Deployment Root Cause

> Status: Resolved in the current source. `api/index.ts` now imports the
> generated `server.js`, and `npm run build` emits that bundled backend
> artifact. See `MANUAL_FINISH_DEPLOYMENT_FIX.md` for the fix and validation.

## Conclusion

The reported manual-finish request failed before Express dispatched it to the route. The
deployed API entrypoint imports a backend module using an extensionless ESM
specifier, but that module is not present at the exact runtime path Vercel
tries to load.

The runtime error supplied for the invocation is:

```text
Error [ERR_MODULE_NOT_FOUND]:
Cannot find module '/var/task/server'
imported from /var/task/api/index.js
```

This is a deployment/module-resolution failure, not a Firestore transaction
failure. No manual-finish handler code runs and no Firestore path is accessed
by this failing invocation.

## Request path

1. `vercel.json` rewrites `/api/emergency/manual-finish` to `/api`.
2. Vercel invokes the generated function at `/var/task/api/index.js`.
3. Before the exported handler can run, Node resolves its static imports.
4. The generated module retains the import from `api/index.ts`:

   ```ts
   import { app } from '../server';
   ```

5. Relative to `/var/task/api/index.js`, Node attempts to load exactly
   `/var/task/server`. Resolution fails with `ERR_MODULE_NOT_FOUND`.
6. Consequently, the Express middleware and
   `POST /api/emergency/manual-finish` handler in `server.ts` are never
   reached.

The source handler would otherwise expect `{ competitorId, finishClockStr }`.
The UI sends both fields from `src/App.tsx`; these payload fields are not the
cause of this startup failure.

## Source, build and runtime paths

| Item | Path and behavior |
|---|---|
| API source entrypoint | `api/index.ts` |
| Failing source import | `api/index.ts:2` — `import { app } from '../server';` |
| Backend source | Root `server.ts`; there is no checked-in root `server.js`. |
| Repository build | `npm run build` runs `vite build` and emits the client bundle in `dist/`; it does not compile `server.ts` to `server.js`. |
| TypeScript configuration | `tsconfig.json` uses `moduleResolution: "bundler"` and `noEmit: true`; it does not emit a runtime backend module. |
| Vercel entrypoint | Generated `/var/task/api/index.js`. |
| Failing runtime target | `/var/task/server` (no extension), as reported by Node. |
| Runtime module needed by the current import | An actual module resolvable as `/var/task/server`, or a bundled `app` dependency that removes this external import. |

With the project's `"type": "module"`, Node's ESM resolver does not infer
`.js` or `.ts` for the extensionless relative import. Even if a build emitted
`/var/task/server.js`, the current specifier would still need to be rewritten
or bundled so Node requests that path.

## Classification

- **A. Wrong import statement:** Yes, for the deployed ESM runtime. The
  extensionless `../server` import does not identify a resolvable emitted
  module.
- **B. Build artifact not emitted:** The repository's configured
  `npm run build` does not emit root `server.js`; it emits the Vite client
  output. Whether a separate Vercel build step emitted `/var/task/server.js`
  cannot be determined from the error alone. Even if it did, the current
  extensionless ESM import would still request `/var/task/server`.
- **C. Vercel configuration problem:** Not the rewrite itself. It correctly
  directs this API path to `/api`. However, the current configuration does not
  establish a backend bundle or a matching root server artifact.
- **D. TypeScript output mismatch:** Yes. `api/index.ts` is deployed as
  JavaScript, while the imported `server.ts` is not emitted by the configured
  TypeScript build (`noEmit: true`).
- **E. Path/extension mismatch:** Yes. The runtime requests `/var/task/server`;
  the repository contains `server.ts`, and no `server.js` is emitted by the
  project build.

## Firestore and transaction trace

There is no service or Firestore transaction in the failing path. The current
`server.ts` manual-finish route is a legacy Express handler that mutates its
in-memory event state. The UI's fallback path calls
`updateCompetitorInFirestore()`, which performs a client Firestore transaction,
but that fallback is only considered after an HTTP 404/405 (or a fetch
`TypeError`). The module-load failure is returned as a 500, so the UI does not
enter that fallback.

Because module loading fails before route execution, there is no Firestore
document path and no transaction read/write to report for this invocation.

## Minimal fix

Make the backend application a runtime-resolvable part of the Vercel function:

- Prefer bundling `server.ts` and its local TypeScript dependency graph into
  the `/api` function so `api/index.js` does not import an absent root module;
  or
- Emit a complete Node-resolvable backend build at the path expected by the
  function, and update the import to its explicit emitted filename (for
  example `../server.js`). The build must also emit or bundle the backend's
  transitive imports; changing only the extension is insufficient when
  `server.js` does not exist.

Verify the resulting Vercel function artifact contains the chosen bundle or
module before deployment. Do not treat the Vite `dist/` client output as the
backend artifact.

## Endpoint impact

All paths matching the general `/api/:path(...)` rewrite are affected because
they load the same `/api` function and fail while importing `server`. This
includes `/api/health`, auth and Express API routes, not only manual finish.
`/api/eventor` is excluded by the rewrite and has its own `api/eventor.ts`
function, so it is not affected by this specific import failure. Static client
assets are also separate from the failing API function.

## Local reproduction

The repository has `server.ts` but no root `server.js`. Running the equivalent
extensionless ESM import locally:

```sh
node --input-type=module -e "import('./server')"
```

fails with `ERR_MODULE_NOT_FOUND`, reproducing the import-resolution failure.
