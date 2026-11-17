import { describe, expect, it } from 'vitest';
import type { Competitor, ReadoutValidation } from '../types/sportident';
import {
  getCompetitorPlacement,
  getMissingPunchExplanation,
} from './readoutSummary';

function createCompetitor(
  id: string,
  classId: string,
  status: Competitor['status'],
  runningTimeSec: number | null
): Competitor {
  return {
    id,
    bib: 1,
    fullName: id,
    club: 'Club',
    classId,
    siNumber: 510000,
    cardSeries: 'SI-Card 10',
    isRentalCard: false,
    rentalReturned: false,
    status,
    allocatedStartSec: null,
    checkTimeSec: null,
    startTimeSec: null,
    finishTimeSec: null,
    runningTimeSec,
    lastSeenControl: null,
    lastSeenTimeSec: null,
    readoutAt: null,
    radioSplits: [],
    cardPunches: [],
    validation: null,
  };
}

describe('readout summary', () => {
  it('calculates placing only among classified finishers', () => {
    const winner = createCompetitor('winner', 'class-a', 'OK', 600);
    const latest = createCompetitor('latest', 'class-a', 'OK', 630);
    const otherClass = createCompetitor('other-class', 'class-b', 'OK', 500);
    const unfinished = createCompetitor('unfinished', 'class-a', 'IN_FOREST', null);

    expect(
      getCompetitorPlacement(latest, [winner, latest, otherClass, unfinished])
    ).toEqual({ pos: 2, total: 2, diffSec: 30 });
    expect(getCompetitorPlacement(unfinished, [winner, latest, unfinished])).toBeNull();
  });

  it('summarizes missing and extra controls for an MP explanation', () => {
    const validation: ReadoutValidation = {
      ok: false,
      matchedCourseId: null,
      matchedCourseName: null,
      missingControls: [31, 42],
      extraControls: [{ code: 55, timeSec: 600 }],
      splits: [],
    };

    expect(getMissingPunchExplanation(validation)).toBe(
      'Saknar (31), (42) · Extra (55)'
    );
    expect(getMissingPunchExplanation(null)).toBeNull();
  });
});
