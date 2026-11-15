import { describe, expect, it } from 'vitest';
import type { CompetitionMeta, Competitor } from '../types/sportident';
import {
  getEffectiveRunnerStatus,
  getScheduledStartTimestamp,
  withEffectiveStatus,
} from './effectiveRunnerStatus';

const competition: Pick<CompetitionMeta, 'date' | 'status'> = {
  date: '2026-01-15',
  status: 'LIVE',
};

function makeCompetitor(status: Competitor['status'] = 'CHECKED'): Competitor {
  return {
    id: 'runner-1',
    bib: 1,
    fullName: 'Test Runner',
    club: 'Klubb',
    classId: 'class-1',
    siNumber: 12345,
    cardSeries: 'SI-Card 10',
    isRentalCard: false,
    rentalReturned: false,
    status,
    allocatedStartSec: 10 * 3600,
    checkTimeSec: null,
    startTimeSec: null,
    finishTimeSec: null,
    runningTimeSec: null,
    lastSeenControl: null,
    lastSeenTimeSec: null,
    readoutAt: null,
    radioSplits: [],
    cardPunches: [],
    validation: null,
  };
}

describe('effective runner status', () => {
  const scheduledStart = getScheduledStartTimestamp(
    competition.date,
    10 * 3600
  );

  it('resolves allocated starts using Stockholm summer time', () => {
    expect(getScheduledStartTimestamp('2026-07-15', 10 * 3600)).toBe(
      Date.parse('2026-07-15T08:00:00Z')
    );
  });

  it('keeps a checked runner checked before the allocated start', () => {
    expect(scheduledStart).not.toBeNull();
    expect(
      getEffectiveRunnerStatus(
        makeCompetitor(),
        competition,
        scheduledStart! - 1000
      )
    ).toBe('CHECKED');
  });

  it('transitions at the exact allocated start boundary', () => {
    expect(scheduledStart).not.toBeNull();
    expect(
      getEffectiveRunnerStatus(makeCompetitor(), competition, scheduledStart!)
    ).toBe('IN_FOREST');
  });

  it('treats an overdue checked runner as in the forest', () => {
    expect(scheduledStart).not.toBeNull();
    expect(
      getEffectiveRunnerStatus(
        makeCompetitor(),
        competition,
        scheduledStart! + 1000
      )
    ).toBe('IN_FOREST');
  });

  it('immediately treats a late check-in as in the forest', () => {
    const registered = makeCompetitor('REGISTERED');
    const checkedAt = { ...registered, status: 'CHECKED' as const };

    expect(
      getEffectiveRunnerStatus(
        checkedAt,
        competition,
        scheduledStart! + 1000
      )
    ).toBe('IN_FOREST');
  });

  it('leaves a registered runner unchanged after the allocated start', () => {
    expect(
      getEffectiveRunnerStatus(
        makeCompetitor('REGISTERED'),
        competition,
        scheduledStart! + 1000
      )
    ).toBe('REGISTERED');
  });

  it('uses the stored status for completed competitions', () => {
    expect(
      getEffectiveRunnerStatus(
        makeCompetitor(),
        { ...competition, status: 'COMPLETED' },
        scheduledStart! + 1000
      )
    ).toBe('CHECKED');
  });

  it('does not mutate the competitor or persist the computed status', () => {
    const competitor = makeCompetitor();
    const original = { ...competitor };
    const projected = withEffectiveStatus(
      competitor,
      competition,
      scheduledStart! + 1000
    );

    expect(projected.effectiveStatus).toBe('IN_FOREST');
    expect(projected.status).toBe('CHECKED');
    expect(competitor).toEqual(original);
    expect(competitor.status).toBe('CHECKED');
  });
});
