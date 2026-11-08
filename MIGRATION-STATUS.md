# PasserSI Architecture Modernization — Migration Status

Last updated: 2026-11-08

## Current architecture

- **Frontend:** React/Vite application, intended to be hosted on Vercel.
- **Authentication and authorization:** Google Sign-In through Firebase Auth. User roles are stored in Firestore and include `SUPER_ADMIN`, `RACE_ADMIN`, `START`, `READOUT`, `FOREST`, and `SPEAKER`.
- **Cloud data:** Firestore is used for role data, club settings, and cloud season synchronization. `clubSettings/default.activeEventId`, `clubName`, branding settings (`portalTitle`, `logoDataUrl`, `customBgColor`, `customTextColor`, `customAccentColor`), `eventorOrgId`, and fee defaults (`defaultDirectEntryFeeSek`, `rentalCardFeeSek`, `missingRentalFeeSek`) are canonical in Firestore. Express `seasonDb` values remain temporary compatibility mirrors for existing routes. Competition organizers are competition-owned data.
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

## Swish removal

Swish number/recipient configuration and Swish-specific payment labels have been removed. Fee amounts and manual paid/unpaid tracking remain generic. Existing Firestore club documents have deprecated Swish fields deleted by club-setting saves and season synchronization; existing competition fee flags are mapped to `feeTrackingEnabled` when read, while new writes use only `feeTrackingEnabled`.
