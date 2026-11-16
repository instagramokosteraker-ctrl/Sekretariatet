import type { Competitor, RunnerStatus } from '../types/sportident';
import type { CompetitorWithOptionalEffectiveStatus } from './effectiveRunnerStatus';
import {
  getLivePassageProgress,
  type LivePassageProgress,
} from './livePassage';

export type ResultSortMode =
  | { kind: 'default' }
  | { kind: 'bom' }
  | { kind: 'radio'; controlCode: number }
  | { kind: 'ordinary'; order: number }
  | { kind: 'finish' };

export interface ResultSortOptions {
  radioControlCodes: number[];
  nowMs: number;
}

interface MpProgress {
  consecutiveControls: number;
  lastConsecutiveTimeSec: number | null;
  validPunchCount: number;
}

const STATUS_RANK: Record<RunnerStatus, number> = {
  OK: 0,
  PRELIMINARY_FIN: 1,
  IN_FOREST: 2,
  CHECKED: 3,
  REGISTERED: 4,
  MP: 5,
  DNF: 6,
  DNS: 7,
};

function compareNullableTime(
  a: number | null | undefined,
  b: number | null | undefined
): number {
  const timeA =
    a !== null && a !== undefined && Number.isFinite(a)
      ? a
      : Number.POSITIVE_INFINITY;
  const timeB =
    b !== null && b !== undefined && Number.isFinite(b)
      ? b
      : Number.POSITIVE_INFINITY;
  if (timeA === timeB) return 0;
  return timeA < timeB ? -1 : 1;
}

function getMpProgress(competitor: Competitor): MpProgress {
  const splits = [...(competitor.validation?.splits ?? [])].sort(
    (a, b) => a.order - b.order
  );
  let consecutiveControls = 0;
  let expectedOrder = 1;
  let lastConsecutiveTimeSec: number | null = null;

  for (const split of splits) {
    if (split.controlCode === 999) break;
    if (split.order !== expectedOrder) break;
    expectedOrder += 1;
    if (split.status === 'BROKEN_CTRL') continue;
    if (split.status !== 'OK') break;
    consecutiveControls += 1;
    lastConsecutiveTimeSec = split.cumulativeSec;
  }

  return {
    consecutiveControls,
    lastConsecutiveTimeSec,
    validPunchCount: splits.filter(
      (split) => split.controlCode !== 999 && split.status === 'OK'
    ).length,
  };
}

function getActualRadioTime(
  competitor: Competitor,
  controlCode: number
): number | null {
  const radioTime = competitor.radioSplits.find(
    (split) => split.controlCode === controlCode
  )?.runningTimeSec;
  if (radioTime !== null && radioTime !== undefined && Number.isFinite(radioTime)) {
    return radioTime;
  }

  const validatedTime = competitor.validation?.splits.find(
    (split) => split.controlCode === controlCode
  )?.cumulativeSec;
  return validatedTime !== null &&
    validatedTime !== undefined &&
    Number.isFinite(validatedTime)
    ? validatedTime
    : null;
}

function getSelectedTime(
  competitor: CompetitorWithOptionalEffectiveStatus,
  sortMode: ResultSortMode,
  passage: LivePassageProgress
): number | null {
  if (sortMode.kind === 'bom') {
    return competitor.validation?.totalTimeLossSec ?? null;
  }
  if (sortMode.kind === 'radio') {
    const actualTime = getActualRadioTime(competitor, sortMode.controlCode);
    if (actualTime !== null) return actualTime;
    return competitor.effectiveStatus === 'IN_FOREST' &&
      competitor.finishTimeSec === null &&
      passage.nextRadioControlCode === sortMode.controlCode
      ? passage.projectedPassageTimeSec
      : null;
  }
  if (sortMode.kind === 'ordinary') {
    const time = competitor.validation?.splits.find(
      (split) => split.order === sortMode.order
    )?.cumulativeSec;
    return time !== null && time !== undefined && Number.isFinite(time)
      ? time
      : null;
  }
  if (sortMode.kind === 'finish') {
    if (
      competitor.effectiveStatus === 'IN_FOREST' &&
      competitor.finishTimeSec === null &&
      passage.nextRadioControlCode === null
    ) {
      return passage.projectedPassageTimeSec;
    }
    return competitor.finishTimeSec !== null
      ? competitor.runningTimeSec
      : null;
  }
  return null;
}

export function sortCompetitorsByResult<T extends CompetitorWithOptionalEffectiveStatus>(
  competitors: T[],
  officialOrder: string[],
  sortMode: ResultSortMode,
  options: ResultSortOptions
): T[] {
  const officialRank = new Map(
    officialOrder.map((competitorId, index) => [competitorId, index])
  );
  const radioControlCodes = [...new Set(options.radioControlCodes)];
  const passageById = new Map(
    competitors.map((competitor) => [
      competitor.id,
      getLivePassageProgress(competitor, radioControlCodes, options.nowMs),
    ])
  );
  const mpProgress = new Map(
    competitors
      .filter((competitor) => (competitor.effectiveStatus ?? competitor.status) === 'MP')
      .map((competitor) => [competitor.id, getMpProgress(competitor)])
  );

  const compareMp = (a: Competitor, b: Competitor): number => {
    const progressA = mpProgress.get(a.id);
    const progressB = mpProgress.get(b.id);
    if (!progressA || !progressB) return 0;
    const consecutiveDiff =
      progressB.consecutiveControls - progressA.consecutiveControls;
    if (consecutiveDiff !== 0) return consecutiveDiff;
    const timeDiff = compareNullableTime(
      progressA.lastConsecutiveTimeSec,
      progressB.lastConsecutiveTimeSec
    );
    if (timeDiff !== 0) return timeDiff;
    return progressB.validPunchCount - progressA.validPunchCount;
  };

  const compareDefaultWithinStatus = (a: T, b: T): number => {
    const status = a.effectiveStatus ?? a.status;
    if (status === 'OK') {
      const rankA = officialRank.get(a.id);
      const rankB = officialRank.get(b.id);
      if (rankA !== undefined && rankB !== undefined && rankA !== rankB) {
        return rankA - rankB;
      }
      if (rankA !== undefined && rankB === undefined) return -1;
      if (rankA === undefined && rankB !== undefined) return 1;
      return compareNullableTime(a.runningTimeSec, b.runningTimeSec);
    }
    if (status === 'PRELIMINARY_FIN') {
      return compareNullableTime(a.runningTimeSec, b.runningTimeSec);
    }
    if (status === 'IN_FOREST') {
      const passageA = passageById.get(a.id);
      const passageB = passageById.get(b.id);
      if (passageA && passageB) {
        const progressDiff =
          passageB.completedRadioCount - passageA.completedRadioCount;
        if (progressDiff !== 0) return progressDiff;
        const projectedDiff = compareNullableTime(
          passageA.projectedPassageTimeSec,
          passageB.projectedPassageTimeSec
        );
        return projectedDiff;
      }
      return 0;
    }
    if (status === 'CHECKED' || status === 'REGISTERED') {
      return compareNullableTime(a.allocatedStartSec, b.allocatedStartSec);
    }
    if (status === 'MP') return compareMp(a, b);
    return 0;
  };

  return [...competitors].sort((a, b) => {
    const statusA = a.effectiveStatus ?? a.status;
    const statusB = b.effectiveStatus ?? b.status;
    const statusDiff = STATUS_RANK[statusA] - STATUS_RANK[statusB];
    if (statusDiff !== 0) return statusDiff;

    if (
      sortMode.kind === 'default' ||
      statusA === 'MP' ||
      statusA === 'DNF' ||
      statusA === 'DNS'
    ) {
      return compareDefaultWithinStatus(a, b);
    }

    const passageA = passageById.get(a.id);
    const passageB = passageById.get(b.id);
    const timeA = passageA ? getSelectedTime(a, sortMode, passageA) : null;
    const timeB = passageB ? getSelectedTime(b, sortMode, passageB) : null;
    const selectedTimeDiff = compareNullableTime(timeA, timeB);
    if (selectedTimeDiff !== 0) return selectedTimeDiff;
    return compareDefaultWithinStatus(a, b);
  });
}
