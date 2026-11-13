# Competition Deletion

Status: single-competition deletion is implemented through a trusted Firestore Admin SDK transaction. Bulk clear, demo reset, and direct client deletion remain disabled.

## Trusted deletion flow

`POST /api/firestore/competitions/:competitionId/delete` requires an authenticated session. The transaction authorizes either the competition owner or a `SUPER_ADMIN`, reads the competition, admin role, club settings, and all direct competition documents in `courses`, `classes`, `competitors`, `siCardAssignments`, `readoutReceipts`, `stations`, and `stationPunches`. It deletes those documents and the competition document together, removes the competition ID from `clubSettings/default`, and clears `activeEventId` when it pointed to the deleted competition.

The transaction is capped at Firestore's 500-write limit. If related documents plus pointer/parent updates would exceed the limit, the operation returns HTTP 409 before writing anything. This deliberately fails closed rather than splitting deletion into non-atomic batches. Shared `runnerDb` records are not deleted.

The competition-management UI requires confirmation, calls only the trusted endpoint, updates the active competition or enters the empty-season state, and reports any legacy-mirror synchronization warning. The legacy `DELETE /api/competitions/:id` endpoint still returns HTTP 410; Firestore Rules still deny direct client parent and assignment deletion. `deleteCompetitionFromFirestore` intentionally remains a client-side prohibition.

## Legacy paths and remaining limits

- Bulk clear (`POST /api/system/clear-demo`) and seed reset (`POST /api/system/reset-seed`) remain fail-closed.
- The legacy Express mirror is updated only after the Firestore transaction commits. A mirror persistence failure is reported as a warning because it cannot roll back the committed Firestore deletion.
- Firestore does not cascade-delete subcollections. The transaction enumerates all direct competition collections currently used by the application; any future nested subcollections must be added to the deletion design before they are introduced.
- Assignment and competitor documents are deleted together only as part of deleting their entire competition. Individual competitor retirement continues to preserve assignment history through the separate retirement transaction.

## Validation

`src/server/competitionDeletion.test.ts` contains Firestore Emulator tests for owner deletion and child cleanup, rejection of a non-owner administrator, pointer cleanup, and fail-closed handling above the transaction write limit. Run it with `FIRESTORE_EMULATOR_HOST` set. `npm run build` and `npm run lint` validate client and server TypeScript; they do not prove that production rules or data have changed.

No Firebase deployment or production data mutation is part of this migration.
