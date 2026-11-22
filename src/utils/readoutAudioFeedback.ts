import type { RunnerStatus } from '../types/sportident';

export type ReadoutFeedbackTone = 'registration' | 'ok' | 'mp';

export function getReadoutFeedbackTone(input: {
  queuedOffline: boolean;
  duplicateReadout: boolean;
  unknownCardReadout: boolean;
  resultStatus: RunnerStatus | null;
}): ReadoutFeedbackTone | null {
  if (input.queuedOffline) return 'registration';
  if (input.duplicateReadout) return null;
  if (input.unknownCardReadout) return 'mp';
  if (input.resultStatus === null) return null;
  return input.resultStatus === 'OK' ? 'ok' : 'mp';
}
