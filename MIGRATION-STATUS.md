# PasserSI Architecture Modernization — Migration Status

Last updated: 2026-11-10

## Current architecture

- **Frontend:** React/Vite application, intended to be hosted on Vercel.
- **Authentication and authorization:** Google Sign-In through Firebase Auth. User roles are stored in Firestore and include `SUPER_ADMIN`, `RACE_ADMIN`, `START`, `READOUT`, `FOREST`, and `SPEAKER`.
- **Cloud data:** Firestore is used for role data, club settings, runner database records, competition metadata, courses, classes, and cloud season synchronization. `clubSettings/default.activeEventId`, `clubName`, branding settings (`portalTitle`, `logoDataUrl`, `customBgColor`, `customTextColor`, `customAccentColor`), `eventorOrgId`, fee defaults (`defaultDirectEntryFeeSek`, `rentalCardFeeSek`, `missingRentalFeeSek`), `runnerDb/{siNumber}`, and competition metadata, courses, and classes are canonical in Firestore. Express `seasonDb` values remain temporary compatibility mirrors for existing routes. Competition organizers are competition-owned data.
- **Fees:** Swish configuration and Swish-specific UI have been removed. Generic fee tracking remains available under `feeTrackingEnabled`; older competition documents are read compatibly and new documents use only the renamed field.
- **Backend:** The Express application in `server.ts` still exists and serves API routes, serves the production frontend when configured to do so, and hosts the `/api/ws` WebSocket endpoint. It also retains server-side integration and persistence responsibilities.
- **Eventor:** Eventor settings are managed in the administration UI and stored privately in Firestore. Eventor calls have **not** been migrated to Firebase Functions and still depend on the Express backend.
- **ROC:** ROC polling remains in the Express backend.
- **Realtime state:** WebSocket state distribution remains in place; Firestore listeners have not replaced it.

## Completed migration phases

### Phase 1 — Remove PIN authentication from the UI

**Status:** Completed  
**Purpose:** Remove visible PIN and offline-code login options and related terminology.  
**Commit:** `1ab1c6e`

### Phase 2 — Remove PIN authentication from the client

**Status:** Completed  
**Purpose:** Remove client-side PIN/offline-code login flows and PIN-only session handling.  
**Commit:** `e3b4c31`

### Phase 3 — Remove PIN fields from the Firestore client model

**Status:** Completed  
**Purpose:** Stop creating, requiring, or synchronizing PIN fields in the current client data model while preserving compatibility with older competition documents and rules during migration.  
**Commit:** `81b0b9f`

### PIN backend cleanup

**Status:** Completed  
**Purpose:** Remove legacy PIN/offline-code backend routes and related authentication compatibility. Keep this separate from the numbered architecture migration phases below.  
**Commit:** `3fa9789`

## Future architecture migration phases

**Current-status note (2026-11-10):** The numbered phase narratives below preserve implementation history and are not the current cutover verdict. In particular, P0 Step 6 describes pre-Step-7 rules; P0 Step 7 describes the initial rule fence but does not account for its DNS/DNF exception, assignment-only helper paths, skipped-retirement outcomes, or card-series parity gap. The canonical current verdict and evidence are in [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md) and [FINAL_READINESS_BLOCKERS.md](./FINAL_READINESS_BLOCKERS.md).

### Phase 4 — Atomic SI matching foundation

**Status:** Phase A complete; Phase B complete; schema/rule alignment complete; Phase C Steps 1–2 implemented; P0 Step 7 adds client-rule fencing for paired competitor/assignment identity writes; uniqueness enforcement remains disabled
**Purpose:** Add the canonical `competitions/{competitionId}/siCardAssignments/{siNumber}` collection and its schema support, then provide opt-in read-only lookup/resolver and admin validation helpers. The aligned document contract uses `state`, required `schemaVersion: 1`, Firestore `Timestamp` values, required identity/ownership fields, and explicitly optional retirement/conflict metadata. The parser, write helpers, Firestore rules, rules tests, and design document use this same contract, including `DUPLICATE_CONFIRMED`. Lookup hits, misses, retired assignments, and duplicate conditions produce diagnostic console logs, not durable audit records.

**Current Phase C Steps 1–2 status (supersedes the earlier preview-only notes below):** Create writes the competitor and ACTIVE assignment atomically; delete and retirement retire or create a RETIRED assignment in the same transaction. SI reassignment now reads the competitor, current assignment, and target assignment, then in one transaction retires the old assignment, creates or reactivates the new assignment, and updates the competitor SI fields. An occupied or malformed target assignment is preserved and reported as a reassignment conflict; the competitor write continues, so duplicate SI values remain allowed. A missing old assignment is reported as a partial reassignment. The runnerDb-backed readout auto-create path now separately fails closed on existing assignments and duplicate competitor candidates; global uniqueness enforcement remains disabled.

**P0 Step 6 (diagnostics-only Firestore rules preparation):** Audited the `competitors` and `siCardAssignments` match rules. Both collections currently authorize independent admin writes; rules enforce document shape and role checks but do not validate cross-document SI consistency or require a shared transaction. Firestore Security Rules cannot emit warning logs, so rules behavior is intentionally unchanged and comments mark this limitation. `inspectSIAssignmentRuleMutations` produces warning-only diagnostics for competitor SI changes without old-retire/target-activate writes, assignment create/update without a matching competitor mutation, and assignment deletion outside retirement. The shared mutation boundary and standalone assignment helpers emit applicable diagnostics for in-process legacy operations. Rules tests document the expected paired batch and demonstrate that independent/mismatched writes remain permitted today; the emulator suite was not executable in this workspace because no Firestore emulator was running.

**P0 Step 7 (initial Firestore rule fence):** Competitor creation now requires an ACTIVE assignment in the same commit; changing SI requires the old assignment to be RETIRED and the requested SI to have an ACTIVE assignment in the same commit; deleting a competitor requires its assignment to be RETIRED. Assignment create/update requires a corresponding competitor create, SI change, lifecycle change, or delete in that commit. Assignment hard delete is denied. These rules do not query competitors or reject duplicate SI candidates; an already-ACTIVE target can still be referenced by a mutation that retires the competitor's old SI, preserving the pre-enforcement duplicate policy. Identity-independent competitor status/readout/billing fields keep their existing rules. Rule tests now expect paired writes to succeed and isolated/mismatched writes to fail.

**Legacy-writer milestone — restore identity fence:** The highest-risk remaining writer was `/api/system/restore`, because it replaces the complete Express season and can create, delete, reassign, or change lifecycle status for many competitors from one backup. Restore now compares the current and backup competitor identities and lifecycle statuses (competition, competitor ID, SI number, card series, and status) before applying anything. Any difference returns HTTP 409 with a user-facing explanation and a structured warning; a backup with the same competitor identity/status set can still restore other season data. No assignment writes or uniqueness enforcement were added.

**Legacy-writer milestone — cloud-hydrate identity fence:** `/api/system/cloud-hydrate` now treats the local competitor identity set as authoritative. It hydrates non-identity mirror fields for matching competitor IDs, while preserving `id`, `competitorId`, `siNumber`, `cardSeries`, lifecycle `status`, and any assignment relationship/state metadata from the existing local record. Incoming additions, removals, identity changes, duplicate IDs, and omitted competitions are skipped/preserved and produce structured warnings plus mutation diagnostics. Cloud hydrate does not write Firestore assignment documents; their state remains unchanged.

**Remaining writer inventory before uniqueness enforcement:**
- **Risk ranking (SI-assignment divergence):**
  1. **Express CRUD/direct-entry — MUST BE REDIRECTED.** Active create, SI-update, and delete paths mutate the Express season independently.
  2. **Eventor/IOF import — MUST BE REDIRECTED.** Bulk imports can add competitors without assignment transactions.
  3. **Readout auto-create — migrated.** Firestore now creates competitor, SI assignment, receipt, and counters in one transaction; the Express compatibility route no longer creates identity. The Express readout result mirror still needs cutover.
  4. **Competition deletion — MUST BE REDIRECTED.** Removes a competition and its local competitors without retiring their assignments.
  5. **Snapshot seeding — MUST BE REDIRECTED or removed.** It still attempts Firestore competitor creates without assignments; the client rules fence denies incomplete commits.
  6. **Restore — identity/lifecycle changes fenced.** Backups with unchanged competitor identities/status can still restore other season data.
  7. **Cloud hydrate — identity changes fenced.** Non-identity mirror fields continue to hydrate; additions, removals, reassignment, and assignment metadata changes are blocked.
- **MUST BE REDIRECTED:** Remaining active writers in ranks 1, 2, 4, and 5. They do not use the trusted atomic assignment transaction; server/Express paths can also sit outside Firestore client rules.
- **SAFE TO KEEP (limited):** Cloud hydrate for non-identity mirror fields only; restore of non-identity data when competitor identities/status remain unchanged.
- **MUST BE DISABLED or wrapped:** Standalone client writes to `siCardAssignments`, hard assignment deletion, and direct competitor SI create/update/delete without their corresponding assignment mutation. Rules now deny incomplete client commits; exported one-document assignment helpers must not be used as mutation APIs.

Move or disable the remaining writers behind the trusted atomic path. Run the Firestore emulator suite and add trusted-server transaction tests for retries, rollback, and concurrent duplicate attempts. Restore and cloud-hydrate identity changes are fenced, but server-side bypasses remain; readiness remains **NO GO** for uniqueness enforcement.

**P0 Step 2:** A shared `declareCompetitorMutation` diagnostic boundary records whether a mutation is `VALIDATED` or explicitly `LEGACY`.

**P0 Step 3:** Identity-affecting competitor writes are routed through `runCompetitorMutation` or `runCompetitorMutations` in `src/utils/siAssignmentDiagnostics.ts`. The common boundary declares operation type and assignment-awareness, logs `mutationBoundary: CENTRALIZED` and `enforcementReadiness: PRE_ENFORCEMENT`, then invokes the original writer. It covers Firestore direct-entry, CRUD, imports, snapshot seeding and competition deletion, plus Express direct-entry, SI edits, deletes, IOF/Eventor imports, readout auto-creation, cloud hydration, restore, demo clear and competition deletion. Writes remain allowed; no uniqueness checks, assignment writes or readout-resolution changes were introduced. Non-identity billing and result updates remain diagnostic declarations because they do not mutate competitor identity.

**P0 Step 4:** The shared service now accepts a mutation intent, competitor context, assignment context, and optional synchronous validation hooks. Hooks are observational: failures are logged but do not reject writes. The canonical `runCompetitorIdentityMutation(s)` entry point is used by both assignment-aware and legacy wrappers. Diagnostics distinguish `assignmentAwarePathUsed`, `legacyPathBypassed`, and `legacyAssignmentWritePending`; a legacy declaration means assignment writes/validation are still pending, not that the service was skipped. The service supports create, identity update, SI change, retirement, and deletion intents, but it does not yet write assignments or enforce uniqueness.

**P0 Step 5:** `runAtomicSIAssignmentMutation` is the Firestore transaction boundary used by `saveDirectCompetitionEntryToFirestore`, `updateCompetitorInFirestore` and `deleteCompetitorFromFirestore`; its actual write callback now runs through `runAssignmentAwareCompetitorMutation` after the transaction has read and diagnosed relevant assignment documents. The other in-repository identity writers also pass through `runCompetitorIdentityMutation(s)` via the established Firestore and Express wrappers: direct-entry/CRUD, imports (including IOF and Eventor), readout auto-creation, restore, cloud hydrate, snapshot seeding, and competitor removals during competition deletion. Legacy writers emit diagnostics and continue to write; paths outside the process (including direct Firestore clients authorized by the current rules) cannot be forced through the in-process service. The transaction reads the competition and competitor documents plus relevant current/requested SI assignment documents, classifies assignment existence/missing/mismatch, and returns a structured result. Create and SI-change paths also report competitor documents that currently match the requested SI as duplicate candidates; this diagnostic query is read-only and performed before the transaction because the Firebase Web SDK transaction API supports document reads, not query reads. No path writes SI assignments or rejects duplicate SI values in this step.

**Readout auto-create migration (2026-11-10):** The Firestore readout submission now atomically writes runnerDb-backed competitor identity, its ACTIVE SI assignment, the immutable readout receipt, and competition counters. It fails closed to an `UNKNOWN` receipt when the assignment exists, duplicate competitor candidates are found (or the scan fails), or runnerDb identity changed. Readout-operation retries use the receipt ID and reject a reused ID with different payload. `/api/readout` and online-punch processing no longer create competitor identities in the Express season. Firestore rules permit this narrow paired identity write to readout-capable roles only when identity fields match runnerDb. The Express readout result processor remains a non-authoritative compatibility path, and the other legacy identity writers/global uniqueness policy remain open blockers; overall readiness remains **NO GO**. Details: [READOUT_AUTOCREATE_IMPLEMENTATION.md](./READOUT_AUTOCREATE_IMPLEMENTATION.md).

**Remaining before Phase C:** All identified in-repository competitor identity writers are routed through the shared mutation service, but only the three Firestore CRUD paths use the assignment-observing transaction; Express, import, restore, hydrate, and snapshot writers remain legacy mirrors and are not atomic with assignments. The service is observational and cannot fence direct Firestore clients; current rules permit independently authorized competitor and assignment writes. Before Phase C, move or disable these legacy writers, make assignment writes and competitor changes atomic in a trusted path, fence direct client writes in Firestore rules, and validate reassignment, retirement/deletion, concurrent duplicate attempts and rollback. Duplicate-candidate detection is diagnostic and may race. Uniqueness remains disabled.

**Atomic SI Matching Phase C Preview:** The transaction now prepares immutable preview plans for create, SI reassignment, retirement, and deletion. It reports `assignmentExists`, `assignmentMismatch`, `duplicateCandidate`, `reassignmentRequired`, `retirementRequired`, and whether enforcement would succeed or block with reasons. The actual mutation callback still runs regardless of preview blockers; the preview performs no assignment writes and does not reject conflicts. Metrics are accumulated in memory per client runtime and logged as `[atomic-si-preview-metrics]` after completed transaction attempts. They count operations, simulated successes/blocks, and reassignment/retirement requirements. Metrics start at zero on reload; no live Firestore operation was run during implementation, so validation-time simulated counts are 0. Query-based duplicate candidate detection remains outside the transaction due to Firebase Web SDK limitations; query errors count as simulated blocks.

### Phase 5 — Move Eventor calls to Firebase Functions

**Status:** Not started  
**Purpose:** Route Eventor operations through authenticated, role-checked Firebase Functions. Keep the API key server-side and read the private Eventor settings from Firestore. Retire the corresponding Express routes after the Functions are validated.

### Phase 5 — Move ROC polling to Firebase Functions

**Status:** Not started  
**Purpose:** Move ROC polling out of the long-running Express process, persist polling state in Firestore, and prevent duplicate polling with a Firestore lease or equivalent coordination.

### Phase 6 — Replace WebSocket state distribution and retire Express

**Status:** Not started  
**Purpose:** Replace `/api/ws` state broadcasts with Firestore listeners, migrate any remaining server-owned state and persistence needs, then remove the Express backend when no required functionality depends on it.

## Target architecture

```text
Vercel
└── React frontend

Firebase
├── Firebase Auth — Google sign-in
├── Firestore — roles, club settings, and realtime application data
└── Firebase Functions — privileged Eventor and ROC integrations
```

The target is **Vercel + Firestore + Firebase Functions**, with no separately hosted Express server once all remaining server responsibilities have been migrated.

## Important decisions already made

- PIN authentication is deprecated and its legacy backend routes have been removed.
- Google Login through Firebase Auth is the only supported login mechanism.
- Authorization is based on Firestore role assignments; the existing roles remain in use: `SUPER_ADMIN`, `RACE_ADMIN`, `START`, `READOUT`, `FOREST`, and `SPEAKER`.
- Eventor API credentials must remain private and must not be exposed to ordinary users or sent to the frontend.
- Eventor migration to Firebase Functions has **not** started.
- ROC migration to Firebase Functions has **not** started.
- WebSocket replacement with Firestore listeners has **not** started.
- The Express backend still exists and must not be removed until its remaining API, integration, persistence, and realtime responsibilities are migrated and verified.

## Firestore-owned club branding

The five branding fields above are read from a Firestore listener in the authenticated app and public portal. The administration save path requires a successful Firestore write before updating local UI state; it may then mirror settings to the legacy Express API for compatibility.

Full-season sync no longer writes branding fields to an existing `clubSettings/default` document. If that document does not yet exist, its initial creation may seed branding once from the legacy export; subsequent cloud exports and hydrations cannot replace the established Firestore values. Express state and JSON persistence may still contain these fields temporarily, but are not authoritative.

## Firestore-owned Eventor organization ID

`clubSettings/default.eventorOrgId` is canonical. Full-season sync may seed it only when creating a missing club-settings document; it does not include this field in updates to an existing document. Authenticated UI state also ignores the Eventor ID in Express state snapshots and keeps the value from the Firestore listener. Admin saves continue to write Firestore first and may mirror the value to Express for compatibility. Cloud export/hydration and server-side JSON can still carry or store the legacy mirror, but cannot update the canonical Firestore value.

## Firestore-owned fee defaults

`defaultDirectEntryFeeSek`, `rentalCardFeeSek`, and `missingRentalFeeSek` in `clubSettings/default` are canonical. Admin settings continue to save these fields to Firestore first and then mirror them to Express when available. Full-season sync only seeds them when creating a missing club-settings document; updates to an existing document preserve the Firestore values. Authenticated state snapshots also preserve the values from the Firestore listener rather than accepting stale Express settings. Cloud export and hydration may continue to use `seasonDb` as a compatibility mirror but cannot change Firestore fee defaults. These defaults affect new/default fee calculations only; existing class `feeSek` values and competitor payment/return fields remain stored per record and are not rewritten by this migration.

## Firestore-owned club name

`clubSettings/default.clubName` is canonical and is used for club branding and as the default organizer for newly created competitions. Existing `competition.organizer` values remain competition-specific historical data. Startup normalization, club-settings saves, cloud hydration, restore, and competition updates no longer replace them with the current club name. Competition duplication retains the source organizer in both Express and Firestore paths. Full-season sync only seeds `clubName` when the Firestore settings document is first created; authenticated UI state preserves the Firestore-listened value when applying Express snapshots. Express `seasonDb` and its JSON backup/export can continue carrying a compatibility mirror.

## Firestore-owned series scoring settings

`clubSettings/default.seriesScoringSettings` is canonical. Full-season synchronization seeds the field only when creating the club-settings document and does not update it on an existing document. Authenticated state snapshots preserve the Firestore-listened setting, and series scoring changes are written to Firestore before refreshing standings. Admin and public standings are recalculated from a Firestore season snapshot; an authenticated administrator also mirrors the canonical setting to Express so legacy server-generated snapshots remain aligned. Cloud export, hydration, and `seasonDb` may retain a compatibility mirror but do not write this field back to an existing Firestore document.

## Firestore-owned runner database

`runnerDb/{siNumber}` is canonical. Admins read and mutate it directly in Firestore; assigned officials have read-only access for SI-number lookup and start-corral workflows. The client subscribes to Firestore runner records, ignores `runnerDb` from authenticated Express snapshots, and writes imports, edits, deletions, and learned direct-entry records to Firestore before updating the temporary Express mirror. Eventor club/event imports continue through the existing Eventor routes and return the imported runner records for Firestore persistence. Full-season sync does not write the runner collection. Cloud export, cloud hydration, JSON backup/restore, and server snapshots can still carry or rebuild the Express compatibility mirror, but do not replace Firestore records.

## Firestore-owned courses

Courses under `competitions/{competitionId}/courses` are canonical. Authenticated clients subscribe to the selected competition's Firestore courses; create, update, delete, and course imports write Firestore first. Firestore course changes continue to trigger the existing Firestore-based result recalculation. Class references (`courseId` and `forkCourseIds`) are checked before deleting a course; referenced courses are retained and the UI reports the blocking classes.

Express course routes remain compatibility mirrors and retain their existing server-side validation/recalculation behavior. Authenticated UI snapshots no longer replace the Firestore course state. Full-season sync does not write or delete course documents, and it no longer deletes competitions merely because a legacy snapshot omitted them; explicit competition deletion remains responsible for deleting a competition and its subcollections. Cloud export and cloud hydration may still carry/rebuild the Express mirror but cannot write those courses back to Firestore through full-season sync.

## Firestore-owned classes

Classes under `competitions/{competitionId}/classes` are canonical. Authenticated clients subscribe to the selected competition's Firestore classes; class create, update, and delete write Firestore first. Existing class IDs are retained for updates and imports, and imports pass those IDs through to the Express compatibility mirror. Partial class updates preserve course links, fork course IDs, direct-entry settings, free-start/draw settings, rogaining rules, and fees. Class course references are validated against Firestore courses.

Deleting a class is rejected while any Firestore competitor still references its `classId`; replacement imports apply the same check before committing. Class document changes continue to trigger Firestore-based result recalculation. Authenticated UI snapshots no longer replace class state. Full-season sync does not write or delete classes. Cloud export/hydrate and Express snapshots may still carry the compatibility mirror but cannot make it authoritative for authenticated clients or sync it back to Firestore.

Express routes, server calculations, imports, backup/restore, cloud export, and hydrate still read or mirror `seasonDb` class data for compatibility. Server-side class lookups remain in the legacy result, draw, and entry paths; migrating those consumers is a later step. The class mirror is kept by class ID so existing server routes continue to operate during this transition.

Rollback must switch authenticated class reads and writes back together and should first hydrate the Express mirror from Firestore. Do not re-enable class writes in `syncFullSeasonToFirestore` while a potentially stale Express snapshot can be submitted. Firestore remains the recovery source for class IDs and course references.

## Firestore-owned competitor payment and rental flags — Phase 1

Only `feePaid` and `rentalReturned` are fully Firestore-authoritative in the initial competitor slice. Authenticated competitor loading and the rental overview read these fields from Firestore. A Firestore listener updates the active competitor list, and authenticated Express/WebSocket snapshots preserve the current Firestore values rather than replacing them.

Payment and rental-return edits write Firestore first. Only after that succeeds does the client update its local state and attempt to update the Express compatibility mirror. The rental overview also writes Firestore before its event-scoped Express mirror. READOUT officials may update only `rentalReturned`; payment changes remain admin-only. Existing imports and `syncFullSeasonToFirestore` seed these fields when creating a missing competitor document but omit them from updates to existing documents.

### P0 competitor snapshot protection

`syncFullSeasonToFirestore` treats every existing Firestore competitor document as protected from legacy snapshot updates: it skips the entire document update and logs changed fields when the incoming snapshot differs. It also refuses to delete an existing Firestore competitor omitted by a legacy snapshot and logs the attempted omission. Existing competitor documents are read across the full subcollection so this guard also prevents accidental replacement attempts against documents owned by another account. The function can still seed a missing competitor document from a legacy snapshot; the Firestore rules deny that create unless the corresponding active SI assignment is included in the same commit. Express competitor-update and rental/payment mirror routes log attempts to write protected fields and retain their current mirror behavior.

This is a write guard, not a completed migration of competitor CRUD or the rest of the competitor schema. Express/JSON still owns most operational competitor processing, including status, times, punches, readouts, validation, and splits. Authenticated direct-entry creation commits to Firestore before sending the same competitor ID to Express as a compatibility mirror; unauthenticated direct entry remains Express-first. Explicit Firestore competitor updates, deletion, and imports remain separate mutation paths and are not disabled by this snapshot-only milestone.

## Firestore-owned competition metadata

The competition document at `competitions/{competitionId}` is canonical for competition ID, short code, name, organizer, date, lifecycle status and override, zero time, arena, series association, self-registration, and fee tracking. Authenticated clients use Firestore summaries and an active-competition document listener; create, update, activate, duplicate, and delete operations complete in Firestore before updating the Express compatibility mirror. Duplicate competitions retain the source organizer, zero time, arena, and series.

Express snapshots no longer replace authenticated competition metadata. `syncFullSeasonToFirestore` may seed a missing competition document during legacy migration, but does not overwrite metadata on an existing document. It mirrors derived competitor counts and emergency settings; it may also update the derived lifecycle status only when there is no explicit status override and the Firestore date and zero time still match the snapshot. Legacy cloud export and hydrate still carry/rebuild the Express mirror, but do not write existing competition metadata back to Firestore. The club competition ID index is merged during full-season sync so a stale export cannot remove newer IDs.

Rollback must switch authenticated metadata reads and writes together and first hydrate the Express mirror from Firestore. Do not restore metadata writes from full-season sync. Competition metadata is no longer effectively seasonDb-owned; Express still uses its mirror for legacy routes, backups, and server-side processing.

The Express mirror remains used by legacy routes and server-side auto-learning when competitors are edited. That server-side side effect is not yet a Firestore write; moving it completely requires a later competitor-state migration. Existing runner records that exist only in a local JSON backup are not automatically re-imported, because treating a missing Firestore document as permission to recreate it could resurrect an intentionally deleted record. Such records must be explicitly imported by an administrator.

## Swish removal

Swish number/recipient configuration and Swish-specific payment labels have been removed. Fee amounts and manual paid/unpaid tracking remain generic. Existing Firestore club documents have deprecated Swish fields deleted by club-setting saves and season synchronization; existing competition fee flags are mapped to `feeTrackingEnabled` when read, while new writes use only `feeTrackingEnabled`.
