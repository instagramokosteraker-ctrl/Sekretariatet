# Readout Terminology Update

Date: 2026-11-17

## Scope

Documentation-only update to the V5 implementation plan and V2 status-color specification. Internal issue identifiers remain unchanged in the data model and implementation requirements, but must never be shown in operator-facing UI.

## Operator-facing terminology

| Internal identifier | UI text |
|---|---|
| `DUPLICATE_READOUT` | **Redan avläst** |
| `DUPLICATE_ASSIGNMENT` | **Dubblettkoppling** |
| `UNKNOWN_CARD` | **Okänd bricka** |
| `UNLINKED_COMPETITOR` | **Ej kopplad löpare** |
| `CLASS_CONFLICT` | **Klasskonflikt** |
| `WRONG_COMPETITOR` / `RESULT_REASSIGNMENT` | **Fel löpare** |
| `MANUAL_FINISH_REVIEW` | **Manuell måltid kräver granskning** |
| `MP_REVIEW` | **MP-granskning** |

Use the Swedish wording consistently in labels, badges, tooltips, actions, and explanations. For other technical failures, show a concise Swedish description and useful next step rather than the internal issue name.

## Duplicate classifications

- **Redan avläst** (`DUPLICATE_READOUT`) is an informational blue classification. It requires no operator action, creates no Outstanding Issue, remains visible in Readout History, and is reopenable.
- **Dubblettkoppling** (`DUPLICATE_ASSIGNMENT`) is an actionable orange issue while open/in progress and participates in Outstanding Issues.
- A repeated physical read remains a separate history record; replay of the same receipt remains idempotent and updates its existing record.

## Files changed

- `READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V5.md`
- `READOUT_STATUS_COLOR_SPEC_V2.md`
- `READOUT_TERMINOLOGY_UPDATE.md` — this document.

## Verification

- Documentation only; no application code or runtime behavior changed.
- `git diff --check` — passed.
- Build, lint, and application tests were not run because no code changed.
