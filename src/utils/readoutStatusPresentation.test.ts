import { describe, expect, it } from 'vitest';
import type { ReadoutStatusInput } from './readoutStatusPresentation';
import {
  getReadoutDeliveryBadgeClass,
  getReadoutIssueLabel,
  getReadoutIssueBadgeClass,
  getReadoutIssueSummary,
  getReadoutStatusPresentation,
  getReadoutStatusText,
  getReadoutTimelinePrimaryState,
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

  it('keeps result color independent from open issue presentation', () => {
    expect(
      getReadoutStatusPresentation(
        createStatus({ issueType: 'UNKNOWN_CARD', issueState: 'OPEN' })
      )
    ).toMatchObject({ tone: 'success', surfaceClass: 'bg-emerald-100 dark:bg-emerald-900/60' });
    expect(
      getReadoutStatusPresentation(
        createStatus({
          issueType: 'LOCAL_PERSISTENCE_FAILURE',
          issueState: 'OPEN',
        })
      ).tone
    ).toBe('success');
    expect(
      getReadoutIssueBadgeClass(
        createStatus({ issueType: 'UNKNOWN_CARD', issueState: 'OPEN' })
      )
    ).toContain('bg-orange');
    expect(
      getReadoutIssueBadgeClass(
        createStatus({
          issueType: 'LOCAL_PERSISTENCE_FAILURE',
          issueState: 'OPEN',
        })
      )
    ).toContain('bg-red');
  });

  it('uses the action color for unresolved unknown cards and restores result color after linking', () => {
    const unknownCard = createStatus({
      resultStatus: null,
      readoutState: 'UNKNOWN',
      issueType: 'UNKNOWN_CARD',
      issueState: 'OPEN',
    });

    expect(getReadoutStatusPresentation(unknownCard)).toMatchObject({
      tone: 'action',
      surfaceClass: 'bg-orange-200 dark:bg-orange-900/70',
    });
    expect(getReadoutTimelinePrimaryState(unknownCard)).toBe('Okänd bricka');

    const linkedCard = createStatus({
      resultStatus: 'OK',
      readoutState: 'PROCESSED',
      issueType: 'UNKNOWN_CARD',
      issueState: 'RESOLVED',
    });
    expect(getReadoutStatusPresentation(linkedCard).tone).toBe('success');
    expect(getReadoutTimelinePrimaryState(linkedCard)).toBe('OK');
  });

  it('renders delivery independently of result tone', () => {
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
    expect(getReadoutDeliveryBadgeClass('SYNCED')).toContain('bg-emerald');
    expect(getReadoutDeliveryBadgeClass('QUEUED')).toContain('bg-amber');
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

  it('keeps result status text separate from issue labels and localizes issue state', () => {
    expect(
      getReadoutIssueSummary({
        issueType: 'MP_REVIEW',
        issueState: 'IN_PROGRESS',
      })
    ).toBe('MP-granskning · Pågår');
    expect(
      getReadoutStatusText(
        createStatus({
          resultStatus: 'OK',
          issueType: 'UNKNOWN_CARD',
          issueState: 'OPEN',
        })
      )
    ).toBe('OK');
  });
});
