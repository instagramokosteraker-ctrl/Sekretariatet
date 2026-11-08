# PasserSI Architecture Modernization — Migration Status

Last updated: 2026-11-08

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

### Phase 4 — Move Eventor calls to Firebase Functions

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

## Firestore-owned competition metadata

The competition document at `competitions/{competitionId}` is canonical for competition ID, short code, name, organizer, date, lifecycle status and override, zero time, arena, series association, self-registration, and fee tracking. Authenticated clients use Firestore summaries and an active-competition document listener; create, update, activate, duplicate, and delete operations complete in Firestore before updating the Express compatibility mirror. Duplicate competitions retain the source organizer, zero time, arena, and series.

Express snapshots no longer replace authenticated competition metadata. `syncFullSeasonToFirestore` may seed a missing competition document during legacy migration, but does not overwrite metadata on an existing document. It mirrors derived competitor counts and emergency settings; it may also update the derived lifecycle status only when there is no explicit status override and the Firestore date and zero time still match the snapshot. Legacy cloud export and hydrate still carry/rebuild the Express mirror, but do not write existing competition metadata back to Firestore. The club competition ID index is merged during full-season sync so a stale export cannot remove newer IDs.

Rollback must switch authenticated metadata reads and writes together and first hydrate the Express mirror from Firestore. Do not restore metadata writes from full-season sync. Competition metadata is no longer effectively seasonDb-owned; Express still uses its mirror for legacy routes, backups, and server-side processing.

The Express mirror remains used by legacy routes and server-side auto-learning when competitors are edited. That server-side side effect is not yet a Firestore write; moving it completely requires a later competitor-state migration. Existing runner records that exist only in a local JSON backup are not automatically re-imported, because treating a missing Firestore document as permission to recreate it could resurrect an intentionally deleted record. Such records must be explicitly imported by an administrator.

## Swish removal

Swish number/recipient configuration and Swish-specific payment labels have been removed. Fee amounts and manual paid/unpaid tracking remain generic. Existing Firestore club documents have deprecated Swish fields deleted by club-setting saves and season synchronization; existing competition fee flags are mapped to `feeTrackingEnabled` when read, while new writes use only `feeTrackingEnabled`.
