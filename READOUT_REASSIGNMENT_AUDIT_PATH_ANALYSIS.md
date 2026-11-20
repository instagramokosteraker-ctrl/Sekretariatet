# Readout reassignment audit path analysis

## Finding

The repository's audit writer and both audit readers use the same Firestore
collection under the competition:

`competitions/{competitionId}/readoutCorrections`

The writer creates each audit document at:

`competitions/{competitionId}/readoutCorrections/{operationId}`

For the affected competition, that is:

`projects/ai-studio-applet-webapp-72c01/databases/ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df/documents/competitions/evt-1794746557864-xnwuab/readoutCorrections/{operationId}`

The documented current Firestore inventory and prior query result show no
`readoutCorrections` documents for this competition. The best-supported
classification is **A: the collection has no audit document and is therefore
not materialized in Firestore for this competition**. This is expected when no
reassignment has successfully committed. A failed ambiguity check throws
before the audit write, so that attempt does not create an audit.

## Write path

In `src/server/readoutReassignment.ts`, `reassignReadoutResult` defines:

- `competitionRef` as `competitions/{competitionId}` at line 273.
- `operationCollection` as
  `competitionRef.collection('readoutCorrections')` at line 274.
- `operationRef` as `operationCollection.doc(operationId)` at line 275.

After validation and result updates have been prepared, the transaction creates
the audit at `transaction.create(operationRef, storedAudit)` at line 662.
Therefore the exact write document path is:

`competitions/{competitionId}/readoutCorrections/{operationId}`

The audit document contains `readoutId`, and its document ID is `operationId`.

## Read paths

There are two reads of the same collection:

1. **Prior-applied-reassignment guard:** `reassignReadoutResult` queries
   `operationCollection.where('readoutId', '==', readoutId)` at line 382, then
   checks for `result.status === 'APPLIED'` at lines 410-411. Its collection
   path is `competitions/{competitionId}/readoutCorrections`.
2. **Audit history API:** `listReadoutReassignmentAudits` queries
   `.collection('readoutCorrections').where('readoutId', '==', readoutId)` at
   lines 234-235. It returns those documents through
   `GET /api/firestore/competitions/:competitionId/readouts/:readoutId/corrections`
   in `server.ts:4469-4501`.

Both reads therefore target the same collection as the write. The
prior-reassignment query is by the stored `readoutId` field, not by audit
document ID.

## Rules and deployment configuration

`firestore.rules:2107` declares
`match /readoutCorrections/{operationId}` under
`/competitions/{competitionId}`. Client create/update/delete is denied by the
rules at lines 2116-2117; the server's trusted Firestore transaction is the
writer.

The local server configuration uses project
`ai-studio-applet-webapp-72c01` and database
`ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df`
(`server.ts:507-541`). These match the Firebase Console project/database
identified for the observed competition. The deployed Vercel revision itself
was not independently identified, so a deployed-version mismatch cannot be
proven or ruled out solely from this workspace.

## A-D assessment

| Choice | Assessment |
|---|---|
| **A. Audit collection never created** | **Best-supported for the current state.** There are zero audit documents and no visible collection. Firestore collections are materialized by documents; this failed attempt stops before the write, so it leaves no audit document. This establishes current absence, not the entire historical lifetime of the collection. |
| **B. Audit collection created elsewhere** | **No evidence in the repository.** The application has one reassignment audit write path, and it writes to `competitions/{competitionId}/readoutCorrections/{operationId}`. |
| **C. Lookup uses wrong path** | **No.** The audit write, prior-reassignment lookup, audit-history lookup, and rules path all use `readoutCorrections` beneath the same competition. |
| **D. Deployment mismatch** | **Unverified, but not indicated by the available configuration.** Local project/database IDs match the observed Firebase Console project/database; the exact deployed revision was not available for comparison. |

The absent collection explains why `priorReassignment` has no matching applied
audit; it does not identify which receipt-related guard branch produced the
ambiguity error. No code was changed.
