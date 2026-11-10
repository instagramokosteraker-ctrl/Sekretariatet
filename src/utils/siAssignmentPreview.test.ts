import { describe, expect, it } from 'vitest';
import {
  accumulateSIAssignmentPreviewMetrics,
  buildSIAssignmentPreviewPlan,
  createSIAssignmentPreviewMetrics,
} from './siAssignmentPreview';

describe('SI assignment mutation preview', () => {
  it('previews a valid create without blocking for the expected missing assignment', () => {
    const plan = buildSIAssignmentPreviewPlan({
      intent: 'CREATE_COMPETITOR',
      competitionExists: true,
      competitorExists: false,
      currentSiNumber: null,
      requestedSiNumber: 12345,
      assignmentExists: false,
      assignmentMissing: true,
      currentAssignmentMissing: false,
      assignmentMismatch: false,
      duplicateCandidate: false,
      duplicateCandidateQueryFailed: false,
    });

    expect(plan.wouldSucceed).toBe(true);
    expect(plan.wouldBeBlocked).toBe(false);
    expect(plan.assignmentMutation).toEqual({
      operation: 'CREATE',
      fromSiNumber: null,
      toSiNumber: 12345,
    });
  });

  it('identifies conflicts as would-block without rejecting the operation', () => {
    const plan = buildSIAssignmentPreviewPlan({
      intent: 'CREATE_COMPETITOR',
      competitionExists: true,
      competitorExists: false,
      currentSiNumber: null,
      requestedSiNumber: 12345,
      assignmentExists: true,
      assignmentMissing: false,
      currentAssignmentMissing: false,
      assignmentMismatch: true,
      duplicateCandidate: true,
      duplicateCandidateQueryFailed: false,
    });

    expect(plan.wouldBeBlocked).toBe(true);
    expect(plan.blockers).toEqual(['ASSIGNMENT_MISMATCH', 'DUPLICATE_CANDIDATE']);
    expect(plan.assignmentMutation.operation).toBe('CREATE');
  });

  it('does not count an unavailable duplicate scan as a successful preview', () => {
    const plan = buildSIAssignmentPreviewPlan({
      intent: 'CREATE_COMPETITOR',
      competitionExists: true,
      competitorExists: false,
      currentSiNumber: null,
      requestedSiNumber: 12345,
      assignmentExists: false,
      assignmentMissing: true,
      currentAssignmentMissing: false,
      assignmentMismatch: false,
      duplicateCandidate: false,
      duplicateCandidateQueryFailed: true,
    });

    expect(plan.wouldBeBlocked).toBe(true);
    expect(plan.blockers).toContain('DUPLICATE_CANDIDATE_QUERY_FAILED');
  });

  it('prepares reassignment and retirement plans', () => {
    const reassignment = buildSIAssignmentPreviewPlan({
      intent: 'CHANGE_SI_NUMBER',
      competitionExists: true,
      competitorExists: true,
      currentSiNumber: 12345,
      requestedSiNumber: 67890,
      assignmentExists: true,
      assignmentMissing: true,
      currentAssignmentMissing: false,
      assignmentMismatch: false,
      duplicateCandidate: false,
      duplicateCandidateQueryFailed: false,
    });
    const deletion = buildSIAssignmentPreviewPlan({
      intent: 'DELETE_COMPETITOR',
      competitionExists: true,
      competitorExists: true,
      currentSiNumber: 12345,
      requestedSiNumber: 12345,
      assignmentExists: true,
      assignmentMissing: false,
      currentAssignmentMissing: false,
      assignmentMismatch: false,
      duplicateCandidate: false,
      duplicateCandidateQueryFailed: false,
    });

    expect(reassignment.reassignmentRequired).toBe(true);
    expect(reassignment.assignmentMutation).toEqual({
      operation: 'REASSIGN',
      fromSiNumber: 12345,
      toSiNumber: 67890,
    });
    expect(deletion.retirementRequired).toBe(true);
    expect(deletion.assignmentMutation).toEqual({
      operation: 'RETIRE',
      fromSiNumber: 12345,
      toSiNumber: null,
    });
  });

  it('simulates blocking reassignment when its current assignment is missing', () => {
    const plan = buildSIAssignmentPreviewPlan({
      intent: 'CHANGE_SI_NUMBER',
      competitionExists: true,
      competitorExists: true,
      currentSiNumber: 12345,
      requestedSiNumber: 67890,
      assignmentExists: false,
      assignmentMissing: true,
      currentAssignmentMissing: true,
      assignmentMismatch: false,
      duplicateCandidate: false,
      duplicateCandidateQueryFailed: false,
    });

    expect(plan.wouldBeBlocked).toBe(true);
    expect(plan.blockers).toContain('ASSIGNMENT_MISSING');
    expect(plan.assignmentMutation.operation).toBe('REASSIGN');
  });

  it('counts simulated outcomes and required assignment changes', () => {
    const succeedingPlan = buildSIAssignmentPreviewPlan({
      intent: 'CHANGE_SI_NUMBER',
      competitionExists: true,
      competitorExists: true,
      currentSiNumber: 12345,
      requestedSiNumber: 67890,
      assignmentExists: true,
      assignmentMissing: true,
      currentAssignmentMissing: false,
      assignmentMismatch: false,
      duplicateCandidate: false,
      duplicateCandidateQueryFailed: false,
    });
    const retirementPlan = buildSIAssignmentPreviewPlan({
      intent: 'DELETE_COMPETITOR',
      competitionExists: true,
      competitorExists: true,
      currentSiNumber: 12345,
      requestedSiNumber: 12345,
      assignmentExists: false,
      assignmentMissing: true,
      currentAssignmentMissing: true,
      assignmentMismatch: false,
      duplicateCandidate: false,
      duplicateCandidateQueryFailed: false,
    });

    const metrics = accumulateSIAssignmentPreviewMetrics(
      accumulateSIAssignmentPreviewMetrics(createSIAssignmentPreviewMetrics(), succeedingPlan),
      retirementPlan
    );

    expect(metrics).toEqual({
      operations: 2,
      wouldSucceed: 2,
      wouldBeBlocked: 0,
      wouldRequireReassignment: 1,
      wouldRequireRetirement: 1,
    });
  });
});
