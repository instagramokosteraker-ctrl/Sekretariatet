# Firestore Rules — Next Validator Target

## Result

The two validators are effectively tied by source-level estimate on the failing paths:

- `isValidCloudCompetitor(incoming())`: about **71 direct predicates**, plus five `isValidId` helper expansions for about **86 predicates** when the optional `readoutReceiptId` is present.
- `isValidCloudCompetition(incoming())`: about **86 direct predicates**, with no nested helper expansions.

These are comparative source estimates, **not** Firestore's measured expression-meter counts. The emulator does not expose a per-helper expression total, so the evidence cannot establish which validator contributes more to the actual 1,000-expression limit. The competitor-create *rule path* has additional assignment, role, receipt, and RunnerDb checks outside its validator; those make the full path heavier, but do not change the validator-only comparison.

**If only one validator optimization is worth attempting next, target `isValidCloudCompetitor` on the create path.** Unlike the competition validator, it has a clear create-path duplication with the surrounding rule: the competitor and competition IDs are checked both in the validator and against already-validated path IDs. A create-specific validator could remove those duplicate field-ID checks without weakening create validation. This is a narrow optimization, not evidence that it will by itself resolve the overage.

## Counting method

A direct predicate count treats each leaf condition as one predicate and each nested helper call as one predicate. The expanded estimate substitutes the helper body. `&&`/`||` connectors are not counted separately. The relevant nested helper, `isValidId`, checks four leaves: string type, minimum length, maximum length, and allowed-character regex.

The count excludes the outer allow-rule conditions and all authorization/path helpers. Conditional groups are counted as written; predicates inside optional-field branches are only evaluated when those branches are reached.

## `isValidCloudCompetitor`

Defined at [firestore.rules](./firestore.rules#L441), it is called by competitor create at [firestore.rules](./firestore.rules#L1729) and by competitor update.

| Predicate category | Direct predicates |
|---|---:|
| Required/allowed key sets | 2 |
| Optional-field guards (billing timestamp, receipt-ID presence, self-registration) | 5 |
| `isValidId` calls (competitor ID, competition ID, class ID, owner UID, optional receipt ID) | 5 |
| Bib, name, club, SI/card-series, and boolean field checks | 18 |
| Status type, bounds, and enum | 11 |
| Six lifecycle second fields: type and lower/upper bounds | 18 |
| Readout timestamp string/type-length checks | 2 |
| Punch-list types, sizes, equal lengths, and first-element checks | 8 |
| Created/updated timestamp types | 2 |
| **Direct total** | **71** |

When `readoutReceiptId` is present, all five ID helper bodies are reached: `71 + (5 × 3 additional leaves) ≈ 86`. If it is absent, four ID helpers are reached and the estimate is about 83. The “additional leaves” calculation replaces each helper-call predicate with its four internal checks.

### Constraints duplicated elsewhere

| Constraint | Other enforcement | Assessment |
|---|---|---|
| `competitorId` is a valid ID | The create rule validates the path `competitorId` and requires `incoming().competitorId == competitorId`. | **Exact create-path duplicate.** A create-specific validator could omit this field's `isValidId` call. Keep it in the shared validator unless the update path separately proves an equivalent invariant; update compares the incoming ID to the existing document, not directly to the path. |
| `competitionId` is a valid ID | The create rule validates the path `competitionId` and requires `incoming().competitionId == competitionId`. | **Exact create-path duplicate.** Same create-specific opportunity. The update rule compares to existing data, so this is not redundant for all validator callers. |
| `readoutReceiptId` is a valid ID | The READOUT identity/provenance chain also validates the receipt ID. | Repeated on the READOUT branch, but not a safe global removal: the field is optional and other authorized create/update branches do not all require receipt provenance. |
| `createdAt`/`updatedAt` are timestamps | Create requires both to equal `request.time`; update requires `updatedAt == request.time`. | Likely type-implied by equality to a timestamp, but not included in the conservative savings estimate. Create/update-specific validation and Rules' typed equality semantics should be verified before relying on this. |
| SI number/card series and owner/competitor identity | Assignment schema/parity checks validate matching values in the batch. | **Not generally redundant.** A competitor can pair with an existing assignment; independent validation protects the competitor path and legacy data. The owner check also compares distinct trust boundaries. |
| Name/club/card-series identity | READOUT branch compares these to RunnerDb. | Not a global duplicate: the admin/super-admin create branches do not require the RunnerDb identity check. |

The conservative exact create-only opportunity is to avoid the two repeated field-ID validations. That removes eight expanded predicates from the competitor validator invocation (two `isValidId` bodies × four leaves), while retaining the outer path validations and field/path equalities. A create-only validator or equivalent factoring is necessary; removing these checks from the shared validator without compensating update validation would change update behavior.

## `isValidCloudCompetition`

Defined at [firestore.rules](./firestore.rules#L247), it is called by the competition update rule at [firestore.rules](./firestore.rules#L1366).

| Predicate category | Direct predicates |
|---|---:|
| Required/allowed key sets | 2 |
| Competition ID and short-code string/length/regex checks | 8 |
| Name, organizer, and date checks | 9 |
| Status type, bounds, and enum | 6 |
| Zero-time string and seconds checks | 7 |
| Arena and series string checks | 4 |
| Optional self-registration/status-override guards and types | 4 |
| Current/legacy fee-field compatibility | 4 |
| Competitor/finished counter types and ranges, plus ordering | 7 |
| Broken-control list checks | 4 |
| Optional control-offset map checks | 3 |
| Four optional PIN validations | 20 |
| Optional `pinsCustomized` type | 2 |
| Owner UID string/length/regex checks | 4 |
| Created/updated timestamp types | 2 |
| **Direct total** | **86** |

There are **no nested custom-helper expansions** in this validator. Built-in map/list operations and the inline optional-field branches are counted as direct predicates above.

### Constraints duplicated elsewhere

| Constraint | Other enforcement | Assessment |
|---|---|---|
| `updatedAt` is a timestamp | The update rule requires `incoming().updatedAt == request.time`. | Likely one duplicate type predicate, subject to the same typed-equality caveat. |
| `competitionId` is a valid ID | The update rule validates the path ID but requires the incoming competition ID to equal `existing().competitionId`, not the path ID. | **Not a proven duplicate** for update. Removing it would rely on the existing document already having a valid matching ID. |
| Counter ranges and `finishedCount <= competitorCount` | The READOUT branch requires exact count transitions. | Some checks are implied for that branch only under assumptions about the existing counters. Other update branches can edit counters, and the schema also enforces bounds. Do not remove globally. |
| Status enum | The reopen branch narrows status to `LIVE` or `UPCOMING`. | Not a global duplicate: other authorized update branches allow the other valid status too, and unchanged legacy status is not independently proven valid by the branch. |
| Legacy fee-field compatibility | Fee/payment fields are now optional legacy data; new writes and mutations of those fields are rejected. | Compatibility-only validation; it no longer represents active competition behavior. |
| Full key/schema validation | Update branches also constrain changed keys with `diff().affectedKeys().hasOnly(...)`. | Not equivalent. A changed-key allowlist does not establish required fields or validate unchanged fields in the incoming document. |

The readout counter branch changes only counters and `updatedAt`, but `isValidCloudCompetition` runs before the role-specific branches. Skipping validation of all unchanged fields would alter behavior for existing documents that do not satisfy the current schema; the available evidence does not establish that all stored documents are valid. Aside from the likely `updatedAt` type overlap, there is no comparably clear, broad safe reduction in this validator.

## Relative expression-cost assessment

| Validator | Direct source estimate | Expanded estimate on the failing fixture | Known safe duplicate opportunity |
|---|---:|---:|---|
| `isValidCloudCompetitor` | ~71 | ~86 (receipt ID present) | ~8 expanded predicates for two create-path ID checks; possibly two timestamp-type checks after validating typed equality |
| `isValidCloudCompetition` | ~86 | ~86 | About one likely duplicated timestamp-type check; larger reductions require branch-specific assumptions or trusting existing data |

`isValidCloudCompetition` has more inline predicates; `isValidCloudCompetitor` catches up through nested ID-helper expansion. The compiler/emulator evidence names rule paths rather than validator costs, so neither the source counts nor these overlap estimates prove which helper is more expensive to Firestore's evaluator.

## Next target

Optimize **`isValidCloudCompetitor` for create only**, if attempting one further semantics-preserving validator change. The strongest candidate is to remove the validator's `competitorId` and `competitionId` format checks only from that create path, where the validated path IDs and incoming/path equalities already enforce them. Preserve the full checks for update, and retain every other schema, ownership, assignment-parity, receipt, and RunnerDb guarantee.

This is a modest, measurable source-level saving (about eight expanded predicates), not a claim that it will clear the 1,000-expression ceiling. A larger reduction would need new evidence about actual evaluator costs or stronger invariants about existing documents. No rules were modified and the suite was not rerun.

## Input filename note

The requested `FIRESTORE_ULES_ARCHITECTURE_ASSESSMENT.md` spelling does not exist in the workspace. This assessment used the corresponding [FIRESTORE_RULES_ARCHITECTURE_ASSESSMENT.md](./FIRESTORE_RULES_ARCHITECTURE_ASSESSMENT.md).
