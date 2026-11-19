import { describe, expect, it } from 'vitest';
import { buildCompetitorDeletionImpact } from './competitorDeletion';

describe('buildCompetitorDeletionImpact', () => {
  it('allows ordinary pre-start competitors without history to use the simple confirmation', () => {
    expect(
      buildCompetitorDeletionImpact({
        status: 'REGISTERED',
        readoutCount: 0,
        receiptCount: 0,
        radioPassageCount: 0,
        hasManualFinish: false,
        hasLocalReadout: false,
      }).hasHistory
    ).toBe(false);
  });

  it('requires the history warning for results, manual finishes, receipts and local readouts', () => {
    const cases = [
      { status: 'OK' as const },
      { status: 'IN_FOREST' as const },
      { status: 'REGISTERED' as const, hasManualFinish: true },
      { status: 'REGISTERED' as const, readoutCount: 1 },
      { status: 'REGISTERED' as const, receiptCount: 1 },
      { status: 'REGISTERED' as const, hasLocalReadout: true },
      { status: 'REGISTERED' as const, radioPassageCount: 1 },
    ];

    for (const testCase of cases) {
      expect(
        buildCompetitorDeletionImpact({
          readoutCount: 0,
          receiptCount: 0,
          radioPassageCount: 0,
          hasManualFinish: false,
          hasLocalReadout: false,
          ...testCase,
          status: testCase.status ?? 'REGISTERED',
        }).hasHistory
      ).toBe(true);
    }
  });
});
