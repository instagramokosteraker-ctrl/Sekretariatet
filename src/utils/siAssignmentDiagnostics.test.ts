import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  declareCompetitorMutation,
  runAssignmentAwareCompetitorMutation,
  runCompetitorMutation,
  runCompetitorMutations,
} from './siAssignmentDiagnostics';

describe('competitor mutation declaration boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records legacy identity mutations as bypasses without blocking them', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = declareCompetitorMutation({
      source: 'test import',
      operation: 'IMPORT',
      competitionId: 'evt_test',
      competitorId: 'cmp_test',
      siNumber: 12345,
      assignmentHandling: { mode: 'LEGACY', reason: 'Existing import path.' },
      identityAffecting: true,
    });

    expect(result).toEqual({ allowed: true });
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('[si-assignment-bypass]')
    );
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"enforcementActive":false'));
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('"enforcementReadiness":"PRE_ENFORCEMENT"')
    );
  });

  it('warns when a legacy SI change has no assignment counterpart', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      declareCompetitorMutation({
        source: 'test legacy SI change',
        operation: 'UPDATE',
        competitionId: 'evt_test',
        competitorId: 'cmp_test',
        previousSiNumber: 12345,
        siNumber: 67890,
        assignmentHandling: { mode: 'LEGACY', reason: 'Unmigrated writer.' },
        identityAffecting: true,
      })
    ).toEqual({ allowed: true });

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('COMPETITOR_SI_UPDATE_WITHOUT_ASSIGNMENT_CHANGE')
    );
  });

  it('records non-identity legacy writes without reporting an SI assignment bypass', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const result = declareCompetitorMutation({
      source: 'test status update',
      operation: 'UPDATE',
      competitionId: 'evt_test',
      competitorId: 'cmp_test',
      siNumber: 12345,
      assignmentHandling: { mode: 'LEGACY', reason: 'Status does not change SI identity.' },
      identityAffecting: false,
    });

    expect(result).toEqual({ allowed: true });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('[competitor-mutation]'));
    expect(warning).not.toHaveBeenCalled();
  });

  it('accepts a matching assignment-validation declaration without bypass warning', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = declareCompetitorMutation({
      source: 'test validated create',
      operation: 'CREATE',
      competitionId: 'evt_test',
      competitorId: 'cmp_test',
      siNumber: 12345,
      assignmentHandling: {
        mode: 'VALIDATED',
        validatedSiNumber: 12345,
        assignmentVersion: 1,
      },
      identityAffecting: true,
    });

    expect(result).toEqual({ allowed: true });
    expect(warning).not.toHaveBeenCalled();
  });

  it('declares a mutation before executing its writer and continues to allow it', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const write = vi.fn(() => 'written');

    expect(
      runCompetitorMutation(
        {
          source: 'test create',
          operation: 'CREATE',
          competitionId: 'evt_test',
          competitorId: 'cmp_test',
          siNumber: 12345,
          assignmentHandling: { mode: 'LEGACY', reason: 'Pre-enforcement test.' },
          identityAffecting: true,
        },
        write
      )
    ).toBe('written');
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('"mutationBoundary":"CENTRALIZED"')
    );
    expect(write).toHaveBeenCalledOnce();
  });

  it('declares a batch of mutations before running the shared writer', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const write = vi.fn();
    const declaration = {
      source: 'test import',
      operation: 'IMPORT' as const,
      competitionId: 'evt_test',
      assignmentHandling: { mode: 'LEGACY' as const, reason: 'Pre-enforcement test.' },
      identityAffecting: true,
    };

    runCompetitorMutations([declaration, declaration], write);

    expect(
      info.mock.calls.filter(([message]) =>
        String(message).includes('[competitor-mutation-service]')
      )
    ).toHaveLength(2);
    expect(
      info.mock.calls.filter(([message]) => String(message).includes('[competitor-mutation]'))
    ).toHaveLength(2);
    expect(write).toHaveBeenCalledOnce();
  });

  it('logs assignment-aware routing, runs validation hooks, and still allows the write', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hook = vi.fn(() => ({ passed: false, detail: 'Duplicate checks are not enforced yet.' }));
    const write = vi.fn(() => 'written');

    expect(
      runAssignmentAwareCompetitorMutation(
        {
          declaration: {
            source: 'test SI reassignment',
            operation: 'UPDATE',
            competitionId: 'evt_test',
            competitorId: 'cmp_test',
            siNumber: 54321,
            previousSiNumber: 12345,
            assignmentHandling: {
              mode: 'LEGACY',
              reason: 'Assignment state is observed but not written in this phase.',
            },
            identityAffecting: true,
          },
          intent: 'CHANGE_SI_NUMBER',
          assignment: {
            mode: 'ASSIGNMENT_AWARE',
            currentSiNumber: 12345,
            requestedSiNumber: 54321,
            assignmentId: '54321',
            validationState: 'READ_ONLY',
          },
          competitor: {
            competitionId: 'evt_test',
            competitorId: 'cmp_test',
            currentSiNumber: 12345,
            proposedSiNumber: 54321,
          },
          validationHooks: [{ name: 'future-duplicate-check', validate: hook }],
        },
        write
      )
    ).toBe('written');

    expect(hook).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('[competitor-mutation-validation]')
    );
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('"assignmentAwarePathUsed":true')
    );
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"legacyPathBypassed":false'));
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('"legacyAssignmentWritePending":true')
    );
    expect(write).toHaveBeenCalledOnce();
  });

  it('logs that legacy assignment handling remains when a routed writer has no assignment context', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    runCompetitorMutation(
      {
        source: 'test legacy writer',
        operation: 'DELETE',
        competitionId: 'evt_test',
        competitorId: 'cmp_test',
        siNumber: 12345,
        assignmentHandling: { mode: 'LEGACY', reason: 'No assignment operations in this phase.' },
        identityAffecting: true,
      },
      () => undefined
    );

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('"assignmentAwarePathUsed":false')
    );
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"legacyPathBypassed":true'));
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('"legacyAssignmentWritePending":true')
    );
  });
});
