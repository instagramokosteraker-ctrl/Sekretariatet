import { describe, expect, it } from 'vitest';
import type { CompClass, Competitor, Course } from '../types/sportident';
import { calculateControlIntakeStatus } from './controlIntakeStatus';

const forkedCourse: Course = {
  id: 'gula',
  name: 'Gula banan',
  lengthMeters: 3000,
  climbMeters: 50,
  controls: [131, 142],
};

const forkedClass: CompClass = {
  id: 'class-gula',
  name: 'D21',
  courseId: null,
  classFormat: 'FORKED',
  forkCourseIds: ['gula', 'gula-variant'],
  allowDirectEntry: true,
  freeStart: false,
  autoMatchCourse: false,
};

function makeCompetitor(overrides: Partial<Competitor> = {}): Competitor {
  return {
    id: 'runner-1',
    bib: 1,
    fullName: 'Test Runner',
    club: 'Klubb',
    classId: 'class-gula',
    siNumber: 12345,
    cardSeries: 'SI-Card 10',
    isRentalCard: false,
    rentalReturned: false,
    status: 'IN_FOREST',
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
    ...overrides,
  };
}

describe('control intake status', () => {
  it('counts active runners in forked classes until they have completed readout', () => {
    expect(
      calculateControlIntakeStatus([forkedCourse], [forkedClass], [makeCompetitor()])
    ).toEqual([
      { code: 131, courseCount: 1, activeRunnersRemaining: 1 },
      { code: 142, courseCount: 1, activeRunnersRemaining: 1 },
    ]);
  });

  it('does not clear a course control just because active runners punched it', () => {
    const runnerWithPassages = makeCompetitor({
      cardPunches: [{ code: 131, timeSec: 10 * 3600 + 5 * 60 }],
      radioSplits: [
        {
          controlCode: 131,
          stationName: 'Kontroll 131',
          punchTimeSec: 10 * 3600 + 5 * 60,
          runningTimeSec: 5 * 60,
          isPrewarning: false,
        },
      ],
    });
    const runnerWithReadout = makeCompetitor({
      id: 'runner-2',
      status: 'OK',
      readoutAt: '2026-11-28T17:00:00.000Z',
    });

    expect(
      calculateControlIntakeStatus(
        [forkedCourse],
        [forkedClass],
        [runnerWithPassages, runnerWithReadout]
      )[0]
    ).toEqual({ code: 131, courseCount: 1, activeRunnersRemaining: 1 });
  });
});
