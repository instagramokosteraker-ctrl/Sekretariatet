# Wrong-competitor cancel fix

## Root cause

Clicking **Fel löpare** called `onCreateWrongCompetitorIssue` before opening the
form. The App callback immediately persisted `issueType: WRONG_COMPETITOR` and
`issueState: OPEN`. **Avbryt** only closed the component's local form state, so
the persisted issue remained open and continued to appear in Outstanding
Issues.

## Issue lifecycle

### Before

1. Click **Fel löpare**.
2. Persist `WRONG_COMPETITOR` / `OPEN`.
3. Open the reassignment form.
4. Cancel only closes the form; the issue remains open.

### After

- **Fel löpare** opens a local draft; it does not write to readout history.
- **Avbryt** closes and clears the draft fields without changing the readout
  or Outstanding Issues.
- **Bekräfta korrigering** rechecks eligibility and creates the open issue
  immediately before the correction request. Successful correction stores its
  audit and transitions the issue to `RESOLVED`. If the correction request
  fails after explicit confirmation, the issue remains open for follow-up.
- Reopening an existing `OPEN` or `IN_PROGRESS` issue does not create another
  issue. Cancelling leaves its stored type and state unchanged.

## Files changed

- `src/components/ReadoutDashboard.tsx` — opening and cancelling the form now
  only change draft UI state; removed the issue-creation callback.
- `src/App.tsx` — creates the issue on confirmation, checks eligibility, and
  restores prior issue fields if local persistence fails.
- `src/services/readoutHistoryStore.ts` — centralizes the confirmation
  transition while preserving an already active issue.
- `src/services/readoutHistoryStore.test.ts` — covers draft, confirmation,
  resolution, existing open issues, and Outstanding Issues filtering.

## Verification

- `npm run build` — passed.
- `npm run lint` — passed.
- `npx vitest run src --testTimeout 20000` — passed: 184 tests; 25 skipped.

The build emitted non-blocking Vite configuration and large-chunk warnings.
