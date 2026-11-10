import type { SICardAssignment } from '../types/sportident';

export type CreateSIAssignmentWriteAction =
  | 'CREATE'
  | 'ALREADY_MATCHED'
  | 'SKIP_CONFLICT';

export type RetireSIAssignmentWriteAction =
  | 'CREATE_RETIRED'
  | 'RETIRE'
  | 'ALREADY_RETIRED'
  | 'SKIP_CONFLICT'
  | 'SKIP_VERSION_LIMIT';

export function planCreateSIAssignmentWrite(
  existing: SICardAssignment | null,
  competitorId: string
): CreateSIAssignmentWriteAction {
  if (!existing) return 'CREATE';
  if (
    existing.state === 'ACTIVE' &&
    existing.competitorId === competitorId &&
    existing.competitorDocumentId === competitorId
  ) {
    return 'ALREADY_MATCHED';
  }
  return 'SKIP_CONFLICT';
}

export function planRetireSIAssignmentWrite(
  existing: SICardAssignment | null,
  competitorId: string
): RetireSIAssignmentWriteAction {
  if (!existing) return 'CREATE_RETIRED';
  if (
    existing.competitorId !== competitorId ||
    existing.competitorDocumentId !== competitorId ||
    (existing.state !== 'ACTIVE' && existing.state !== 'RETIRED')
  ) {
    return 'SKIP_CONFLICT';
  }
  if (existing.state === 'RETIRED') return 'ALREADY_RETIRED';
  if (existing.assignmentVersion >= 65535) return 'SKIP_VERSION_LIMIT';
  return 'RETIRE';
}
