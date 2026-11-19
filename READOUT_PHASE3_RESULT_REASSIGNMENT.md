# Readout Phase 3: Result reassignment

## Delivered

The readout history detail panel now supports correcting an already processed
`OK` result:

1. Select **Fel löpare** on an eligible historical readout.
2. Select another competitor and provide a reason.
3. Review the original and new competitor, result status, placing, running time,
   and Bom before confirming.
4. The server validates and applies the correction in a Firestore transaction.
   The panel then shows the corrected current competitor and its audit history.

The issue remains open if preview, authorization, validation, or transaction
processing fails. A successful correction marks it resolved. The original
readout payload, receipt, punch data, and original competitor snapshot are
preserved; future SI-card ownership is not changed.

## Authorization, replay safety, and audit

`POST /api/firestore/competitions/:competitionId/readouts/:readoutId/reassignment`
revalidates the actor's current role on the server. It accepts `READOUT` and
`FOREST` officials, the owning `RACE_ADMIN`, and `SUPER_ADMIN`. The transaction
fails closed when the original result, readout, target, or related receipt data
is missing, conflicting, or ambiguous.

The operation ID is retained in browser storage for retries of the same
readout/target/reason request. Replaying the same operation returns the stored
result; reusing its ID with a different payload is rejected. Audit documents
are created once in `competitions/{id}/readoutCorrections/{operationId}` and
client writes/deletes are denied by Firestore rules.

Audit fields:

- actor UID and role
- server-generated timestamp
- reason
- readout ID and operation ID
- original competitor ID/name and corrected competitor ID/name
- result: previous/new status, finish time, running time, Bom, and placing

The local history preserves the original competitor fields and separately
updates the current competitor and correction operation/audit metadata.

## Files changed for this implementation

- `src/types/readoutReassignment.ts`
- `src/utils/readoutReassignment.ts`
- `src/utils/readoutReassignment.test.ts`
- `src/server/readoutReassignment.ts`
- `src/server/readoutReassignment.test.ts`
- `server.ts`
- `firestore.rules`
- `src/App.tsx`
- `src/components/ReadoutDashboard.tsx`
- `src/services/readoutHistoryStore.ts`
- `src/services/readoutHistoryStore.test.ts`

The worktree also contains the earlier Phase 2 row-clickability work and its
deliverables: `src/components/ReadoutHistoryRow.tsx`,
`src/components/ReadoutHistoryRow.test.tsx`,
`READOUT_OK_ROW_GAP_ANALYSIS.md`, and `READOUT_ROW_CLICKABILITY_FIX.md`.

## Verification

- `npm run build` — passed.
- `npm run lint` — passed.
- `npx vitest run src` — passed: 164 tests; 16 skipped, including emulator-gated
  cases when no emulator is configured.
- Firestore emulator reassignment tests — passed: 4 tests covering Anna → Erik,
  exact replay and payload conflict, unauthorized actor, and missing target.
- The transaction test confirms the receipt and radio-split data remain intact.

The build reports existing Vite configuration and large-chunk warnings; neither
blocks the build.

## Remaining work outside this scope

- Correction workflows for unknown/unlinked cards, class conflicts, or other
  ambiguous assignments.
- Eventor publication and Firestore Live Sync Phase 3.
- Competitor-retirement architecture and unrelated admin workflows.
