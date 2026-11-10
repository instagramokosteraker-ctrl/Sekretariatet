import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  declareCompetitorMutation,
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

    expect(info).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledOnce();
  });
});
