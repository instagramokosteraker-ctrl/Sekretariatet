import { describe, expect, it, vi } from 'vitest';
import {
  inspectSIAssignmentRuleMutations,
  logSIAssignmentRuleDiagnostics,
  type SIAssignmentRuleMutation,
} from './siAssignmentRuleDiagnostics';

const competitor = (siNumber: number, status = 'REGISTERED') => ({
  competitionId: 'evt_test',
  competitorId: 'cmp_test',
  siNumber,
  status,
});

const assignment = (
  siNumber: number,
  state: 'ACTIVE' | 'RETIRED' = 'ACTIVE'
) => ({
  competitionId: 'evt_test',
  siNumber,
  competitorId: 'cmp_test',
  state,
});

describe('SI assignment Firestore-rule diagnostics', () => {
  it('accepts a matching SI reassignment batch without warnings', () => {
    const mutations: SIAssignmentRuleMutation[] = [
      {
        collection: 'competitors',
        operation: 'update',
        before: competitor(12345),
        after: competitor(67890),
      },
      {
        collection: 'siCardAssignments',
        operation: 'update',
        before: assignment(12345),
        after: assignment(12345, 'RETIRED'),
      },
      {
        collection: 'siCardAssignments',
        operation: 'create',
        after: assignment(67890),
      },
    ];

    expect(inspectSIAssignmentRuleMutations(mutations)).toEqual([]);
  });

  it('detects a competitor SI update that has no assignment changes', () => {
    const diagnostics = inspectSIAssignmentRuleMutations([
      {
        collection: 'competitors',
        operation: 'update',
        before: competitor(12345),
        after: competitor(67890),
      },
    ]);

    expect(diagnostics.map(({ code }) => code)).toEqual([
      'COMPETITOR_SI_UPDATE_WITHOUT_ASSIGNMENT_CHANGE',
    ]);
  });

  it('detects assignment writes without a matching competitor mutation', () => {
    const diagnostics = inspectSIAssignmentRuleMutations([
      {
        collection: 'siCardAssignments',
        operation: 'update',
        before: assignment(12345),
        after: assignment(12345, 'RETIRED'),
      },
    ]);

    expect(diagnostics.map(({ code }) => code)).toEqual([
      'ASSIGNMENT_UPDATE_WITHOUT_COMPETITOR_CHANGE',
    ]);
  });

  it('detects a mismatched reassignment batch and an assignment deletion', () => {
    const diagnostics = inspectSIAssignmentRuleMutations([
      {
        collection: 'competitors',
        operation: 'update',
        before: competitor(12345),
        after: competitor(67890),
      },
      {
        collection: 'siCardAssignments',
        operation: 'update',
        before: assignment(12345),
        after: assignment(12345, 'RETIRED'),
      },
      {
        collection: 'siCardAssignments',
        operation: 'create',
        after: assignment(99999),
      },
      {
        collection: 'siCardAssignments',
        operation: 'delete',
        before: assignment(54321),
      },
    ]);

    expect(diagnostics.map(({ code }) => code)).toEqual([
      'COMPETITOR_SI_UPDATE_WITHOUT_ASSIGNMENT_CHANGE',
      'ASSIGNMENT_UPDATE_WITHOUT_COMPETITOR_CHANGE',
      'ASSIGNMENT_DELETE_WITHOUT_RETIREMENT_FLOW',
    ]);
  });

  it('logs diagnostics as warnings without activating enforcement', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const diagnostics = inspectSIAssignmentRuleMutations([
      {
        collection: 'siCardAssignments',
        operation: 'delete',
        before: assignment(12345),
      },
    ]);

    logSIAssignmentRuleDiagnostics(diagnostics);

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('"enforcementActive":false')
    );
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('ASSIGNMENT_DELETE_WITHOUT_RETIREMENT_FLOW')
    );
  });
});
