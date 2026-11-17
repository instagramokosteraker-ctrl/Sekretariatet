import { describe, expect, it } from 'vitest';
import type { Competitor } from '../types/sportident';
import {
  applyFirestoreRadioPunches,
  mapFirestoreCompetitor,
  type FirestoreCompetitorContext,
} from './firestoreLiveResults';

const context: FirestoreCompetitorContext = {
  classes: [
    {
      id: 'class-1',
      name: 'D21',
      courseId: 'course-1',
      allowDirectEntry: false,
      freeStart: false,
      autoMatchCourse: false,
    },
  ],
  courses: [
    {
      id: 'course-1',
      name: 'Course 1',
      lengthMeters: 3000,
      climbMeters: 50,
      controls: [31],
    },
  ],
  competitionZeroTimeSec: 36000,
  emergency: { brokenControls: [], controlTimeOffsets: {} },
};

function competitor(overrides: Partial<Competitor> = {}): Competitor {
  return {
    id: 'runner-1',
    bib: 1,
    fullName: 'Runner One',
    club: 'Club',
    classId: 'class-1',
    siNumber: 12345,
    cardSeries: 'SI-Card 10',
    isRentalCard: false,
    rentalReturned: false,
    status: 'CHECKED',
    allocatedStartSec: 36000,
    checkTimeSec: null,
    startTimeSec: 36000,
    finishTimeSec: null,
    runningTimeSec: null,
    lastSeenControl: null,
    lastSeenTimeSec: null,
    readoutAt: null,
    radioSplits: [],
    cardPunches: [],
    rawReadout: null,
    validation: null,
    ...overrides,
  };
}

describe('Firestore live result mapping', () => {
  it('maps current status and times and retains readout validation inputs', () => {
    const mapped = mapFirestoreCompetitor(
      'runner-1',
      {
        competitorId: 'runner-1',
        bib: 7,
        fullName: 'Runner One',
        club: 'Club',
        classId: 'class-1',
        siNumber: 12345,
        status: 'PRELIMINARY_FIN',
        allocatedStartSec: 36000,
        startTimeSec: 36005,
        finishTimeSec: 36120,
        readoutAtIso: '2025-01-01T10:02:00.000Z',
        punchCodes: [31],
        punchTimes: [36060],
      },
      context
    );

    expect(mapped.status).toBe('PRELIMINARY_FIN');
    expect(mapped.startTimeSec).toBe(36005);
    expect(mapped.finishTimeSec).toBe(36120);
    expect(mapped.runningTimeSec).toBeNull();
    expect(mapped.cardPunches).toEqual([{ code: 31, timeSec: 36060 }]);
    expect(mapped.validation?.splits[0]?.controlCode).toBe(31);
  });

  it('attaches only actual radio punches matching both competitor and SI identity', () => {
    const originalValidation = {
      ok: false,
      matchedCourseId: null,
      matchedCourseName: null,
      missingControls: [31],
      extraControls: [],
      splits: [],
    };
    const runner = competitor({ validation: originalValidation });
    const updated = applyFirestoreRadioPunches([runner], [
      {
        competitorId: 'runner-1',
        siNumber: 12345,
        stationCode: 137,
        stationName: 'Radio 137',
        stationFunction: 'RADIO',
        punchTimeSec: 36100,
        runningTimeSec: 100,
      },
      {
        competitorId: 'runner-1',
        siNumber: 99999,
        stationCode: 45,
        stationName: 'Wrong card',
        stationFunction: 'RADIO',
        punchTimeSec: 36200,
        runningTimeSec: 200,
      },
      {
        competitorId: 'runner-1',
        siNumber: 12345,
        stationCode: 137,
        stationName: 'Radio 137',
        stationFunction: 'RADIO',
        punchTimeSec: 36090,
        runningTimeSec: 90,
      },
      {
        competitorId: 'runner-1',
        siNumber: 12345,
        stationCode: 45,
        stationName: 'Prewarning 45',
        stationFunction: 'PREWARNING',
        punchTimeSec: 36200,
        runningTimeSec: 200,
      },
      {
        competitorId: 'unknown-runner',
        siNumber: 12345,
        stationCode: 45,
        stationName: 'Radio 45',
        stationFunction: 'PREWARNING',
        punchTimeSec: 36200,
        runningTimeSec: 200,
      },
    ]);

    expect(updated[0].radioSplits).toEqual([
      {
        controlCode: 137,
        stationName: 'Radio 137',
        punchTimeSec: 36090,
        runningTimeSec: 90,
        isPrewarning: false,
      },
      {
        controlCode: 45,
        stationName: 'Prewarning 45',
        punchTimeSec: 36200,
        runningTimeSec: 200,
        isPrewarning: true,
      },
    ]);
    expect(updated[0].validation).toBe(originalValidation);
  });
});
