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

export interface ReassignSIAssignmentWritePlan {
  oldAssignment: 'RETIRE' | 'ALREADY_RETIRED' | 'MISSING' | 'SKIP_CONFLICT' | 'SKIP_VERSION_LIMIT';
  targetAssignment: 'CREATE' | 'ACTIVATE' | 'ALREADY_MATCHED' | 'COLLISION' | 'SKIP_CONFLICT';
  conflict: boolean;
}

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

export function planReassignSIAssignmentWrite(
  current: SICardAssignment | null,
  target: SICardAssignment | null,
  competitorId: string
): ReassignSIAssignmentWritePlan {
  let oldAssignment: ReassignSIAssignmentWritePlan['oldAssignment'];
  if (!current) {
    oldAssignment = 'MISSING';
  } else if (
    current.competitorId !== competitorId ||
    current.competitorDocumentId !== competitorId
  ) {
    oldAssignment = 'SKIP_CONFLICT';
  } else if (current.state === 'RETIRED') {
    oldAssignment = 'ALREADY_RETIRED';
  } else if (current.state !== 'ACTIVE') {
    oldAssignment = 'SKIP_CONFLICT';
  } else if (current.assignmentVersion >= 65535) {
    oldAssignment = 'SKIP_VERSION_LIMIT';
  } else {
    oldAssignment = 'RETIRE';
  }

  let targetAssignment: ReassignSIAssignmentWritePlan['targetAssignment'];
  if (!target) {
    targetAssignment = 'CREATE';
  } else if (
    target.competitorId === competitorId &&
    target.competitorDocumentId === competitorId &&
    target.state === 'ACTIVE'
  ) {
    targetAssignment = 'ALREADY_MATCHED';
  } else if (target.state === 'RETIRED' && target.assignmentVersion < 65535) {
    targetAssignment = 'ACTIVATE';
  } else if (target.state === 'ACTIVE') {
    targetAssignment = 'COLLISION';
  } else {
    targetAssignment = 'SKIP_CONFLICT';
  }

  return {
    oldAssignment,
    targetAssignment,
    conflict:
      oldAssignment === 'SKIP_CONFLICT' ||
      oldAssignment === 'SKIP_VERSION_LIMIT' ||
      targetAssignment === 'COLLISION' ||
      targetAssignment === 'SKIP_CONFLICT',
  };
}
