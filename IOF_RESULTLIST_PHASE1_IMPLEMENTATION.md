# IOF ResultList Phase 1 Implementation

## Outcome

**PASS.** The current ResultList exporter was updated and regression-tested
against the official IOF Interface Standard 3.0 XSD. It is now expected to
pass a strict IOF 3.0 validator for well-formed competition, class, runner,
date/time, and course data.

This establishes IOF schema validity for the tested output shapes. It does not
prove that a particular Eventor instance will accept, match, or publish the
results. A controlled Eventor upload remains the next interoperability test.

## Changes made

- Corrected person-name child ordering to IOF's required `Family`, then `Given`.
- Added `status="Complete"` only when the competition is marked completed, all
  included competitors have terminal result states, and every competitor
  references an exported class. Other exports are explicitly `Snapshot`.
- Included all competitor statuses in the XML: unstarted/check-in states map
  to `Inactive`, in-forest to `Active`, preliminary finish to `Finished`, and
  final result states to their IOF equivalents.
- Assigned shared positions to equal elapsed times and competition-style
  subsequent positions (for example `1, 1, 3`).
- Included known elapsed times for `MP` and `DNF`; `Position` remains limited
  to `OK` runners with a valid time.
- Serialized missing splits as `Missing`, punched controls with unavailable
  times as `OK` without `Time`, broken controls as `OK` without `Time` (IOF
  has no broken-control status, and PasserSI adjudicates these as exempt from
  missing-control failures), and extra punches as `Additional`.
- Emitted the known course-control sequence as missing splits when a runner
  has no validation record, and kept the app's finish marker out of
  `SplitTime`.
- Suppressed the Eventor import's synthetic SI value while retaining actual
  rental-card numbers.
- Changed the XML creator label to `LIVE-Appen`.

At the time of this Phase 1 implementation, Eventor identity fields were not
included in the ResultList. A follow-up now emits preserved Eventor event,
class, person, and organisation IDs when present; the controlled Eventor
matching test for an ID-bearing result file remains a separate interoperability
check.

## Automated XSD validation and regression coverage

Added `npm run test:iof`, which runs Vitest against the exported XML using
`libxml2-wasm` and the official IOF XSD pinned to repository revision
`24eb108e4c6b5e2904e5f8f0e49142e45e2c5230`. The test verifies the schema
checksum before validation. The test fetches the XSD from the official IOF
GitHub repository, so running this test requires network access.

Regression coverage includes:

- Strict XSD validation of results spanning all PasserSI runner statuses.
- A negative validation case proving that reversed person-name ordering is
  rejected by the XSD.
- Snapshot/complete selection and preliminary/unstarted status mappings.
- Tied ranks.
- Missing, time-unavailable, broken-control, additional, and finish splits.
- Omission of the known synthetic imported SI number while retaining a real
  rental-card number.

## Verification

| Command | Result |
|---|---|
| `npm run build` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test:iof` | **PASS** — 1 file, 5 tests, including official XSD validation |
| `git diff --check` | **PASS** |

Build output included existing Vite notices about native config-loader support
and a large production chunk; the build completed successfully.

## Strict-validator answer

**YES** — the representative XML outputs covered by the tests validate against
the pinned official IOF 3.0 XSD, and the known name-order violation is now
regression-tested. Invalid input values supplied to the exporter can still
produce invalid XML; the exporter does not perform general runtime input
validation.

**Eventor upload acceptance is not yet confirmed.** Run the controlled manual
upload with an actual Eventor event and verify the event, class, and runner
associations before treating Phase 1 as complete for production publication.
