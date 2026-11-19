# PasserSI — project status handoff

**Updated:** 2026-11-18
**Repository:** `instagramokosteraker-ctrl/Sekretariatet`
**Branch / HEAD:** `main` / `e71bb4c`
**Purpose:** Concise, evidence-based state for continuing work in Cursor, Copilot, or Claude Code.

## Executive status

Application features for live ranking, Eventor identity preservation/class mapping, IOF ResultList export, Firestore-backed result synchronization, and the V5 readout workstation UX are implemented and locally verified. Manual-finish deployment packaging is fixed in source. The Eventor class draw selector and Firestore fallback for a competition missing from the Express mirror are also fixed in source.

**Production readiness is still NO-GO for Firestore identity enforcement.** The latest recorded Firebase Console inspection (2026-11-14) found the currently star-marked production Rules source differs materially from repository `firestore.rules`. No Rules deployment or immutable Ruleset ID/hash attestation is recorded. Do not equate passing source/emulator tests with production enforcement.

Local builds, TypeScript checks, and focused regression tests passed for the recent feature work. Production deployment, live Eventor publishing, and end-to-end live competition verification remain outstanding.

## Current architecture

- **Client:** React, TypeScript, Vite.
- **Identity and authorization:** Firebase Auth with Firestore roles (`SUPER_ADMIN`, `RACE_ADMIN`, `START`, `READOUT`, `FOREST`, `SPEAKER`).
- **Canonical data:** Firestore is the main source for competitions, classes, courses, competitors, SI assignments, live results, and public result projections. Some legacy Express/JSON mirrors remain.
- **API/runtime:** Express in `server.ts` handles API routes and integrations; `api/index.ts` is the Vercel function entrypoint. The shared server bundle is produced by `npm run build`.
- **Live result synchronization:** Firestore listeners are used for Secretariat competitor/radio inputs, Speaker result updates, and Public Portal result/metadata updates. Public result listeners use the safe `publicResults` projection, not raw competitor documents.
- **WebSockets:** `/api/ws` is unsupported/broken on the current Vercel architecture. WebSocket-based public result refresh was removed, but some Secretariat operational/non-result synchronization still depends on the legacy socket path.
- **Eventor:** API credentials are managed in browser local storage and sent to authenticated backend routes. Do not reintroduce Firestore credential persistence. The active competition import now calls `/api/eventor/import-event`, which fetches the event, dedicated class list, and entries separately.

## Completed milestones

### Eventor import and identity

- Active Eventor competition import no longer passes `classesXml: eventXml`; it uses the existing import endpoint and dedicated `eventclasses` response.
- Eventor classes are built from the dedicated list, entry class IDs map competitors to internal classes, and unmatched API-import entries fail explicitly instead of falling back to the first class.
- Eventor identities are preserved in Firestore and supported by export:
  - `eventorEventId`
  - `eventorClassId`
  - `eventorPersonId`
  - `eventorOrgId`
- Vit, Gul, Orange, Svart regression coverage verifies the class identities and competitor mappings. Eventor import classes currently default to allocated-start/draw-eligible (`freeStart: false`), because the import data does not supply a free-start setting.
- See [EVENTOR_CLASS_MAPPING_FIX.md](./EVENTOR_CLASS_MAPPING_FIX.md), [EVENTOR_IDENTITY_PRESERVATION_IMPLEMENTATION.md](./EVENTOR_IDENTITY_PRESERVATION_IMPLEMENTATION.md), and [EVENTOR_IDENTITY_EXPORT_IMPLEMENTATION.md](./EVENTOR_IDENTITY_EXPORT_IMPLEMENTATION.md).

### IOF ResultList

- IOF 3.0 ResultList export was corrected for schema ordering, status/snapshot semantics, ties, splits, and synthetic SI handling.
- Eventor event/class/person/organisation IDs are emitted when present; internal PasserSI IDs are not substituted.
- The pinned official IOF 3.0 XSD validation passes for representative identity-bearing and identity-absent output.
- **Not yet proven:** Eventor acceptance/matching of an actual uploaded file.
- See [IOF_RESULTLIST_PHASE1_IMPLEMENTATION.md](./IOF_RESULTLIST_PHASE1_IMPLEMENTATION.md) and [EVENTOR_IDENTITY_EXPORT_IMPLEMENTATION.md](./EVENTOR_IDENTITY_EXPORT_IMPLEMENTATION.md).

### Live ranking and Bom

- Shared live ranking implementation covers Förenklad vy, Sträcka & bom, Speaker results, and public class results.
- Effective status is derived, not written to Firestore: stored CHECKED becomes effective IN_FOREST at the allocated start time, including immediately when checked after that time. The finalized projection estimate is rolling elapsed race time (`currentTime - actualStartTime`), with projected display styling and passage ordering as specified.
- Radio/finish ranking, radio sorting, ordinary-control sorting, Plac/status output, and reset-to-LIVE behavior were implemented and unit-tested.
- Existing Bom calculation and SI readout validation were left unchanged.
- **Open:** operational/browser verification across views and confirmation that expected live inputs remain correct in a real event.
- See [LIVE_RANKING_IMPLEMENTATION_RESULT.md](./LIVE_RANKING_IMPLEMENTATION_RESULT.md), [LIVE_RANKING_PROJECTION_DECISION.md](./LIVE_RANKING_PROJECTION_DECISION.md), and [LIVE_RANKING_AND_BOM_COMPATIBILITY.md](./LIVE_RANKING_AND_BOM_COMPATIBILITY.md).

### Readout workstation

- V5 workstation UX is implemented: Latest Readout and history use full-card/row status colors based on result and issue state; synchronization state is displayed separately. User-facing issue labels use Swedish operator terminology, and “Redan avläst” remains informational rather than an outstanding issue.
- Readout History is intentionally workstation-local, not a shared competition-wide event log. Different devices may legitimately show different readout rows. Competition results remain shared through Firestore.
- Physical readouts retain `clientReadoutId`, `captureSequence`, and `capturedAt`; latest-readout selection and history ordering remain capture-sequence based. History rows remain reopenable, and Outstanding Issues includes open and in-progress issues.
- Unknown-card resolution remains inline while the reader can capture the next SI card. The runner-name field now searches the runner database as the operator types; selecting a suggestion fills the name, club, profile, and matching class when available. The captured SI number stays read-only.
- Offline queue, receipts, retries, validation, and Bom behavior remain in place.
- **Not implemented:** Phase 3 correction/reassignment transactions, WRONG_COMPETITOR workflow, RESULT_REASSIGNMENT, or audit trail.
- See [READOUT_OVERVIEW_V5_IMPLEMENTATION.md](./READOUT_OVERVIEW_V5_IMPLEMENTATION.md).

### Firestore Live Sync

- **Phase 1 implemented:** competition-scoped competitor listener for status/time/readout/ranking inputs and RADIO/PREWARNING station-punch listener. Ordinary controls remain SI-readout-derived; the listeners do not write projections, status, ranking, or Bom.
- **Phase 2 implemented:** Speaker result/radio synchronization and Public Portal result/metadata listeners. Public results use safe `publicResults` projection documents; raw competitor records are not exposed to the public portal. Public result WebSocket refresh was removed.
- **Phase 3 remains open:** other operational/non-result synchronization (such as staff station configuration and cross-client operational events), and the future role of WebSockets.
- **Deployment caveat:** the Rules source changes for listeners/projections have not been verified as deployed to production.
- See [FIRESTORE_LIVE_SYNC_PHASE1_IMPLEMENTATION.md](./FIRESTORE_LIVE_SYNC_PHASE1_IMPLEMENTATION.md), [FIRESTORE_LIVE_SYNC_PHASE2_IMPLEMENTATION.md](./FIRESTORE_LIVE_SYNC_PHASE2_IMPLEMENTATION.md), and [FIRESTORE_LIVE_SYNC_IMPLEMENTATION_PLAN.md](./FIRESTORE_LIVE_SYNC_IMPLEMENTATION_PLAN.md).

### Manual finish and class draw

- Manual-finish deployment failure was traced to Vercel ESM resolution of a missing `/var/task/server`; build now emits `server.js` and the API entry imports it explicitly. Local Vercel-mode smoke test loaded the route and returned the expected auth response.
- Class draw now sends `competitionId`; the server scopes its lookup to that competition instead of `getActiveEvent()`. Class selection reconciles stale IDs and filters out `freeStart` classes using `CompClass.freeStart`.
- A follow-up 404 was traced to the Express `seasonDb.eventsMap` not containing some Firestore-only competitions (including imported competitions). The client now falls back to the selected competition’s Firestore draw path on API 404, as it already does for unavailable API/network errors. This source change and fallback-classifier tests pass; no live Firestore draw or production deployment has been verified.
- See [MANUAL_FINISH_DEPLOYMENT_FIX.md](./MANUAL_FINISH_DEPLOYMENT_FIX.md), [CLASS_DRAW_404_FIX.md](./CLASS_DRAW_404_FIX.md), and [DRAW_CLASS_FILTER_FIX.md](./DRAW_CLASS_FILTER_FIX.md).

## Firestore Rules and production assurance

### Rules investigation — completed; production mismatch identified

The latest recorded Console inspection was read-only and targeted project `ai-studio-applet-webapp-72c01`, database `ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`. The star-marked active Rules source required a `feeTrackingEnabled` competition field, while repository `firestore.rules` prohibits it. The captured create payload omitted that field, so the active production rule denies the current competition-create request. Console did not expose immutable release/ruleset resource names or a full-source hash.

Earlier production evidence also found assignment create/update/delete, ownership parity, and SI reassignment enforcement gaps versus repository rules. The latest Ruleset comparison resolves the current create-rule discrepancy but does not prove that the other old findings were repaired. Repository test results do not attest production policy.

The last recorded broad Firestore Rules test run was not clean: it logged 18 Rules expression-limit diagnostics on other paths, even though its focused SI-number assertion passed. Isolated Phase 2 projection-rule tests passed, but the full suite remains a separate unresolved issue. The Rules investigation is complete as an assessment; **Rules are not fixed or cleared for production**.

### Other unresolved data and trust risks

- The last V2 production scan (2026-11-10) found six active assignment/competitor `ownerUid` parity mismatches (four Reflexcup#2, two Lång-TM). They remain unresolved pending provenance, owner disposition, correction approval, and a fresh V2 scan.
- Production inventory coverage was incomplete; there was no independent expected-competition register.
- External/Admin SDK writers and effective IAM are not fully inventoried. Required concurrency, retry, timeout, rollback, bootstrap-race, and partial-import recovery evidence is incomplete.
- No production Rules deployment is recorded. A prior authorized Firebase CLI deployment attempt stopped before publishing because the CLI was unauthenticated. Do not assume production changed or retry deployment without explicit authorization.

Reference: [ACTIVE_RULESET_ATTESTATION.md](./ACTIVE_RULESET_ATTESTATION.md), [DEPLOYED_RULE_CLOSURE.md](./DEPLOYED_RULE_CLOSURE.md), [DEPLOYED_RULE_DIFF.md](./DEPLOYED_RULE_DIFF.md), [COMPETITOR_CUTOVER_READINESS.md](./COMPETITOR_CUTOVER_READINESS.md), and [INVENTORY_COVERAGE_REPORT.md](./INVENTORY_COVERAGE_REPORT.md).

## Current open work and recommended next tasks

1. **Verify live ranking operationally:** exercise Förenklad vy, Sträcka & bom, Speaker, and Public Portal with live radio/finish updates; check projections, sorting, derived status, and unchanged Bom behavior.
2. **Verify class draw after Eventor class fix:** test an imported competition with Vit/Gul/Orange/Svart, allocated-start classes and Fri start classes; confirm correct competitor/class mapping and Firestore allocations. Include the Firestore-only competition 404 case. Current local tests do not replace browser/Firestore verification.
3. **Implement Firestore Live Sync Phase 3:** inventory and migrate remaining non-result synchronization; decide whether WebSockets are removed, retained only for an explicitly supported environment, or replaced.
4. **Execute Eventor publication pilot:** get event-owner/admin approval, capture baseline and recovery plan, manually upload a reviewed identity-bearing ResultList, and verify exact event/class/person/organisation matches and no duplicates. The pilot checklist currently says not executed.
5. **Research direct Eventor publishing:** verify current official write API, authentication, permissions, update/idempotency behavior, and supported payload before implementation. Do not infer write endpoints from the read/import API or use undocumented endpoints.
6. **Resolve Rules production risk:** obtain authorized immutable active Ruleset identity/source, reconcile it with the repository, address expression-limit diagnostics, and follow the approved deployment/verification process. Keep production readiness NO-GO until attested.
7. **Close identity/trusted-writer assurance:** resolve the six ownerUid findings, establish full competition inventory, review Admin SDK/IAM writers, and run concurrency/recovery validation.

## Risks and operating notes

- Firestore listeners only synchronize durable changes that reach Firestore; keep live writes on canonical paths and scope listeners to the selected competition/class.
- Public data must remain projection-based. Do not subscribe anonymous users to raw competitor or station-punch documents.
- Firestore read costs grow with listener count, changed documents, and reconnects; monitor event-scale audiences and avoid broad collection subscriptions.
- WebSocket non-result dependencies can leave Secretariat operational state stale in production; assess Phase 3 before removing the legacy path.
- IOF XSD validity is not proof of Eventor acceptance or identity matching.
- Source-level build/test PASS does not attest production deployments, Firestore Rules, Eventor publication, or real-event workflows.
- Protect Eventor API keys and personal data. Do not place credentials or unredacted pilot evidence in source control or external reports.

## Verification snapshot

Recent feature-specific verification recorded in implementation reports:

- `npm run build` — PASS.
- `npm run lint` (`tsc --noEmit`) — PASS.
- Live-ranking suite — PASS as recorded in its implementation result.
- IOF exporter and pinned XSD tests — PASS.
- Eventor class-mapping regression tests — PASS for Vit, Gul, Orange, Svart.
- Firestore Live Sync Phase 2 focused projection-rule tests — PASS; broad Rules suite remains blocked by expression-limit diagnostics.
- Class draw fallback/class selection tests — PASS; local draw fix build/lint passed. Live Firestore/browser verification is still open.
- Readout workstation full source suite — PASS (149 passed, 12 skipped) before the runner-name autocomplete follow-up; after autocomplete, build and lint passed and the focused autocomplete/presentation tests passed (16 tests).

Production deployment, active Rules attestation, controlled Eventor publication, and live-event end-to-end verification are **not** included in these local PASS results.
