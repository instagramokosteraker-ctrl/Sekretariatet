# Concurrency Validation

- Assessment: 2026-11-11 11:03 CET.
- Verdict: **FAIL — not executed.**
- Scope: concurrent competitor update, SI reassignment, duplicate assignment attempts, and transaction retries.
- No production writes or test writes were made.

## Evidence and environment

Repository source routes the reviewed competitor/SI writers through per-competitor Firestore transactions in `src/firebase.ts`. Existing documentation describes the intended serialization behavior, but no recorded emulator contention results or retry counts were found.

The repository includes `@firebase/rules-unit-testing` and an exported Firestore Rules suite. This environment has no `firebase.json`, Firebase CLI in the repository, or Java runtime. A temporary Firebase CLI invocation reported version `15.35.0`, but its dependency emitted a Node-engine warning because this environment uses Node `v26.13.0` and the package requires Node 20, 22, or 24. Without the Firestore Emulator prerequisite and an operation-level test harness, no concurrency or retry tests were run.

## Required tests and acceptance criteria

Run in an isolated emulator with deterministic fixtures and a barrier-based harness:

1. Competing creates for the same competition/SI through direct entry vs direct entry, import, readout, and bootstrap.
2. Concurrent SI reassignments for the same competitor, including reassignment vs readout/import.
3. Concurrent competitor updates and reassignment vs retirement/delete.
4. Firestore transaction conflict retry and bounded-retry exhaustion.
5. Repeat each contention scenario at least 100 times with fresh fixtures.

Pass only if each contention leaves at most one active SI owner, every committed competitor/assignment pair has matching owner, card series, SI, and IDs, lifecycle history is valid, and rejected/retried operations surface explicitly without partial paired writes. Record outcomes, retries, and failures for every repetition.

## Closure decision

**FAIL.** Source inspection is not concurrency evidence. No races, duplicates, transaction retries, or recovery behavior were exercised; the result is unknown, not a pass.
