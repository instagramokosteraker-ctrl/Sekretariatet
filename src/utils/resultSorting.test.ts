import { describe, expect, it } from 'vitest';
import type {
  Competitor,
  RadioSplit,
  RunnerStatus,
  SplitLegResult,
} from '../types/sportident';
import type { CompetitorWithOptionalEffectiveStatus } from './effectiveRunnerStatus';
import {
  getResultListPlacementLabel,
  getResultListTimeLabel,
  sortCompetitorsByResult,
} from './resultSorting';

const NOW = Date.parse('2025-01-01T12:35:23+01:00');
const START = 12 * 60 * 60;
const RADIO_CODES = [137, 45];

function makeCompetitor(
  id: string,
  status: RunnerStatus,
  options: {
    effectiveStatus?: RunnerStatus;
    allocatedStartSec?: number | null;
    startTimeSec?: number | null;
    runningTimeSec?: number | null;
    finishTimeSec?: number | null;
    splits?: SplitLegResult[];
    radioSplits?: RadioSplit[];
    totalTimeLossSec?: number | null;
  } = {}
): CompetitorWithOptionalEffectiveStatus {
  const competitor: Competitor = {
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
    allocatedStartSec: options.allocatedStartSec ?? START,
    checkTimeSec: null,
    startTimeSec: options.startTimeSec ?? START,
    finishTimeSec: options.finishTimeSec ?? null,
    runningTimeSec: options.runningTimeSec ?? null,
    lastSeenControl: null,
    lastSeenTimeSec: null,
    readoutAt: null,
    radioSplits: options.radioSplits ?? [],
    cardPunches: [],
    validation: {
      ok: false,
      matchedCourseId: 'course',
      matchedCourseName: 'Bana',
      missingControls: [],
      extraControls: [],
      splits: options.splits ?? [],
      totalTimeLossSec: options.totalTimeLossSec,
    },
  };
  return options.effectiveStatus
    ? { ...competitor, effectiveStatus: options.effectiveStatus }
    : competitor;
}

function split(
  order: number,
  controlCode: number,
  cumulativeSec: number | null
): SplitLegResult {
  return {
    order,
    controlCode,
    label: `(${controlCode})`,
    status: cumulativeSec === null ? 'MISSING' : 'OK',
    punchTimeSec: cumulativeSec,
    cumulativeSec,
    legSec: null,
  };
}

function radio(controlCode: number, runningTimeSec: number): RadioSplit {
  return {
    controlCode,
    stationName: `(${controlCode})`,
    punchTimeSec: START + runningTimeSec,
    runningTimeSec,
    isPrewarning: false,
  };
}

const sortOptions = {
  radioControlCodes: RADIO_CODES,
  nowMs: NOW,
};

describe('sortCompetitorsByResult', () => {
  it('uses numeric placement only for OK and preserves status symbols for every other status', () => {
    expect(getResultListPlacementLabel('OK', 3)).toBe(3);
    for (const status of [
      'PRELIMINARY_FIN',
      'IN_FOREST',
      'CHECKED',
      'REGISTERED',
      'MP',
      'DNF',
      'DNS',
    ] as RunnerStatus[]) {
      expect(getResultListPlacementLabel(status, 3)).toBeNull();
    }
  });

  it('presents the result-list time column according to status', () => {
    expect(getResultListTimeLabel('OK', 1800)).toBe(1800);
    expect(getResultListTimeLabel('IN_FOREST', null, 2100)).toBe(2100);
    expect(getResultListTimeLabel('IN_FOREST', 900, null)).toBe(900);
    expect(getResultListTimeLabel('CHECKED', 900)).toBeNull();
    expect(getResultListTimeLabel('REGISTERED', 900)).toBeNull();
    expect(getResultListTimeLabel('MP', 900)).toBe('MP');
    expect(getResultListTimeLabel('DNF', 900)).toBe('DNF');
    expect(getResultListTimeLabel('DNS', 900)).toBe('DNS');
  });

  it('applies status groups before internal ranking', () => {
    const rows = [
      makeCompetitor('dns', 'DNS'),
      makeCompetitor('forest', 'IN_FOREST'),
      makeCompetitor('checked', 'CHECKED'),
      makeCompetitor('preliminary', 'PRELIMINARY_FIN', {
        runningTimeSec: 620,
        finishTimeSec: START + 620,
      }),
      makeCompetitor('registered', 'REGISTERED'),
      makeCompetitor('ok-slow', 'OK', { runningTimeSec: 700 }),
      makeCompetitor('dnf', 'DNF'),
      makeCompetitor('ok-fast', 'OK', { runningTimeSec: 600 }),
      makeCompetitor('mp', 'MP'),
    ];

    expect(
      sortCompetitorsByResult(
        rows,
        ['ok-fast', 'ok-slow'],
        { kind: 'default' },
        sortOptions
      ).map((row) => row.id)
    ).toEqual([
      'ok-fast',
      'ok-slow',
      'preliminary',
      'forest',
      'checked',
      'registered',
      'mp',
      'dnf',
      'dns',
    ]);
  });

  it('ranks in-forest competitors by passage progress, then rolling elapsed time', () => {
    const rows = [
      makeCompetitor('next-137', 'IN_FOREST'),
      makeCompetitor('next-45', 'IN_FOREST', {
        radioSplits: [radio(137, 2100)],
      }),
      makeCompetitor('actual-137', 'IN_FOREST', {
        radioSplits: [radio(137, 2100)],
      }),
    ];

    expect(
      sortCompetitorsByResult(rows, [], { kind: 'default' }, sortOptions).map(
        (row) => row.id
      )
    ).toEqual(['next-45', 'actual-137', 'next-137']);
  });

  it('uses the completed-radio count as the primary in-forest ranking key', () => {
    const oneRadioCompleted = makeCompetitor('one-radio', 'IN_FOREST', {
      radioSplits: [radio(137, 2000)],
    });
    const twoRadiosCompleted = makeCompetitor('two-radios', 'IN_FOREST', {
      radioSplits: [radio(137, 2000), radio(36, 2100)],
    });

    expect(
      sortCompetitorsByResult(
        [oneRadioCompleted, twoRadiosCompleted],
        [],
        { kind: 'default' },
        { ...sortOptions, radioControlCodes: [137, 45, 36] }
      ).map((row) => row.id)
    ).toEqual(['two-radios', 'one-radio']);
  });

  it('sorts a selected radio by actual and projected passage times together', () => {
    const rows = [
      makeCompetitor('jocke', 'IN_FOREST'),
      makeCompetitor('kasper', 'IN_FOREST', {
        radioSplits: [radio(137, 2122)],
      }),
      makeCompetitor('emil', 'IN_FOREST', {
        radioSplits: [radio(137, 2075)],
      }),
      makeCompetitor('finished', 'OK', {
        runningTimeSec: 100,
        finishTimeSec: START + 100,
      }),
    ];

    expect(
      sortCompetitorsByResult(
        rows,
        ['finished'],
        { kind: 'radio', controlCode: 137 },
        sortOptions
      ).map((row) => row.id)
    ).toEqual(['finished', 'emil', 'kasper', 'jocke']);
  });

  it('sorts ordinary-control actuals first and retains LIVE order for missing values', () => {
    const rows = [
      makeCompetitor('jocke', 'IN_FOREST'),
      makeCompetitor('slow-actual', 'IN_FOREST', {
        splits: [split(3, 36, 3540)],
      }),
      makeCompetitor('emil', 'IN_FOREST', {
        radioSplits: [radio(137, 2000)],
      }),
      makeCompetitor('fast-actual', 'IN_FOREST', {
        splits: [split(3, 36, 3469)],
      }),
    ];

    expect(
      sortCompetitorsByResult(
        rows,
        [],
        { kind: 'ordinary', order: 3 },
        sortOptions
      ).map((row) => row.id)
    ).toEqual(['fast-actual', 'slow-actual', 'emil', 'jocke']);
  });

  it('keeps checked runners with computed IN_FOREST status in the active group', () => {
    const overdueChecked = makeCompetitor('overdue-checked', 'CHECKED', {
      effectiveStatus: 'IN_FOREST',
    });
    const checked = makeCompetitor('checked', 'CHECKED');
    const registered = makeCompetitor('registered', 'REGISTERED');

    expect(
      sortCompetitorsByResult(
        [registered, checked, overdueChecked],
        [],
        { kind: 'default' },
        sortOptions
      ).map((row) => row.id)
    ).toEqual(['overdue-checked', 'checked', 'registered']);
  });

  it('retains the existing MP progress ordering', () => {
    const fewerControls = makeCompetitor('fewer-controls', 'MP', {
      splits: [split(1, 31, 100), split(2, 32, 200)],
    });
    const morePunches = makeCompetitor('more-punches', 'MP', {
      splits: [
        split(1, 31, 100),
        split(2, 32, 200),
        split(3, 33, 300),
        split(4, 34, null),
        split(5, 35, 420),
      ],
    });

    expect(
      sortCompetitorsByResult(
        [fewerControls, morePunches],
        [],
        { kind: 'default' },
        sortOptions
      ).map((row) => row.id)
    ).toEqual(['more-punches', 'fewer-controls']);
  });

  it('keeps Bom sorting on validated total time-loss data', () => {
    const moreBom = makeCompetitor('more-bom', 'OK', {
      totalTimeLossSec: 30,
    });
    const lessBom = makeCompetitor('less-bom', 'OK', {
      totalTimeLossSec: 12,
    });
    const forest = makeCompetitor('forest', 'IN_FOREST');

    expect(
      sortCompetitorsByResult(
        [moreBom, forest, lessBom],
        ['more-bom', 'less-bom'],
        { kind: 'bom' },
        sortOptions
      ).map((row) => row.id)
    ).toEqual(['less-bom', 'more-bom', 'forest']);
  });
});
