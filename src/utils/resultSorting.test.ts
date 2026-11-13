import { describe, expect, it } from 'vitest';
import type { Competitor, RunnerStatus, SplitLegResult } from '../types/sportident';
import { sortCompetitorsByResult } from './resultSorting';

function makeCompetitor(
  id: string,
  status: RunnerStatus,
  options: {
    runningTimeSec?: number | null;
    splits?: SplitLegResult[];
    totalTimeLossSec?: number | null;
  } = {}
): Competitor {
  const splits = options.splits ?? [];
  return {
    id,
    bib: 1,
    fullName: id,
    club: 'Klubb',
    classId: 'class',
    siNumber: 1,
    cardSeries: 'SI-Card 10',
    isRentalCard: false,
    rentalReturned: false,
    status,
    allocatedStartSec: null,
    checkTimeSec: null,
    startTimeSec: null,
    finishTimeSec: null,
    runningTimeSec: options.runningTimeSec ?? null,
    lastSeenControl: null,
    lastSeenTimeSec: null,
    readoutAt: null,
    radioSplits: [],
    cardPunches: [],
    validation: {
      ok: false,
      matchedCourseId: 'course',
      matchedCourseName: 'Bana',
      missingControls: [],
      extraControls: [],
      splits,
      totalTimeLossSec: options.totalTimeLossSec,
    },
  };
}

function split(
  order: number,
  controlCode: number,
  status: SplitLegResult['status'],
  cumulativeSec: number | null = null,
  legSec: number | null = null
): SplitLegResult {
  return {
    order,
    controlCode,
    label: `(${controlCode})`,
    status,
    punchTimeSec: cumulativeSec,
    cumulativeSec,
    legSec,
  };
}

describe('sortCompetitorsByResult', () => {
  it('keeps finished, in-progress, MP and unstarted runners in the requested groups', () => {
    const rows = [
      makeCompetitor('checked', 'CHECKED'),
      makeCompetitor('mp-missing-first', 'MP', {
        splits: [
          split(1, 31, 'MISSING'),
          split(2, 32, 'OK', 120),
          split(3, 33, 'OK', 180),
        ],
      }),
      makeCompetitor('in-forest', 'IN_FOREST'),
      makeCompetitor('finished-slow', 'OK', { runningTimeSec: 700 }),
      makeCompetitor('finished-fast', 'OK', { runningTimeSec: 600 }),
      makeCompetitor('mp-leading', 'MP', {
        splits: [split(1, 31, 'OK', 90), split(2, 32, 'OK', 150)],
      }),
      makeCompetitor('dnf', 'DNF'),
      makeCompetitor('registered', 'REGISTERED'),
      makeCompetitor('dns', 'DNS'),
    ];

    expect(
      sortCompetitorsByResult(rows, ['finished-fast', 'finished-slow'], {
        kind: 'default',
      }).map((row) => row.id)
    ).toEqual([
      'finished-fast',
      'finished-slow',
      'in-forest',
      'mp-leading',
      'mp-missing-first',
      'dnf',
      'checked',
      'registered',
      'dns',
    ]);
  });

  it('breaks MP ties by elapsed time at the last leading control, then valid punches', () => {
    const slower = makeCompetitor('slower', 'MP', {
      splits: [
        split(1, 31, 'OK', 200),
        split(2, 32, 'OK', 300),
        split(3, 33, 'OK', 420),
      ],
    });
    const faster = makeCompetitor('faster', 'MP', {
      splits: [
        split(1, 31, 'OK', 100),
        split(2, 32, 'OK', 200),
        split(3, 33, 'OK', 300),
      ],
    });
    const morePunches = makeCompetitor('more-punches', 'MP', {
      splits: [
        split(1, 31, 'OK', 100),
        split(2, 32, 'OK', 200),
        split(3, 33, 'OK', 300),
        split(4, 34, 'MISSING'),
        split(5, 35, 'OK', 420),
      ],
    });

    expect(
      sortCompetitorsByResult(
        [slower, faster, morePunches],
        [],
        { kind: 'default' }
      ).map((row) => row.id)
    ).toEqual(['more-punches', 'faster', 'slower']);
  });

  it('sorts finished runners by the selected leg within their status group', () => {
    const rows = [
      makeCompetitor('slow', 'OK', {
        runningTimeSec: 600,
        splits: [split(1, 31, 'OK', 100, 100)],
      }),
      makeCompetitor('fast', 'OK', {
        runningTimeSec: 700,
        splits: [split(1, 31, 'OK', 90, 90)],
      }),
      makeCompetitor('mp', 'MP', {
        splits: [split(1, 31, 'OK', 80, 80)],
      }),
    ];

    expect(
      sortCompetitorsByResult(rows, ['slow', 'fast'], {
        kind: 'leg',
        order: 1,
      }).map((row) => row.id)
    ).toEqual(['fast', 'slow', 'mp']);
  });
});
