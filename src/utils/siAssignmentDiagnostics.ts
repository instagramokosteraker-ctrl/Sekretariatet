export type SIAssignmentBypassOperation =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'IMPORT'
  | 'RESTORE'
  | 'SNAPSHOT_EXPORT'
  | 'SNAPSHOT_HYDRATE'
  | 'SNAPSHOT_SEED';

export interface SIAssignmentBypassDiagnostic {
  source: string;
  operation: SIAssignmentBypassOperation;
  competitionId: string;
  competitorId?: string;
  siNumber?: number;
  previousSiNumber?: number;
  detail?: string;
}

export function logSIAssignmentBypass(
  diagnostic: SIAssignmentBypassDiagnostic
): void {
  console.warn(
    `[si-assignment-bypass] ${JSON.stringify({
      ...diagnostic,
      assignmentAware: false,
      enforcementActive: false,
    })}`
  );
}
