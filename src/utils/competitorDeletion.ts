import type { RunnerStatus } from '../types/sportident';

export type CompetitorDeletionReasonCode =
  | 'DUPLICATE_REGISTRATION'
  | 'INCORRECT_IMPORT'
  | 'TEST_DATA'
  | 'OTHER';

export interface CompetitorDeletionImpact {
  hasHistory: boolean;
  reasons: string[];
  readoutCount: number;
  receiptCount: number;
  radioPassageCount: number;
  hasManualFinish: boolean;
  status: RunnerStatus;
}

export function buildCompetitorDeletionImpact(input: {
  status: RunnerStatus;
  readoutCount: number;
  receiptCount: number;
  radioPassageCount: number;
  hasManualFinish: boolean;
  hasLocalReadout: boolean;
}): CompetitorDeletionImpact {
  const reasons: string[] = [];
  if (input.readoutCount > 0 || input.hasLocalReadout) reasons.push('Avläsningar');
  if (input.receiptCount > 0) reasons.push('Kvitton');
  if (input.radioPassageCount > 0) reasons.push('Radiopassager');
  if (input.hasManualFinish) reasons.push('Manuell måltid');
  if (
    ['CHECKED', 'IN_FOREST', 'PRELIMINARY_FIN', 'OK', 'MP', 'DNF', 'DNS'].includes(
      input.status
    )
  ) {
    reasons.push(`Tävlingsstatus ${input.status}`);
  }
  return {
    hasHistory: reasons.length > 0,
    reasons,
    readoutCount: input.readoutCount + Number(input.hasLocalReadout),
    receiptCount: input.receiptCount,
    radioPassageCount: input.radioPassageCount,
    hasManualFinish: input.hasManualFinish,
    status: input.status,
  };
}
