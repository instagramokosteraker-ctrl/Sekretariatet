import { describe, expect, it } from 'vitest';
import type { Competitor } from '../types/sportident';
import {
  addPublicRadioSplit,
  createPublicResultDocument,
  parsePublicResultDocument,
  toPublicCompetitorResult,
  toPublicResultCompetitor,
} from './publicResultProjection';

const competitor: Competitor = {
  id: 'runner-1',
  bib: 12,
  fullName: 'Runner One',
  club: 'Club',
  classId: 'class-1',
  siNumber: 12345678,
  cardSeries: 'SI-Card 10',
  isRentalCard: false,
  rentalReturned: false,
  status: 'IN_FOREST',
  allocatedStartSec: 36000,
  checkTimeSec: 35900,
  startTimeSec: 36005,
  finishTimeSec: null,
  runningTimeSec: null,
  lastSeenControl: 1,
  lastSeenTimeSec: 36100,
  readoutAt: null,
  radioSplits: [
    {
      controlCode: 137,
      stationName: 'Radio 137',
      punchTimeSec: 36100,
      runningTimeSec: 1095,
      isPrewarning: false,
    },
  ],
  cardPunches: [{ code: 31, timeSec: 36060 }],
  rawReadout: {
    checkTimeSec: 35900,
    startTimeSec: 36005,
    finishTimeSec: null,
    punches: [{ code: 31, timeSec: 36060 }],
    rawHex: 'secret',
    receivedAt: '2025-01-01T10:00:00.000Z',
  },
  validation: {
    ok: false,
    matchedCourseId: null,
    matchedCourseName: null,
    missingControls: [32],
    extraControls: [],
    splits: [],
  },
};

describe('public result projection', () => {
  it('projects display-safe result fields without card identity or readout internals', () => {
    const projection = createPublicResultDocument('event-1', competitor);

    expect(projection).toMatchObject({
      competitionId: 'event-1',
      competitorId: 'runner-1',
      status: 'IN_FOREST',
      allocatedStartSec: 36000,
      startTimeSec: 36005,
    });
    expect(projection.radioSplits).toEqual(competitor.radioSplits);
    expect(projection).not.toHaveProperty('siNumber');
    expect(projection).not.toHaveProperty('cardSeries');
    expect(projection).not.toHaveProperty('rawReadout');
    expect(projection).not.toHaveProperty('validation');
    expect(projection).not.toHaveProperty('cardPunches');
  });

  it('parses a safe projection and adapts it without restoring private fields', () => {
    const parsed = parsePublicResultDocument(
      'runner-1',
      createPublicResultDocument('event-1', competitor)
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.allocatedStartSec).toBe(36000);

    const adapted = toPublicResultCompetitor(parsed!);
    expect(adapted.siNumber).toBe(0);
    expect(adapted.validation).toBeNull();
    expect(adapted.rawReadout).toBeNull();
    expect(adapted.cardPunches).toEqual([]);
  });

  it('keeps API public result rows free of SI-card and validation data', () => {
    const publicResult = toPublicCompetitorResult(competitor);

    expect(publicResult).toMatchObject({
      id: 'runner-1',
      bib: 12,
      radioSplits: competitor.radioSplits,
    });
    expect(publicResult).not.toHaveProperty('siNumber');
    expect(publicResult).not.toHaveProperty('cardSeries');
    expect(publicResult).not.toHaveProperty('rawReadout');
    expect(publicResult).not.toHaveProperty('validation');
    expect(publicResult).not.toHaveProperty('cardPunches');
  });

  it('keeps the earliest actual split for duplicate control punches', () => {
    const later = competitor.radioSplits[0];
    const earlier = { ...later, punchTimeSec: 36090 };
    expect(addPublicRadioSplit([later], earlier)).toEqual([earlier]);
  });
});
