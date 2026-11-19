import { describe, expect, it } from 'vitest';
import type { CompClass, Competitor, Course, EmergencySettings } from '../types/sportident';
import {
  calculateReadoutReassignmentPreview,
  type ReassignmentReadoutData,
} from './readoutReassignment';

const compClass: CompClass = {
  id: 'cls-1',
  name: 'D21',
  courseId: 'course-1',
  allowDirectEntry: true,
  freeStart: false,
  autoMatchCourse: false,
};
const course: Course = {
  id: 'course-1',
  name: 'Bana 1',
  lengthMeters: 5000,
  climbMeters: 100,
  controls: [31],
};
const emergency: EmergencySettings = {
  brokenControls: [],
  controlTimeOffsets: {},
};

function makeCompetitor(
  id: string,
  status: Competitor['status'],
  runningTimeSec: number | null
): Competitor {
  return {
    id,
    bib: id === 'anna' ? 1 : id === 'erik' ? 2 : 3,
    fullName: id,
    club: 'Klubb',
    classId: 'cls-1',
    siNumber: id === 'anna' ? 510123 : id === 'erik' ? 510999 : 510998,
    cardSeries: 'SI-Card 9',
    isRentalCard: false,
    rentalReturned: false,
    status,
    allocatedStartSec: null,
    checkTimeSec: null,
    startTimeSec: status === 'IN_FOREST' ? 36000 : null,
    finishTimeSec: status === 'OK' ? 40000 : null,
    runningTimeSec,
    lastSeenControl: null,
    lastSeenTimeSec: null,
    readoutAt: status === 'OK' ? '2026-11-19T10:00:00.000Z' : null,
    radioSplits: [],
    cardPunches: status === 'OK' ? [{ code: 31, timeSec: 37000 }] : [],
    rawReadout:
      status === 'OK'
        ? {
            checkTimeSec: null,
            startTimeSec: 36000,
            finishTimeSec: 40000,
            punches: [{ code: 31, timeSec: 37000 }],
            receivedAt: '2026-11-19T10:00:00.000Z',
          }
        : null,
    validation: null,
  };
}

const readout: ReassignmentReadoutData = {
  clientReadoutId: 'readout-1',
  capturedAt: '2026-11-19T10:00:00.000Z',
  checkTimeSec: null,
  startTimeSec: 36000,
  finishTimeSec: 40000,
  punches: [{ code: 31, timeSec: 37000 }],
};

describe('calculateReadoutReassignmentPreview', () => {
  it('validates against the target class and calculates the projected placing', () => {
    const anna = makeCompetitor('anna', 'OK', 3500);
    const erik = makeCompetitor('erik', 'REGISTERED', null);
    const otherFinisher = makeCompetitor('other', 'OK', 3900);

    const preview = calculateReadoutReassignmentPreview(
      readout,
      anna.id,
      erik,
      [anna, erik, otherFinisher],
      [compClass],
      [course],
      36000,
      emergency
    );

    expect(preview).toMatchObject({
      status: 'OK',
      finishTimeSec: 40000,
      runningTimeSec: 4000,
      bomSec: null,
      placing: { pos: 2, total: 2 },
    });
    expect(preview.competitor.cardPunches).toEqual(readout.punches);
    expect(preview.competitor.rawReadout?.clientReadoutId).toBe(readout.clientReadoutId);
  });

  it('rejects a target who already has a result', () => {
    const anna = makeCompetitor('anna', 'OK', 3500);
    const erik = makeCompetitor('erik', 'OK', 3900);

    expect(() =>
      calculateReadoutReassignmentPreview(
        readout,
        anna.id,
        erik,
        [anna, erik],
        [compClass],
        [course],
        36000,
        emergency
      )
    ).toThrow('har redan ett resultat');
  });
});
