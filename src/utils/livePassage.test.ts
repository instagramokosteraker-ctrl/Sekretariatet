import { describe, expect, it } from 'vitest';
import type { Competitor } from '../types/sportident';
import {
  getLivePassageProgress,
  getProjectedPassageTimeSec,
} from './livePassage';

const NOW = Date.parse('2025-01-01T12:31:35+01:00');
const START = 12 * 60 * 60;

function competitor(
  radioCodes: number[] = [],
  validatedCodes: number[] = []
): Pick<
  Competitor,
  'radioSplits' | 'startTimeSec' | 'allocatedStartSec' | 'validation'
> {
  return {
    radioSplits: radioCodes.map((controlCode) => ({
      controlCode,
      stationName: `(${controlCode})`,
      punchTimeSec: START + 100,
      runningTimeSec: 100,
      isPrewarning: false,
    })),
    startTimeSec: START,
    allocatedStartSec: START - 60,
    validation: {
      ok: false,
      matchedCourseId: null,
      matchedCourseName: null,
      missingControls: [],
      extraControls: [],
      splits: validatedCodes.map((controlCode, index) => ({
        order: index + 1,
        controlCode,
        label: `(${controlCode})`,
        status: 'OK' as const,
        punchTimeSec: 100,
        cumulativeSec: 100,
        legSec: 100,
      })),
    },
  };
}

describe('live passage projection', () => {
  it('uses rolling elapsed time from the actual start, falling back to allocated start', () => {
    expect(getProjectedPassageTimeSec(START, NOW)).toBe(31 * 60 + 35);
    expect(getProjectedPassageTimeSec(null, NOW)).toBeNull();
    expect(
      getLivePassageProgress(
        { ...competitor(), startTimeSec: null, allocatedStartSec: START - 60 },
        [137, 45],
        NOW
      ).projectedPassageTimeSec
    ).toBe(32 * 60 + 35);
  });

  it('shows exactly the next unreached configured radio passage', () => {
    const first = getLivePassageProgress(competitor(), [137, 45], NOW);
    expect(first.nextRadioControlCode).toBe(137);
    expect(first.completedRadioCount).toBe(0);
    expect(first.projectedPassageTimeSec).toBe(31 * 60 + 35);

    const second = getLivePassageProgress(competitor([137]), [137, 45], NOW);
    expect(second.nextRadioControlCode).toBe(45);
    expect(second.completedRadioCount).toBe(1);

    const finish = getLivePassageProgress(competitor([137, 45]), [137, 45], NOW);
    expect(finish.nextRadioControlCode).toBeNull();
  });

  it('treats validated SI readout passages as reached', () => {
    const progress = getLivePassageProgress(
      competitor([], [137]),
      [137, 45],
      NOW
    );
    expect(progress.nextRadioControlCode).toBe(45);
  });
});
