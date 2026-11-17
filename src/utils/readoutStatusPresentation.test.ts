import { describe, expect, it } from 'vitest';
import type { ReadoutStatusInput } from './readoutStatusPresentation';
import {
  getReadoutIssueLabel,
  getReadoutIssueSummary,
  getReadoutStatusPresentation,
  getReadoutStatusText,
} from './readoutStatusPresentation';

function createStatus(
  overrides: Partial<ReadoutStatusInput> = {}
): ReadoutStatusInput {
  return {
    resultStatus: 'OK',
    readoutState: 'PROCESSED',
    issueType: null,
    issueState: 'NONE',
    ...overrides,
  };
}

describe('readout status presentation', () => {
  it('uses the result for ordinary OK and MP readouts', () => {
    expect(getReadoutStatusPresentation(createStatus()).tone).toBe('success');
    expect(
      getReadoutStatusPresentation(createStatus({ resultStatus: 'MP' })).tone
    ).toBe('mp');
  });

  it('uses orange for human issues and red for technical issues requiring action', () => {
    expect(
      getReadoutStatusPresentation(
        createStatus({ issueType: 'UNKNOWN_CARD', issueState: 'OPEN' })
      ).tone
    ).toBe('action');
    expect(
      getReadoutStatusPresentation(
        createStatus({
          issueType: 'LOCAL_PERSISTENCE_FAILURE',
          issueState: 'OPEN',
        })
      ).tone
    ).toBe('error');
  });

  it('shows duplicate readouts as informational blue unless an issue is open', () => {
    expect(
      getReadoutStatusPresentation(
        createStatus({ issueType: 'DUPLICATE_READOUT' })
      ).tone
    ).toBe('info');
    expect(
      getReadoutStatusPresentation(
        createStatus({
          issueType: 'DUPLICATE_READOUT',
          issueState: 'OPEN',
        })
      ).tone
    ).toBe('action');
    expect(
      getReadoutStatusText(
        createStatus({ issueType: 'DUPLICATE_READOUT' })
      )
    ).toBe('Redan avläst');
  });

  it('keeps synchronization state independent from the row tone', () => {
    const queued = {
      ...createStatus(),
      deliveryState: 'QUEUED' as const,
    };
    const synced = {
      ...createStatus(),
      deliveryState: 'SYNCED' as const,
    };

    expect(getReadoutStatusPresentation(queued)).toEqual(
      getReadoutStatusPresentation(synced)
    );
    expect(getReadoutStatusPresentation(queued).tone).toBe('success');
  });

  it('returns to the result tone after an issue is resolved and keeps finish-only statuses neutral', () => {
    expect(
      getReadoutStatusPresentation(
        createStatus({ issueType: 'UNKNOWN_CARD', issueState: 'RESOLVED' })
      ).tone
    ).toBe('success');
    expect(
      getReadoutStatusPresentation(
        createStatus({ resultStatus: 'DNF' })
      ).tone
    ).toBe('neutral');
  });

  it.each([
    ['DUPLICATE_READOUT', 'Redan avläst'],
    ['DUPLICATE_ASSIGNMENT', 'Dubblettkoppling'],
    ['UNKNOWN_CARD', 'Okänd bricka'],
    ['UNLINKED_COMPETITOR', 'Ej kopplad löpare'],
    ['CLASS_CONFLICT', 'Klasskonflikt'],
    ['WRONG_COMPETITOR', 'Fel löpare'],
    ['MANUAL_FINISH_REVIEW', 'Manuell måltid kräver granskning'],
    ['MP_REVIEW', 'MP-granskning'],
  ] as const)(
    'localizes %s as %s',
    (issueType, label) => {
      expect(getReadoutIssueLabel(issueType)).toBe(label);
    }
  );

  it('localizes issue states and unknown-card status text', () => {
    expect(
      getReadoutIssueSummary({
        issueType: 'MP_REVIEW',
        issueState: 'IN_PROGRESS',
      })
    ).toBe('MP-granskning · Pågår');
    expect(
      getReadoutStatusText(
        createStatus({
          resultStatus: null,
          readoutState: 'UNKNOWN',
          issueType: 'UNKNOWN_CARD',
          issueState: 'OPEN',
        })
      )
    ).toBe('Okänd bricka · Öppen');
  });
});
