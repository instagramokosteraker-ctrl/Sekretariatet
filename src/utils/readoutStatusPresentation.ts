import type {
  ReadoutHistoryRecord,
  ReadoutIssueState,
  ReadoutIssueType,
} from '../services/readoutHistoryStore';

export type ReadoutStatusTone =
  | 'success'
  | 'mp'
  | 'action'
  | 'error'
  | 'info'
  | 'neutral';

export type ReadoutStatusInput = Pick<
  ReadoutHistoryRecord,
  'resultStatus' | 'readoutState' | 'issueType' | 'issueState'
>;

const TECHNICAL_ISSUE_TYPES = new Set<ReadoutIssueType>([
  'LOCAL_PERSISTENCE_FAILURE',
  'CORRECTION_FAILURE',
  'SYNC_INTERVENTION_REQUIRED',
  'CORRUPTED_PAYLOAD',
  'UNRECOVERABLE_VALIDATION_FAILURE',
]);

const ISSUE_LABELS: Record<ReadoutIssueType, string> = {
  UNKNOWN_CARD: 'Okänd bricka',
  UNLINKED_COMPETITOR: 'Ej kopplad löpare',
  CLASS_CONFLICT: 'Klasskonflikt',
  DUPLICATE_ASSIGNMENT: 'Dubblettkoppling',
  MANUAL_FINISH_REVIEW: 'Manuell måltid kräver granskning',
  WRONG_COMPETITOR: 'Fel löpare',
  MP_REVIEW: 'MP-granskning',
  LOCAL_PERSISTENCE_FAILURE: 'Kunde inte spara lokalt',
  CORRECTION_FAILURE: 'Korrigeringen misslyckades',
  SYNC_INTERVENTION_REQUIRED: 'Synkronisering kräver åtgärd',
  CORRUPTED_PAYLOAD: 'Avläsningen kunde inte tolkas',
  UNRECOVERABLE_VALIDATION_FAILURE: 'Resultatet kunde inte valideras',
  DUPLICATE_READOUT: 'Redan avläst',
};

const ISSUE_STATE_LABELS: Record<ReadoutIssueState, string | null> = {
  NONE: null,
  OPEN: 'Öppen',
  IN_PROGRESS: 'Pågår',
  RESOLVED: 'Löst',
  DISMISSED: 'Avfärdad',
};

const SURFACE_CLASSES: Record<ReadoutStatusTone, string> = {
  success: 'bg-emerald-50 dark:bg-emerald-950/40',
  mp: 'bg-yellow-50 dark:bg-yellow-950/40',
  action: 'bg-orange-50 dark:bg-orange-950/40',
  error: 'bg-red-50 dark:bg-red-950/40',
  info: 'bg-sky-50 dark:bg-sky-950/40',
  neutral: 'bg-white dark:bg-slate-900',
};

export function getReadoutStatusPresentation(record: ReadoutStatusInput | null): {
  tone: ReadoutStatusTone;
  surfaceClass: string;
} {
  let tone: ReadoutStatusTone = 'neutral';

  if (record) {
    const hasOpenIssue =
      record.issueState === 'OPEN' || record.issueState === 'IN_PROGRESS';

    if (hasOpenIssue) {
      tone =
        record.issueType && TECHNICAL_ISSUE_TYPES.has(record.issueType)
          ? 'error'
          : 'action';
    } else if (
      record.issueType === 'DUPLICATE_READOUT' &&
      record.issueState === 'NONE'
    ) {
      tone = 'info';
    } else if (record.resultStatus === 'MP') {
      tone = 'mp';
    } else if (record.resultStatus === 'OK') {
      tone = 'success';
    }
  }

  return { tone, surfaceClass: SURFACE_CLASSES[tone] };
}

export function getReadoutIssueLabel(
  issueType: ReadoutIssueType | null
): string | null {
  return issueType ? ISSUE_LABELS[issueType] : null;
}

export function getReadoutIssueStateLabel(
  issueState: ReadoutIssueState
): string | null {
  return ISSUE_STATE_LABELS[issueState];
}

export function getReadoutIssueSummary(
  record: Pick<ReadoutHistoryRecord, 'issueType' | 'issueState'>
): string | null {
  const label = getReadoutIssueLabel(record.issueType);
  if (!label) {
    return record.issueState === 'OPEN' || record.issueState === 'IN_PROGRESS'
      ? `Åtgärd krävs · ${getReadoutIssueStateLabel(record.issueState)}`
      : null;
  }

  if (record.issueType === 'DUPLICATE_READOUT') {
    return label;
  }

  const stateLabel = getReadoutIssueStateLabel(record.issueState);
  return stateLabel ? `${label} · ${stateLabel}` : label;
}

export function getReadoutStatusText(record: ReadoutStatusInput): string {
  if (
    record.issueType === 'DUPLICATE_READOUT' &&
    record.issueState === 'NONE'
  ) {
    return 'Redan avläst';
  }

  const resultLabel =
    record.resultStatus ??
    (record.readoutState === 'UNKNOWN' ? 'Okänd bricka' : 'Avläsning sparad');
  const issueSummary = getReadoutIssueSummary(record);

  if (!issueSummary) return resultLabel;
  return record.resultStatus
    ? `${record.resultStatus} · ${issueSummary}`
    : issueSummary;
}

export function getReadoutDeliveryLabel(
  deliveryState: ReadoutHistoryRecord['deliveryState']
): string {
  return {
    PERSISTING: 'Sparar lokalt',
    LOCAL_SAVED: 'Sparad lokalt',
    QUEUED: 'Väntar på synk',
    SYNCED: 'Synkad',
    SAVE_FAILED: 'Sparfel',
  }[deliveryState];
}
