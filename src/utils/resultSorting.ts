import type { Competitor } from '../types/sportident';

export type ResultSortMode =
  | { kind: 'default' }
  | { kind: 'bom' }
  | { kind: 'leg'; order: number };

interface MpProgress {
  consecutiveControls: number;
  lastConsecutiveTimeSec: number | null;
  validPunchCount: number;
}

function getStatusRank(competitor: Competitor): number {
  if (competitor.status === 'OK' || competitor.status === 'PRELIMINARY_FIN') {
    return 0;
  }
  if (competitor.status === 'IN_FOREST') return 1;

  const normalizedStatus = String(competitor.status)
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (['MP', 'DNF', 'DSQ', 'OVERTIME'].includes(normalizedStatus)) return 2;
  return 3;
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

function compareNullableTime(
  a: number | null | undefined,
  b: number | null | undefined
): number {
  const timeA = a !== null && a !== undefined && Number.isFinite(a)
    ? a
    : Number.POSITIVE_INFINITY;
  const timeB = b !== null && b !== undefined && Number.isFinite(b)
    ? b
    : Number.POSITIVE_INFINITY;
  if (timeA === timeB) return 0;
  return timeA < timeB ? -1 : 1;
}

export function sortCompetitorsByResult(
  competitors: Competitor[],
  officialOrder: string[],
  sortMode: ResultSortMode
): Competitor[] {
  const officialRank = new Map(
    officialOrder.map((competitorId, index) => [competitorId, index])
  );
  const mpProgress = new Map(
    competitors
      .filter((competitor) => competitor.status === 'MP')
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

  const getSelectedTime = (competitor: Competitor): number | null => {
    if (sortMode.kind === 'bom') {
      return competitor.validation?.totalTimeLossSec ?? null;
    }
    if (sortMode.kind === 'leg') {
      return (
        competitor.validation?.splits.find(
          (split) => split.order === sortMode.order
        )?.legSec ?? null
      );
    }
    return null;
  };

  return [...competitors].sort((a, b) => {
    const rankA = getStatusRank(a);
    const rankB = getStatusRank(b);
    if (rankA !== rankB) return rankA - rankB;

    if (rankA === 0 && sortMode.kind === 'default') {
      const officialRankA = officialRank.get(a.id);
      const officialRankB = officialRank.get(b.id);
      if (officialRankA === undefined && officialRankB !== undefined) return 1;
      if (officialRankA !== undefined && officialRankB === undefined) return -1;
      if (
        officialRankA !== undefined &&
        officialRankB !== undefined &&
        officialRankA !== officialRankB
      ) {
        return officialRankA - officialRankB;
      }
    }

    if (rankA === 2) {
      const isMpA = a.status === 'MP';
      const isMpB = b.status === 'MP';
      if (isMpA !== isMpB) return isMpA ? -1 : 1;
      if (isMpA) {
        const mpDiff = compareMp(a, b);
        if (mpDiff !== 0) return mpDiff;
      }
    }

    if (sortMode.kind !== 'default') {
      const selectedTimeDiff = compareNullableTime(
        getSelectedTime(a),
        getSelectedTime(b)
      );
      if (selectedTimeDiff !== 0) return selectedTimeDiff;
    } else if (rankA === 0) {
      const totalTimeDiff = compareNullableTime(
        a.runningTimeSec,
        b.runningTimeSec
      );
      if (totalTimeDiff !== 0) return totalTimeDiff;
    }

    return 0;
  });
}
