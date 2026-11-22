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

const ISSUE_LABELS: Record<ReadoutIssueType, string> = {
  UNKNOWN_CARD: 'Okänd bricka',
  UNLINKED_COMPETITOR: 'Ej kopplad löpare',
  CLASS_CONFLICT: 'Klasskonflikt',
  DUPLICATE_ASSIGNMENT: 'Dubblettkoppling',
  MANUAL_FINISH_REVIEW: 'Manuell måltid kräver granskning',
  MANUAL_RESULT_APPROVAL: 'Manuell godkännande av resultat',
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
  OPEN: null,
  IN_PROGRESS: 'Pågår',
  RESOLVED: 'Löst',
  DISMISSED: 'Avfärdad',
};

const SURFACE_CLASSES: Record<ReadoutStatusTone, string> = {
  success: 'bg-emerald-100 dark:bg-emerald-900/60',
  mp: 'bg-yellow-100 dark:bg-yellow-900/60',
  action: 'bg-orange-200 dark:bg-orange-900/70',
  error: 'bg-red-100 dark:bg-red-900/60',
  info: 'bg-sky-100 dark:bg-sky-900/60',
  neutral: 'bg-white dark:bg-slate-900',
};

export function getReadoutIssueBadgeClass(record: ReadoutStatusInput): string {
  if (record.issueState === 'OPEN' || record.issueState === 'IN_PROGRESS') {
    return record.issueType &&
      [
        'LOCAL_PERSISTENCE_FAILURE',
        'CORRECTION_FAILURE',
        'SYNC_INTERVENTION_REQUIRED',
        'CORRUPTED_PAYLOAD',
        'UNRECOVERABLE_VALIDATION_FAILURE',
      ].includes(record.issueType)
      ? 'bg-red-200 text-red-900 dark:bg-red-950/70 dark:text-red-200'
      : 'bg-orange-200 text-orange-900 dark:bg-orange-950/70 dark:text-orange-200';
  }
  if (record.issueType === 'DUPLICATE_READOUT') {
    return 'bg-sky-200 text-sky-900 dark:bg-sky-950/70 dark:text-sky-200';
  }
  return 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
}

export function getReadoutDeliveryBadgeClass(
  deliveryState: ReadoutHistoryRecord['deliveryState']
): string {
  if (deliveryState === 'SYNCED') {
    return 'bg-emerald-200 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200';
  }
  if (deliveryState === 'SAVE_FAILED') {
    return 'bg-red-200 text-red-900 dark:bg-red-950/70 dark:text-red-200';
  }
  if (deliveryState === 'QUEUED' || deliveryState === 'PERSISTING') {
    return 'bg-amber-200 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200';
  }
  return 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
}

export function getReadoutStatusPresentation(record: ReadoutStatusInput | null): {
  tone: ReadoutStatusTone;
  surfaceClass: string;
} {
  let tone: ReadoutStatusTone = 'neutral';

  if (record) {
    if (record.resultStatus === 'MP') {
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
  if (issueState === 'OPEN') return 'Åtgärd krävs';
  return ISSUE_STATE_LABELS[issueState];
}

export function getReadoutIssueSummary(
  record: Pick<ReadoutHistoryRecord, 'issueType' | 'issueState'>
): string | null {
  const label = getReadoutIssueLabel(record.issueType);
  if (!label) {
    if (record.issueState === 'OPEN') return 'Åtgärd krävs';
    if (record.issueState === 'IN_PROGRESS') {
      return `Åtgärd krävs · ${getReadoutIssueStateLabel(record.issueState)}`;
    }
    return null;
  }

  if (record.issueType === 'DUPLICATE_READOUT') {
    return label;
  }

  if (record.issueState === 'OPEN') {
    return label;
  }

  const stateLabel = getReadoutIssueStateLabel(record.issueState);
  return stateLabel ? `${label} · ${stateLabel}` : label;
}

export function getReadoutStatusText(record: ReadoutStatusInput): string {
  return (
    record.resultStatus ??
    (record.readoutState === 'UNKNOWN' ? 'Okänd bricka' : 'Avläsning sparad')
  );
}

export function getReadoutTimelinePrimaryState(
  record: ReadoutStatusInput
): string {
  if (record.issueType === 'DUPLICATE_READOUT') return 'Redan avläst';
  return getReadoutStatusText(record);
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
