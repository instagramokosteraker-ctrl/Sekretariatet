# Readout Status Color Specification — V2

Date: 2026-11-17

## Status and scope

Design update only. V2 defines full-row/card color coding for **Senaste SI-avläsning**, **Avläsningshistorik**, and **Outstanding Issues**. It updates the status and issue model in [READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V5.md](./READOUT_OVERVIEW_IMPLEMENTATION_PLAN_V5.md).

No application code, styling, or status-processing behavior is implemented by this specification.

## Workstation layout

Keep the V5 workstation order. Apply the status color to the full Latest Readout card and to each complete history/Outstanding Issues row, including its action area:

```text
Avläsning och översikt
┌─────────────────────────────────────────────┐
│ Senaste SI-avläsning — full colored card    │
│ Result and sync status remain distinct      │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ Outstanding Issues — same colored rows      │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ Avläsningshistorik — same colored rows       │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ Competition Overview — below the history    │
└─────────────────────────────────────────────┘
```

Icons may remain as secondary signals. They must not be the only visual status indicator.

## Status and issue model

Keep race result, operator issue, and delivery/synchronization status separate:

- `resultStatus` remains the race outcome (`OK`, `MP`, `PRELIMINARY_FIN`, `DNF`, `DNS`, or unset).
- `issueType` and `issueState` communicate an actionable human/technical issue or an informational duplicate classification.
- Delivery state communicates persistence and synchronization progress. It does not determine result color.

### Human-action issues — orange when open

The following issue types require operator action when `issueState` is `OPEN` or `IN_PROGRESS`:

- `UNKNOWN_CARD`
- `UNLINKED_COMPETITOR`
- `CLASS_CONFLICT`
- `DUPLICATE_ASSIGNMENT`
- `WRONG_COMPETITOR` / `RESULT_REASSIGNMENT`
- `MANUAL_FINISH_REVIEW`
- `MP_REVIEW` (created only by an explicit operator action)

These readouts appear in Outstanding Issues while open/in progress. A resolved or dismissed issue is no longer orange/outstanding; its row returns to the underlying result color.

### Operator-facing terminology

The identifiers are internal data/model values only. Never render them as UI labels, status text, badges, tooltips, or action names.

| Internal classification | User-facing text |
|---|---|
| `DUPLICATE_READOUT` | **Redan avläst** |
| `DUPLICATE_ASSIGNMENT` | **Dubblettkoppling** |
| `UNKNOWN_CARD` | **Okänd bricka** |
| `UNLINKED_COMPETITOR` | **Ej kopplad löpare** |
| `CLASS_CONFLICT` | **Klasskonflikt** |
| `WRONG_COMPETITOR` / `RESULT_REASSIGNMENT` | **Fel löpare** |
| `MANUAL_FINISH_REVIEW` | **Manuell måltid kräver granskning** |
| `MP_REVIEW` | **MP-granskning** |

Use the Swedish text consistently in the Latest Readout card, history rows, Outstanding Issues, action labels, and operator-facing explanations. Explain technical errors in concise Swedish with a useful next step; do not expose their internal issue identifiers.

### Technical/operational errors — red when intervention is required

Represent an intervention-required failure explicitly with an issue type and `issueState=OPEN` or `IN_PROGRESS`, for example:

- `LOCAL_PERSISTENCE_FAILURE`
- `CORRECTION_FAILURE`
- `SYNC_INTERVENTION_REQUIRED`
- `CORRUPTED_PAYLOAD`
- `UNRECOVERABLE_VALIDATION_FAILURE`

These rows are red and participate in Outstanding Issues only while the explicit intervention issue is open/in progress. A transient failure handled by automatic retry does not create an issue or change the result color.

If local persistence fails before a durable record exists, show the captured payload in a red in-memory/recovery row with `LOCAL_PERSISTENCE_FAILURE` and an open issue state. Make the unsaved state explicit; do not claim a durable history record or substitute network delivery. Preserve the payload for recovery and treat it as durable history only after persistence succeeds.

### Informational duplicates — blue

Use `issueType=DUPLICATE_READOUT` with `issueState=NONE` for the informational **Redan avläst** classification. It does not require operator action and is not included in Outstanding Issues by itself. It remains visible in full Readout History and can be reopened like every other readout.

**Redan avläst** is distinct from **Dubblettkoppling** (`DUPLICATE_ASSIGNMENT`): the latter is an actionable human issue and is orange while open/in progress. A duplicate marker must not overwrite an active human or technical issue; when an actionable issue exists, apply its orange/red color.

A repeated physical read remains a separate captured readout with its own `clientReadoutId`, `captureSequence`, and history row. Replaying a receipt for the same `clientReadoutId` is idempotent delivery, not a new duplicate-readout row.

## Color mapping

Use low-saturation, light surface backgrounds in light and dark themes. Preserve readable foreground text. Apply each color to the entire card/row rather than only to an icon, badge, border, or text label.

| Color | Condition | Operator meaning |
|---|---|---|
| 🟢 Green | `resultStatus=OK`, with no active human/technical issue and no informational duplicate marker | Valid result; no operator action required. |
| 🟡 Yellow | `resultStatus=MP`, with no active human/technical issue and no informational duplicate marker | Missing punch; no operator action by default. |
| 🟠 Orange | Human-action `issueType` with `issueState=OPEN` or `IN_PROGRESS` | Operator action required; included in Outstanding Issues. |
| 🔴 Red | Intervention-required technical/operational `issueType` with `issueState=OPEN` or `IN_PROGRESS` | Technical/operational intervention required; included in Outstanding Issues. |
| 🔵 Blue | **Redan avläst** (`DUPLICATE_READOUT`), `issueState=NONE`, and no active intervention issue | Informational only; no operator action; visible/reopenable in Readout History; excluded from Outstanding Issues. |
| Neutral | No mapping above applies, including unclassified results and `PRELIMINARY_FIN`, `DNF`, or `DNS` without an active issue | Do not imply OK, MP, or operator action. |

### Deterministic precedence

If a record has multiple applicable classifications, use this precedence:

1. **Red** — open/in-progress technical or operational intervention.
2. **Orange** — open/in-progress human-action issue.
3. **Blue** — informational duplicate with no active intervention issue.
4. **Yellow** — MP without an active issue.
5. **Green** — OK without an active issue or duplicate classification.
6. **Neutral** — no condition above applies.

Thus, `OK` plus open `WRONG_COMPETITOR` (displayed as **Fel löpare**) is orange; `MP` plus open `MP_REVIEW` (displayed as **MP-granskning**) is orange; and a resolved MP review returns to yellow. Do not change the stored `resultStatus` merely to make a row fit a color.

## Synchronization display

Show synchronization/persistence separately from the result color, using clear text such as:

- **Saved locally**
- **Syncing**
- **Synced**
- **Retry needed**

Examples:

- `resultStatus=OK` plus `Syncing` remains green.
- `resultStatus=MP` plus `Retry needed` remains yellow if retry is automatic and no intervention issue is open.
- `Retry needed` plus `SYNC_INTERVENTION_REQUIRED` in `OPEN`/`IN_PROGRESS` is red; the sync label remains visible separately.
- A local-save or correction failure is red only when represented as an explicit intervention-required issue; an unsaved recovery row is not presented as durable history.

## Surface and accessibility requirements

- Latest Readout colors the whole card without changing its content, ordering, or capture behavior.
- History and Outstanding Issues use the same record-to-color mapping for the complete row.
- Keep status text and optional icons; do not rely on color alone.
- Maintain high text contrast and subtle backgrounds in light and dark modes.
- Preserve visible keyboard focus and selected-row treatment on top of the semantic background.
- Keep sync badges/text visually distinct so they are not mistaken for result color.
- Preserve row click targets, actions, and the ability to read the next SI card while an issue is open.

## Acceptance criteria

- An `OK` readout with no active issue is a full-surface green card/row.
- An ordinary `MP` (`resultStatus=MP`, `issueState=NONE`) is yellow and is not outstanding.
- Explicit **MP-granskning** (`MP_REVIEW`) makes an MP row orange and outstanding without changing `resultStatus=MP`; resolving/dismissing it restores yellow.
- Each listed human-action issue is orange and outstanding while `OPEN`/`IN_PROGRESS`.
- An intervention-required technical error is red and outstanding while its explicit issue is `OPEN`/`IN_PROGRESS`.
- Automatic syncing or retrying alone does not change result color or add an Outstanding Issue; `OK` plus `Syncing` stays green.
- **Redan avläst** (`DUPLICATE_READOUT`) is blue, visible/reopenable in history, requires no action, and is not outstanding; **Dubblettkoppling** (`DUPLICATE_ASSIGNMENT`) is orange when actionable.
- A repeated physical read retains its own history row; replaying the same receipt updates the existing row.
- `PRELIMINARY_FIN`, `DNF`, `DNS`, and otherwise unclassified records remain neutral unless an active issue/error determines a color.
- Latest Readout, history, and Outstanding Issues apply identical color rules with accessible contrast, text/icon cues, focus, selection, and dark-mode support.

## Implementation note

This specification changes design requirements only. Implementation should follow the status and issue model in V5 and preserve the existing capture identity, offline queue, receipts/retries, result validation, Bom calculation, and readout-history behavior.
