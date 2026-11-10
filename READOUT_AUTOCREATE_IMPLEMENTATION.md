# Readout Auto-Create Implementation

Date: 2026-11-10

## Result

Runner-database readout auto-create now creates the competitor, active SI assignment, readout receipt, and competition count projections in one Firestore transaction. A retried readout reuses its stable `clientReadoutId`; a receipt with the same ID but different input is rejected.

The Express `POST /api/readout` and online-punch processing paths no longer create competitor identities in `seasonDb`. The normal offline-readout queue submits directly to the Firestore helper, which performs the authoritative transaction when the readout opts into runner-database auto-create.

## Transaction behavior

For an unmatched SI number with a matching Firestore runner-database entry and auto-create enabled:

1. Load a stable readout operation ID and derive a deterministic competitor ID from it.
2. Read the competition, proposed competitor, SI assignment, readout receipt, and runner-database entry before writing.
3. If an assignment already exists, a duplicate competitor is found, the duplicate scan fails, the runner record changed, or the derived competitor ID is already occupied, write an `UNKNOWN` receipt only. Do not create competitor identity or assignment.
4. Otherwise, atomically write:
   - a competitor document based on the runner-database identity and readout result;
   - the `ACTIVE` `siCardAssignments/{siNumber}` document with source `READOUT`;
   - the immutable `PROCESSED` readout receipt;
   - competitor and finished count increments.
5. Firestore rules require the paired competitor/assignment/readout-receipt commit. Readout officials may use this narrow create path only when competitor name, club, and card series match the runner-database record and the receipt identifies that competitor.

The SI assignment document is the concurrency lock for each SI number. Competing transactions for the same unassigned SI cannot both create an active assignment. The duplicate competitor query is outside a Firebase Web SDK transaction; query failure is fail-closed, and the transaction's assignment-document read/write protects concurrent new assignments.

## Diagnostics

Attempts emit `[READOUT_AUTOCREATE_MIGRATION]` with `competitorId`, `siNumber`, `assignmentResult`, and `transactionResult`. A processed/unknown receipt result is also included. Aborted transactions log the error and rethrow so the durable offline queue can retry instead of reporting success.

## Modified files

- `src/firebase.ts` — atomic competitor + SI assignment + receipt creation, retry/payload checks, counter updates, and migration diagnostics.
- `src/App.tsx` — passes the existing auto-create setting through the durable readout queue.
- `src/types/sportident.ts` — carries the auto-create option with a queued readout.
- `server.ts` — removes identity creation from `/api/readout` and the shared online-punch processor; logs when the legacy endpoint would have auto-created.
- `firestore.rules` — permits narrowly scoped readout-role creation from a matching runnerDb identity and paired assignment/receipt; guards count changes.
- `firestore.rules.test.ts` — covers valid paired readout creation and rejects an identity mismatch.

## Removed legacy writes

- `ev.competitors.unshift(...)` for readout auto-create.
- Local `cmp-${Date.now()}-...` identity generation from `runnerDb` in `POST /api/readout`.
- The equivalent auto-create from the online-punch/ROC processing path.
- Auto-create writes into the local Express season snapshot.

Unknown cards remain visible as unknown readouts when auto-create is disabled or ownership/uniqueness checks fail. The normal Firestore path records those outcomes as `UNKNOWN` receipts, preserving the original card data and stable retry identity.

## Remaining risks and blockers

- Existing duplicate competitor documents without SI-assignment records are detected by the pre-transaction query and block auto-create. That query is not transactional, but the canonical assignment document serializes new claims for the SI number.
- The browser Firestore SDK remains the transaction client. Rules constrain readout-role identity creation to runnerDb-matching identity fields, but a trusted server/Functions boundary is still the target architecture.
- The legacy Express `/api/readout` path remains a compatibility processor for existing competitors and local live-event data. It no longer creates identity, but it does not persist canonical Firestore receipts or competitor results. It must be retired or redirected in a later readout cutover.
- Other legacy identity writers (Express CRUD/direct-entry, imports, snapshot seed, restore/delete paths) remain outside this change and keep the overall competitor migration at **NO-GO**.
- Firestore emulator tests require a running emulator; this implementation's required validation is the project build and TypeScript lint/type-check.

## Rollback strategy

1. Disable `autoCreateFromRunnerDbOnReadout` in the UI to stop new automatic identity creation while retaining unknown readout receipts.
2. Do not restore the old Express auto-create branch.
3. If an auto-created competitor must be reversed, use the canonical competitor retirement/deletion flow so its SI assignment is retired atomically. Preserve the immutable readout receipt for audit and replay; do not delete it or remove the assignment document directly.
4. Re-enable the feature only after confirming assignment ownership and reconciling queued readouts.
