# SeasonDb Retirement Plan

**Status:** Architecture and migration plan; no application-code changes.  
**Assessment date:** 2026-11-09  
**Purpose:** Describe what has moved to Firestore, what still depends on the Express `seasonDb`, and a staged path to retire JSON persistence, cloud snapshot synchronization, and eventually Express.

## 1. Executive summary

Firestore is already authoritative for club settings, the runner database, courses, classes, and competition metadata. `seasonDb` still carries compatibility mirrors for those areas, but they are no longer intended to own their canonical values.

The main operational state is not yet fully retired from `seasonDb`:

- Competitors and their current race state
- Readout history/processing and online-punch effects
- Live event feed and idempotency state
- Station configuration/runtime fields
- Emergency settings and time offsets
- ROC configuration, polling cursor, and status
- Eventor behavior/status fields that remain in the Express model

The server persists the full `SeasonDatabase` as JSON and serves WebSocket snapshots from that in-memory model. Firestore collections and transactional ingestion helpers exist for competitors, readout receipts, and station punches, but multiple Express mutations and snapshot-driven competitor synchronization remain. Consequently, the current architecture is a hybrid, not a fully Firestore-authoritative operational system.

**Recommended strategy:** continue with staged migrations under a shared operational-state design. Do not combine all domains into a single cutover. First prevent stale snapshots from writing canonical data; then finish competitor/readout ownership; migrate stations and emergency configuration; move ROC and Eventor server work to managed functions; replace WebSocket state distribution; finally remove JSON persistence and Express routes that no longer serve a purpose.

## 2. Current ownership

### 2.1 Firestore-authoritative areas

| Domain | Canonical Firestore data | Remaining `seasonDb` role |
|---|---|---|
| Club settings | `clubSettings/default`: active event, club name, branding, Eventor organization ID, default fees, series scoring and other migrated settings | Temporary mirror used by legacy Express routes, cloud snapshots, backups and some server-generated payloads |
| Runner database | `runnerDb/{siNumber}` | Temporary mirror for Express lookups, imports and server-side learning paths |
| Courses | `competitions/{id}/courses/{courseId}` | Temporary mirror for legacy Express routes, validation and import/export |
| Classes | `competitions/{id}/classes/{classId}` | Temporary mirror for legacy routes, entry/draw logic, validation and import/export |
| Competition metadata | `competitions/{id}` plus the club competition index | Temporary mirror for legacy routes and server-side processing |

These are authority migrations, not complete server removals. A Firestore-owned value can still appear in a JSON backup or WebSocket payload as long as that copy is treated only as a mirror and cannot overwrite the Firestore document.

### 2.2 Remaining `seasonDb`-owned or mixed areas

| Domain | Current owner/status | Firestore support and remaining issue |
|---|---|---|
| Competitors | Mostly Express-owned; only `feePaid` and `rentalReturned` are Firestore-authoritative in Phase 1 | Existing competitor documents and loading already include both flags. Client edits write those fields to Firestore before updating the Express mirror; rental/payment overview reads canonical flag values. Authenticated direct entries also write Firestore first and mirror the same ID to Express. Full-season sync/imports omit the flags when updating existing documents but seed them on new documents; snapshot deletion skips documents with Firestore-updated billing fields. Express still owns other competitor fields and operations, and unauthenticated direct entry remains legacy-first. |
| Readouts | Mixed; Express `/api/readout` mutates competitor state and stores `rawReadout` | `readoutReceipts` and a Firestore submission transaction exist and the offline queue uses it. The Express route remains; raw archive and result semantics are not yet unified. |
| Online punches | Mixed; Express punch processor remains for `/api/online-punch` and ROC | `stationPunches` and a Firestore transactional helper exist. The two paths have different effects, and legacy live events are not fully replaced. |
| Live events | `eventsMap[*].events` in Express/JSON | No equivalent canonical event-feed collection is established. WebSocket snapshots and UI use the Express feed. |
| Stations | Mixed; Firestore station CRUD/loading exists, but Express punch handling consumes `ev.stations` | Express punch/readout code updates `lastSeenAt` and may create stations automatically. Config and telemetry are mixed in station documents. |
| Emergency settings | Mixed; `ev.emergency` is read and written in Express | Competition documents contain emergency fields and Firestore recalculation exists, but Express routes and calculations remain. |
| Idempotency state | Mixed; `processedClientIds` in Express, plus Firestore receipts | Receipt IDs provide durable idempotency for Firestore paths. The old array remains needed by legacy routes. |
| ROC | Express-owned runtime | Express poller, cursor (`lastPunchId`), counters, last poll/error, and settings are in `ev.roc`. It uses the Express punch processor. |
| Eventor | Split | API key and core integration configuration are private Firestore data; Express still performs Eventor API calls/imports and retains some auto-create/status fields in `seasonDb.eventor`. |
| Admin compatibility config | Legacy Express/JSON data | Firestore roles are authoritative for access checks, but the Express admin-management compatibility model still stores `authConfig.admins` in `seasonDb`. |
| Season flags | Mixed/compatibility | `demoCleared` and legacy season state remain in JSON/snapshots; only the fields needed by current workflows should remain after the cutover. |

Competition documents also contain derived counts and emergency fields. Before removing snapshots, establish which fields are canonical inputs and which are recalculable projections; avoid treating an Express export as the owner of either category.

## 3. Current architecture

```text
                         ┌──────────────────────────┐
                         │ React / Vite clients     │
                         │ Admin, officials, public │
                         └────────────┬─────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 │                                         │
        Firestore listeners / writes              REST + WebSocket
        for migrated domains                      to Express
                 │                                         │
                 ▼                                         ▼
     Firestore canonical data                 Express server.ts
     clubSettings, runnerDb,                   ├─ reads/writes seasonDb
     courses, classes, competition             ├─ punch/readout routes
     metadata; partial competitors,            ├─ ROC poller
     readoutReceipts, stationPunches            ├─ Eventor API routes
                                                ├─ full state:sync
                                                └─ JSON persistence
                                                        │
                                                        ▼
                                             passersi-season-db.json

        cloud-export ── snapshot ──► full-season Firestore sync
        Firestore ── cloud-hydrate ──► Express in-memory seasonDb
```

The client also has a durable offline queue that submits readouts and online punches directly through Firestore helpers. That path is a foundation for migration, but it does not eliminate the Express routes or all dual-writer behavior.

## 4. JSON persistence dependencies

The server serializes the whole `SeasonDatabase` to `data/passersi-season-db.json` through `saveSeasonDatabase`/`persistUserMutation`. The file currently serves simultaneously as persistence, recovery source, and backing store for Express routes.

The strongest remaining dependencies are:

- `eventsMap` and its operational subrecords: competitors, stations, emergency settings, ROC state, live events, and processed client IDs.
- Server startup/seed/normalization and the active-event lookup.
- Express punch/readout, direct-entry, draw, manual-finish, import, rental, and emergency routes.
- Eventor club/event imports and runner-learning compatibility paths.
- JSON backup and restore, which serialize or replace broad portions of `SeasonDatabase`.
- Cloud export and hydrate, which convert between the Express event map and Firestore season data.
- WebSocket `state:sync`, which builds the authenticated client state from the active `seasonDb` event.

Removing JSON writes before these responsibilities are moved would lose accepted race changes on restart. The safe eventual destination is either canonical Firestore state plus derived caches, or a separately scoped explicitly requested backup/export—not an implicit mutable mirror of the whole application.

## 5. Cloud-export dependencies and blockers

`/api/system/cloud-export` is used during cold-start seeding and automatic full-season synchronization. Its snapshot currently contains club settings and per-event competition metadata, courses, classes, competitors, stations, and emergency data.

Full-season sync has protections for several migrated domains, but competitor syncing remains a critical hazard: the snapshot loop can update existing Firestore competitor documents and delete Firestore-owned competitor documents omitted from the Express list. Station snapshot syncing also remains a stale-write/deletion risk. Derived competition counts/emergency fields are still mirrored.

Before removing `cloud-export`:

1. Make competitor and station mutations Firestore-first and disable snapshot-based updates/deletes for those collections.
2. Move or explicitly classify emergency settings and any remaining competition-derived data.
3. Ensure imports and migration repairs have explicit, scoped APIs rather than generic snapshot sync.
4. Confirm cold-start initialization no longer depends on exporting an Express model to seed Firestore.
5. Verify counters and public/admin summaries derive from canonical records.

Do not use a whole-season snapshot as a normal synchronization mechanism once document-level Firestore ownership is established.

## 6. Cloud-hydrate dependencies and blockers

Cold-start flow can load a Firestore season and send it to `/api/system/cloud-hydrate` so Express can reconstruct its in-memory `eventsMap`. That is currently important because the Express process still performs punch/readout work and ROC polling using in-memory competition records.

Hydrate may rebuild the Express mirror for compatibility, but it cannot be removed until:

- Every server operation either reads/writes Firestore directly or uses a deliberately versioned cache.
- Punch/readout processing no longer requires `seasonDb` as its state source.
- ROC polling and Eventor work no longer depend on Express-held season state, or Express is explicitly retained as an integration service.
- Live event feed and WebSocket clients have a non-hydrate source.
- Cold starts and server restarts can rebuild any permitted cache from Firestore without losing or overwriting newer writes.
- Backup/restore responsibilities are separated from cloud hydration.

Cloud-hydrate is a cache/bootstrap mechanism today; it should not be confused with the final backup/restore strategy.

## 7. WebSocket dependencies

The Express `/api/ws` endpoint sends authenticated `state:sync` payloads assembled from `seasonDb`. The payload includes the active competition’s competitor list, stations, emergency settings, ROC state, live events, plus other state. Public clients receive a ping and fetch the public race view separately.

Authenticated clients already protect some Firestore-owned fields from stale snapshots, but the snapshot handler still applies competitor, station, emergency, ROC, and live-event values from Express. WebSocket therefore remains tightly coupled to the compatibility model even for Firestore-owned parts of the state.

Before replacing it:

- Establish authoritative subscriptions or incremental change feeds for every view and role.
- Ensure participant and receipt transactions produce consistent listener-visible updates.
- Decide how to publish derived results and the live-event feed.
- Preserve access control and avoid exposing private admin, Eventor, or participant data to public clients.
- Handle reconnection, offline clients, ordering, duplicate events, and competition switching.

Changing the transport before the data ownership and event semantics are settled would move the same inconsistency to a new channel.

## 8. ROC dependencies

ROC polling remains in Express. The active competition’s `roc` state carries the enabled flag, unit ID, polling interval, cursor (`lastPunchId`), total received, last-poll time, and last error. A server interval polls the ROC endpoint, parses text punches, calls the shared Express punch processor, persists JSON, and broadcasts state.

ROC therefore depends on:

- A long-running server timer.
- Express-local ROC settings and a durable cursor.
- Express station definitions and punch classification.
- Express competitor lookups and status mutation.
- Express live-event generation and WebSocket broadcasts.

Moving ROC requires a managed scheduled/task design, atomic cursor advancement, and the same idempotent Firestore punch path used by other sources. A lease or equivalent coordination is needed to prevent two pollers from ingesting the same cursor range. Verify timeout/retry behavior before retiring the Express poller.

## 9. Eventor dependencies

The Eventor API key and core configuration are stored privately in Firestore; ordinary clients must not receive the secret. Express currently remains the integration backend for Eventor requests and XML parsing. Club sync and event import also update Express runner/competition/class/competitor mirrors, with Firestore persistence performed in adjacent client or Firestore paths.

Remaining work includes:

- Move privileged Eventor calls to Firebase Functions (or another explicitly secured backend).
- Keep credential access server-side and preserve role checks.
- Define Firestore-first import transactions for runner records and competition entries.
- Remove remaining Eventor status/behavior mirrors such as `autoCreateFromRunnerDbOnReadout` from `seasonDb` where a Firestore-owned setting is intended.
- Verify imports cannot be partially committed across Eventor parsing, runnerDb, classes, and competitors.

Eventor API configuration ownership is migrated; the integration execution path is not.

## 10. Competitor and readout dependencies

Firestore structures already exist:

- `competitions/{id}/competitors/{id}` for current competitor records and materialized race fields.
- `competitions/{id}/readoutReceipts/{receiptId}` for immutable readout inputs/outcomes (`UNKNOWN` or `PROCESSED`).
- `competitions/{id}/stationPunches/{punchId}` for immutable online-punch inputs.

The offline queue already calls Firestore readout and punch helpers, but Express routes remain and several client mutation handlers still call Express before Firestore. Competitor full-season sync can also overwrite or delete Firestore records from the legacy snapshot.

Important fields/behaviors still coupled to `seasonDb` include:

- Competitor `rawReadout`, adjusted `cardPunches`, `validation`, `radioSplits`, `lastSeenControl`, and `lastSeenTimeSec`.
- `processedClientIds`, which duplicates some of the durable receipt-based idempotency mechanism.
- Result validation and recalculation using competitor raw data, courses/classes, and emergency settings.
- Direct entry, Eventor/batch import, draw, rental/payment updates, manual finish and status correction routes.
- Live-event generation associated with those mutations.

The target is Firestore-first competitor state and immutable receipt inputs; validation, adjusted punches, splits, and last-seen values should be derived or treated as rebuildable projections. `isBorrowedCard` exists in the application model but is omitted from current Firestore mapping/rules and needs to be addressed before Firestore can fully replace the mirror.

The detailed field and receipt design is documented in [COMPETITOR_READOUT_ARCHITECTURE.md](./COMPETITOR_READOUT_ARCHITECTURE.md).

## 11. Target architecture

```text
                         ┌────────────────────────────┐
                         │ React clients              │
                         │ role-aware Firestore reads │
                         └──────────────┬─────────────┘
                                        │
                                        ▼
┌─────────────────────┐     ┌────────────────────────────┐
│ Firebase Auth       │     │ Firestore                  │
│ identity and roles  │     │ canonical application data │
└─────────────────────┘     │ club, competitions,        │
                            │ courses, classes, runners, │
                            │ competitors, receipts,     │
                            │ stations, ROC state,       │
                            │ emergency settings, events │
                            └──────────────┬─────────────┘
                                           ▲
                       ┌───────────────────┴────────────────┐
                       │                                    │
              Firebase Functions                   Optional cache/adapters
              Eventor, ROC polling,                (rebuildable, non-authoritative)
              privileged processing

Explicit backup/export is separate from application synchronization.
No mutable whole-season JSON database or stale snapshot writer remains.
```

The target may retain a backend for privileged operations, but that backend must read and write canonical Firestore data. Express is removed only after its API, integration, persistence, and realtime responsibilities are either migrated or intentionally retained behind a Firestore-backed service boundary.

## 12. Migration roadmap

### Phase 0 — Establish safeguards

- Inventory production Firestore data and document IDs.
- Verify security rules and role access for each operation.
- Stop stale snapshot paths from overwriting migrated domains.
- Keep backups for recovery, but distinguish recovery imports from normal sync.

### Phase 1 — Competitors and readouts

- Disable competitor snapshot-driven update/delete behavior in full-season sync.
- Make competitor reads and mutations consistently Firestore-first; preserve IDs and include borrowed-card semantics.
- Make readout/punch receipts the sole idempotency source for migrated ingestion.
- Commit known receipt and competitor state changes atomically; persist unknown receipts and provide explicit recovery/linking.
- Move draw, manual finish, payment/rental, imports, and result-affecting actions.
- Make result recalculation reproducible from receipts, Firestore-owned courses/classes, and explicit/versioned emergency inputs.

### Phase 2 — Stations and emergency configuration

- Split station configuration from runtime telemetry.
- Make configuration Firestore-authoritative and provide Express a startup/refreshed in-memory cache; never fetch Firestore per punch.
- Remove auto-creation of canonical stations from punch processing.
- Move emergency settings/time offsets to an explicit Firestore-owned location and unify recalculation behavior.
- Remove station/emergency writes from legacy full-season synchronization.

### Phase 3 — Live-event feed and real-time projection

- Define an append-only live-event model linked to committed source receipts/mutations.
- Use deterministic event IDs to avoid duplicates on retry.
- Migrate all event sources: punches, readouts, manual changes, direct entry, and emergency actions.
- Provide role-safe Firestore listeners or a Firestore-backed event publisher.

### Phase 4 — ROC service

- Move polling to Firebase Functions or another managed scheduled service.
- Persist cursor, lease, status, and errors in Firestore.
- Route ingested ROC punches through the same receipt and transaction path.
- Verify duplicate pollers, retries, partial responses, and cursor recovery.

### Phase 5 — Eventor service and imports

- Move privileged Eventor API calls and XML processing to a secured backend function.
- Keep the API key private.
- Commit runner/entry imports to Firestore through scoped operations with clear failure/retry behavior.
- Retire Express Eventor routes and behavior/status mirrors once verified.

### Phase 6 — Remove snapshot synchronization

- Remove routine `cloud-export` and `cloud-hydrate` application flows.
- Retain explicit migration/repair tools only if needed, with scoped and auditable behavior.
- Separate user-requested backup/restore from synchronization. Restore must not blindly overwrite canonical Firestore records.

### Phase 7 — Retire WebSocket, JSON persistence, and Express

- Replace `state:sync` with Firestore subscriptions or a narrowly scoped Firestore-backed realtime service.
- Migrate remaining administrative and public APIs.
- Stop writing `passersi-season-db.json` for operational state.
- Keep explicit export only if there is a supported recovery use case.
- Remove Express and its deployment only after there are no required API routes, integration workers, timers, or consumers.

## 13. Rollback strategy

### General rules

- Firestore remains the recovery source for migrated domains.
- Express compatibility state must be rebuildable from Firestore; it must not become a second writer.
- Never re-enable stale full-season competitor/station writes or allow an old JSON backup to replace newer Firestore state.
- A backup is for explicit recovery and audit, not a synchronization mechanism.

### Per-phase rollback

1. **UI/read-path regression:** revert the client read path or listener while keeping Firestore writes canonical; rebuild the Express cache from Firestore before using legacy readers.
2. **Mutation regression:** disable the affected UI operation or queue it with its stable idempotency key. Do not fall back to a JSON write that could later overwrite Firestore.
3. **Function/ROC/Eventor outage:** pause the worker or integration and retain durable work/cursor state. Do not run two active processors without a lease/idempotency guarantee.
4. **Realtime regression:** temporarily restore a Firestore-backed compatibility publisher or an Express publisher that reads canonical Firestore state. Do not make JSON authoritative again.
5. **Data repair:** use a reviewed, scoped repair/import operation with stable IDs and audit information. Reconcile from receipts and canonical documents.

Rollback becomes harder after the live-event model and WebSocket are removed, so retain a staged compatibility period and test recovery before deleting old data paths.

## 14. Remaining effort estimate

These estimates are directional, assuming one developer familiar with the codebase and including implementation, integration, and targeted verification. They are not commitments and phases may overlap.

| Workstream | Estimated effort | Risk |
|---|---:|---|
| Competitors + readouts, including atomicity, snapshot protection, imports and recalculation | 4–7 weeks | High |
| Stations + emergency settings and Express cache transition | 2–4 weeks | Medium–high |
| Live-event persistence and publisher migration | 1–3 weeks | Medium–high |
| ROC managed polling, lease/cursor and retry validation | 1–3 weeks | High |
| Eventor managed integration and transactional imports | 2–4 weeks | Medium–high |
| WebSocket/state distribution replacement | 2–4 weeks | High |
| Remove cloud snapshot flows, JSON operational persistence, and Express routes/deployment | 1–3 weeks | High until all dependencies are verified |
| Cross-cutting validation, migration rehearsal, monitoring and recovery | 2–4 weeks | High |

**Indicative remaining total:** approximately **13–28 developer-weeks**. This range includes cross-cutting validation and reflects uncertainty in the operational cutover, concurrent processing, offline recovery, and deployment/recovery expectations. It is not the sum of independent best-case estimates; integration and verification are likely to overlap some work but can also uncover additional requirements.

## 15. Retirement exit criteria

`seasonDb` and its JSON persistence can be retired when:

- Every required domain has a documented canonical Firestore source or a deliberately retained external service.
- No production mutation depends on an Express-local competitor, station, readout, emergency, live-event, ROC, or Eventor mirror as its only durable state.
- Full-season snapshots cannot overwrite or delete newer canonical records.
- Readout and punch retries remain safe across offline operation, timeouts, reloads, and server/function restarts.
- Result calculations are repeatable from durable source data and defined configuration.
- Live events and role-specific/public views update from canonical state without depending on `seasonDb`.
- ROC/Eventor workers have safe ownership, retry, and duplicate-processing controls.
- Backup/restore is explicit and has been tested independently of application synchronization.
- Server restart, network partition, concurrent writes, rollback, and data-reconciliation scenarios have passed.
- All remaining Express routes, timers, WebSocket consumers, and static-serving responsibilities have either been removed or explicitly approved to remain.

Until then, `seasonDb` is best described as a **legacy operational compatibility database with migrated Firestore-owned fields**, not as retired persistence.
