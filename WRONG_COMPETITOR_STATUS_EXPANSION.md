# WRONG_COMPETITOR status expansion

## Decision and result

The **Fel löpare** workflow now applies to any successfully matched, processed
readout with no completed reassignment and a result status of `OK`, `MP`, or
`PRELIMINARY_FIN`. The status is moved with the readout; reassignment no longer
revalidates into a different result status.

Starting **Fel löpare** replaces the current readout issue with an open
`WRONG_COMPETITOR` issue, including an open `MP_REVIEW` issue. The record's
single issue-type/state fields cannot represent both at once.

## Eligibility audit

The former `OK`-only gates were:

- `src/components/ReadoutDashboard.tsx`, selected-detail action:
  `selectedReadout.resultStatus === 'OK'` around line 1225.
- `src/App.tsx`, `createWrongCompetitorIssue`: rejected every status except
  `OK` around line 1237.
- `src/server/readoutReassignment.ts`, `reassignReadoutResult`: rejected a
  stored source competitor unless `sourceData.status === 'OK'` around line 391.
- `src/utils/readoutReassignment.ts`, preview: replaced the transferred
  status with `validation.ok ? 'OK' : 'MP'` around line 102. This could change
  both the original MP status and the result produced by validation against a
  different runner/class.

The `selectedReadout.resultStatus === 'OK'` check around line 1124 in
`ReadoutDashboard.tsx` is only result-verification display text; it is not an
eligibility gate and remains unchanged.

## Current rules and implementation

Eligibility is centralized in
`isEligibleWrongCompetitorReadout` at
`src/services/readoutHistoryStore.ts:72`. It requires:

- `readoutState === 'PROCESSED'`;
- a matched `competitorId` (and, when present, the original match still agrees
  with the current match);
- `resultStatus` of `OK`, `MP`, or `PRELIMINARY_FIN`;
- no `correctionOperationId` and no applied correction in the local audit.

`ReadoutDashboard` uses this predicate to render **Fel löpare** at
`src/components/ReadoutDashboard.tsx:1226`, regardless of issue state.
`createWrongCompetitorIssue` in `src/App.tsx:1233-1249` rechecks the same
predicate before opening the issue and sets `WRONG_COMPETITOR` / `OPEN`,
replacing any prior issue as decided.

The server independently validates that the canonical source status is one of
the three supported statuses in `reassignReadoutResult`
(`src/server/readoutReassignment.ts:392`) and continues to require a valid
processed receipt and an eligible, different target. A target must be
`REGISTERED`, `CHECKED`, or `IN_FOREST`, and must not already have readout data.
An original result with a manual finish time is still rejected as ambiguous;
the readout must be the source of the transferred result.

`calculateReadoutReassignmentPreview` carries the original competitor's
supported status to the target (`src/utils/readoutReassignment.ts:61,109`),
while still calculating timing, punches, validation details, Bom, and placing.
Placing remains available only for `OK`. The server's audit records
`previousStatus` and the same `newStatus`.

The App now reloads the committed competition with
`loadFullSeasonFromFirestore` after success. It does not call
`recalculateCompetitionFromFirestore`, which would derive `OK`/`MP` from
validation again and could overwrite a preserved `MP` or `PRELIMINARY_FIN`
status. The history record still retains its original competitor fields and
captured readout payload; the server does not mutate the readout receipt or
punch data. The existing operation ID/replay behavior and audit document
remain in place (`src/App.tsx:1300-1315`).

## Status coverage and regression tests

Focused utility and Firestore-emulator tests now cover all three statuses:

- `src/utils/readoutReassignment.test.ts`: preview preserves each status,
  including an `MP` result even when the target-class validation itself is OK.
- `src/server/readoutReassignment.test.ts`: transaction moves each status to
  the target, leaves the receipt unchanged, preserves punch/radio data, and
  records matching old/new statuses in the audit. Replay/idempotency is also
  exercised for each status.
- `src/services/readoutHistoryStore.test.ts`: eligibility accepts matched
  `OK`, `MP`, and `PRELIMINARY_FIN` records, including an open MP review, and
  rejects unmatched, unprocessed, unsupported, or already-corrected records.

Emulator-backed transaction cases run only when
`FIRESTORE_EMULATOR_HOST` is configured.

## Verification

- `npm run build` — passed. Vite emitted existing config-loader and large
  chunk-size warnings.
- `npm run lint` — passed (`tsc --noEmit`).
- `npx vitest run src` — passed: 170 passed, 20 skipped.
- Firestore emulator reassignment suite — passed: 8/8 with a 20-second test
  timeout. The default 5-second timeout expired on the three transaction
  cases; rerunning with the longer timeout passed all cases.

The emulator command used the demo project
`demo-passersi-readout-reassignment-tests`; no production Firestore data was
used.
