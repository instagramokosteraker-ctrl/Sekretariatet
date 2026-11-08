# PasserSI Architecture Modernization — Migration Status

Last updated: 2026-11-08

## Current architecture

- **Frontend:** React/Vite application, intended to be hosted on Vercel.
- **Authentication and authorization:** Google Sign-In through Firebase Auth. User roles are stored in Firestore and include `SUPER_ADMIN`, `RACE_ADMIN`, `START`, `READOUT`, `FOREST`, and `SPEAKER`.
- **Cloud data:** Firestore is used for role data, club settings, and cloud season synchronization. `clubSettings/default.activeEventId` and the branding settings (`portalTitle`, `logoDataUrl`, `customBgColor`, `customTextColor`, `customAccentColor`) are canonical in Firestore. Express `seasonDb` values remain temporary compatibility mirrors for existing routes.
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
