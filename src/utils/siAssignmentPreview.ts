export type AtomicSIAssignmentMutationIntent =
  | 'CREATE_COMPETITOR'
  | 'UPDATE_COMPETITOR_IDENTITY'
  | 'CHANGE_SI_NUMBER'
  | 'RETIRE_COMPETITOR'
  | 'DELETE_COMPETITOR';

export type SIAssignmentPreviewMutation =
  | 'NONE'
  | 'CREATE'
  | 'REASSIGN'
  | 'RETIRE';

export interface SIAssignmentPreviewMetrics {
  operations: number;
  wouldSucceed: number;
  wouldBeBlocked: number;
  wouldRequireReassignment: number;
  wouldRequireRetirement: number;
}

export interface SIAssignmentPreviewPlan {
  assignmentExists: boolean;
  assignmentMismatch: boolean;
  assignmentMissing: boolean;
  duplicateCandidate: boolean;
  reassignmentRequired: boolean;
  retirementRequired: boolean;
  wouldSucceed: boolean;
  wouldBeBlocked: boolean;
  blockers: string[];
  assignmentMutation: {
    operation: SIAssignmentPreviewMutation;
    fromSiNumber: number | null;
    toSiNumber: number | null;
  };
  competitorMutation: {
    operation: 'CREATE' | 'UPDATE' | 'RETIRE' | 'DELETE';
    wouldSucceed: boolean;
  };
}

export interface SIAssignmentPreviewInput {
  intent: AtomicSIAssignmentMutationIntent;
  competitionExists: boolean;
  competitorExists: boolean;
  currentSiNumber: number | null;
  requestedSiNumber: number | null;
  assignmentExists: boolean;
  assignmentMissing: boolean;
  currentAssignmentMissing: boolean;
  assignmentMismatch: boolean;
  duplicateCandidate: boolean;
  duplicateCandidateQueryFailed: boolean;
}

export function buildSIAssignmentPreviewPlan(
  input: SIAssignmentPreviewInput
): SIAssignmentPreviewPlan {
  const reassignmentRequired =
    input.intent === 'CHANGE_SI_NUMBER' &&
    isValidSiNumber(input.currentSiNumber) &&
    isValidSiNumber(input.requestedSiNumber) &&
    input.currentSiNumber !== input.requestedSiNumber;
  const retirementRequired =
    (input.intent === 'RETIRE_COMPETITOR' || input.intent === 'DELETE_COMPETITOR') &&
    isValidSiNumber(input.currentSiNumber);
  const blockers: string[] = [];

  if (!input.competitionExists) blockers.push('MISSING_COMPETITION');
  if (!input.competitorExists && input.intent !== 'CREATE_COMPETITOR') {
    blockers.push('MISSING_COMPETITOR');
  }
  if (input.assignmentMismatch) blockers.push('ASSIGNMENT_MISMATCH');
  if (
    (input.intent === 'CREATE_COMPETITOR' || input.intent === 'CHANGE_SI_NUMBER') &&
    !isValidSiNumber(input.requestedSiNumber)
  ) {
    blockers.push('INVALID_SI_NUMBER');
  }
  if (
    input.currentAssignmentMissing &&
    input.intent !== 'CREATE_COMPETITOR' &&
    isValidSiNumber(input.currentSiNumber)
  ) {
    blockers.push('ASSIGNMENT_MISSING');
  }
  if (input.intent === 'CREATE_COMPETITOR' && input.competitorExists) {
    blockers.push('COMPETITOR_ALREADY_EXISTS');
  }
  if (input.duplicateCandidate) blockers.push('DUPLICATE_CANDIDATE');
  if (input.duplicateCandidateQueryFailed) {
    blockers.push('DUPLICATE_CANDIDATE_QUERY_FAILED');
  }

  const wouldBeBlocked = blockers.length > 0;
  const assignmentMutation: SIAssignmentPreviewMutation =
    input.intent === 'CREATE_COMPETITOR'
      ? 'CREATE'
      : reassignmentRequired
        ? 'REASSIGN'
        : retirementRequired
          ? 'RETIRE'
          : 'NONE';
  const competitorMutation =
    input.intent === 'CREATE_COMPETITOR'
      ? 'CREATE'
      : input.intent === 'RETIRE_COMPETITOR'
        ? 'RETIRE'
        : input.intent === 'DELETE_COMPETITOR'
          ? 'DELETE'
          : 'UPDATE';

  return {
    assignmentExists: input.assignmentExists,
    assignmentMismatch: input.assignmentMismatch,
    assignmentMissing: input.assignmentMissing,
    duplicateCandidate: input.duplicateCandidate,
    reassignmentRequired,
    retirementRequired,
    wouldSucceed: !wouldBeBlocked,
    wouldBeBlocked,
    blockers,
    assignmentMutation: {
      operation: assignmentMutation,
      fromSiNumber: reassignmentRequired || retirementRequired ? input.currentSiNumber : null,
      toSiNumber:
        assignmentMutation === 'CREATE' || reassignmentRequired
          ? input.requestedSiNumber
          : null,
    },
    competitorMutation: {
      operation: competitorMutation,
      wouldSucceed: !wouldBeBlocked,
    },
  };
}

export function createSIAssignmentPreviewMetrics(): SIAssignmentPreviewMetrics {
  return {
    operations: 0,
    wouldSucceed: 0,
    wouldBeBlocked: 0,
    wouldRequireReassignment: 0,
    wouldRequireRetirement: 0,
  };
}

export function accumulateSIAssignmentPreviewMetrics(
  metrics: SIAssignmentPreviewMetrics,
  plan: SIAssignmentPreviewPlan
): SIAssignmentPreviewMetrics {
  return {
    operations: metrics.operations + 1,
    wouldSucceed: metrics.wouldSucceed + Number(plan.wouldSucceed),
    wouldBeBlocked: metrics.wouldBeBlocked + Number(plan.wouldBeBlocked),
    wouldRequireReassignment:
      metrics.wouldRequireReassignment + Number(plan.reassignmentRequired),
    wouldRequireRetirement:
      metrics.wouldRequireRetirement + Number(plan.retirementRequired),
  };
}

function isValidSiNumber(value: number | null): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}
