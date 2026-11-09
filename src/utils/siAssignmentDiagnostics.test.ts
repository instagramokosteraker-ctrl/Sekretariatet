import { afterEach, describe, expect, it, vi } from 'vitest';
import { declareCompetitorMutation } from './siAssignmentDiagnostics';

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
});
