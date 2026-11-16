# Class Draw 404 Analysis

## Finding

The reported `HTTP 404: Klassen hittades ej` is produced by the Express route
`POST /api/draw/class`, not by a Firestore document lookup. The route searches
the classes in its in-memory active event and returns 404 when no class has the
requested `id`.

The exact runtime `classId` and competition are not present in the report or
available request logs, so the particular mismatch cannot be proven from the
current evidence. A code-level stale-selection defect can send an old class ID
after the competition changes. The API also omits `competitionId` and chooses
its own active event, which can disagree with the competition selected in the
browser.

## Resolution

Both identified fixes have been implemented. See
[CLASS_DRAW_404_FIX.md](./CLASS_DRAW_404_FIX.md) for the code changes and
verification results.

## Workflow

1. **Action and identifier — `src/components/DrawView.tsx:50,78-86`**
   - The draw form submits `drawClassId` as `classId`.
   - It is initialized once from `classes[0]?.id`. There is no effect to update
     it when the `classes` prop changes.
   - `selectedClass` falls back to `classes[0]` if the stored ID is no longer
     in the current list, but the submit handler still sends the stale
     `drawClassId`.
   - The component is rendered from `App.tsx:4355-4360` without a competition
     key. If the user changes competition while remaining on the Draw tab,
     React can preserve the component state and its previous competition's
     `drawClassId`.

2. **Request — `src/App.tsx:4360-4366`**
   - The browser posts the DrawView parameters to `/api/draw/class`.
   - Request body shape:
     ```json
     {
       "classId": "<drawClassId>",
       "mode": "INTERVAL | MASS | FREE",
       "firstStartClock": "<clock string>",
       "intervalSec": 120,
       "vacancies": 2,
       "clubSeparation": true,
       "includeAlreadyStarted": false
     }
     ```
   - `classId` is the only field needed to identify a class; the route provides
     defaults for the other draw options.
   - **`competitionId` is not sent.** The exact `classId` in the failed
     request is unknown because no request payload or runtime log was
     provided.

3. **Handler and lookup — `server.ts:4241-4264`**
   - The handler calls `getActiveEvent()` and searches
     `db.classes.find(c => c.id === classId)`.
   - `getActiveEvent()` uses the server's `seasonDb.activeEventId`, falling
     back to the first event (`server.ts:2132-2137`).
   - If the lookup misses, the handler returns
     `{ "error": "Klassen hittades ej." }` with status 404. This is an
     intentional response, not a thrown exception; therefore there is no
     exception stack trace for this failure.

4. **Response and fallback — `src/App.tsx:4377-4387`**
   - `readApiResponseJson` converts the error response to `HTTP 404: Klassen
     hittades ej`.
   - The catch block only uses the Firestore draw fallback for network errors,
     HTTP 5xx, or API initialization failures. A 404 is rethrown, so
     `saveClassStartDrawToFirestore` is not called for this reported response.

## IDs and Firestore

- The client sends the internal class ID (`cls.id`), not `eventorClassId`.
  Firestore class loading maps the internal ID from `classId || document.id`
  and retains `eventorClassId` as a separate optional field
  (`src/firebase.ts:2646-2664`). The Express route compares only `c.id`.
- Consequently, the inspected draw path does not use Eventor identity. There
  is no evidence of an Eventor identity regression causing this response.
- If the existing Firestore fallback were reached, it would read the class at
  `competitions/{activeEventId}/classes/{sanitizeFirestoreId(classId, 'cls')}`
  and competitors from that competition's `competitors` collection
  (`src/firebase.ts:4275-4313`). The class document is checked before writes.
- **Firestore existence is unverified.** The runtime `competitionId` and
  `classId` are unknown, and the failing 404 occurs before the client invokes
  the Firestore fallback. There is no basis to claim that the Firestore
  document is missing.

## Likely cause and classification

**Classification: D — Routing/API context error (most supported).**

The handler uses the server's active event rather than the competition
selected by the client. A stale in-memory event or class list can therefore
produce this 404 even when the class exists in the selected competition's
Firestore data.

There is also a concrete client-side way to send the wrong identifier:
`DrawView` retains its initial class ID when its `classes` prop changes. If a
user changes competitions while the Draw view stays mounted, the old ID can be
submitted. This is consistent with **A — wrong identifier**, but cannot be
confirmed as the incident's exact cause without the failed request payload.

On Vercel, the mismatch risk is higher: `loadSeasonDatabase()` starts from a
seed (`server.ts:1830-1833`), while cloud hydration updates in-memory state.
Serverless instances do not provide a durable shared in-memory database, so
the draw invocation may not have the same hydrated event/class state as the
request that hydrated it.

## Minimal fix

1. **Prevent stale client IDs:** when `classes` changes, reset
   `drawClassId` if it is not present in the new list; also reject submission
   unless the ID matches a current class. Alternatively, key `DrawView` by the
   selected competition so it remounts on competition changes.
2. **Make the route competition-specific:** include the selected
   `competitionId` in the draw request and resolve that event on the server
   instead of relying on `getActiveEvent()`.
3. For deployments where the in-memory mirror may be missing a class, use the
   existing Firestore path as a validated fallback for this specific
   class-not-found response. Do not treat every 404 as a successful fallback;
   preserve Firestore's explicit missing-class error.

The smallest immediate correction for the confirmed client defect is item 1.
Items 2-3 address the independent API/deployment context mismatch.
