import type { Competitor, ReadoutValidation } from '../types/sportident';

export interface CompetitorPlacement {
  pos: number;
  total: number;
  diffSec: number;
}

export function getCompetitorPlacements(
  competitors: Competitor[]
): Map<string, CompetitorPlacement> {
  const finishersByClass = new Map<string, Competitor[]>();
  for (const competitor of competitors) {
    if (competitor.status !== 'OK' || competitor.runningTimeSec === null) continue;
    const finishers = finishersByClass.get(competitor.classId) ?? [];
    finishers.push(competitor);
    finishersByClass.set(competitor.classId, finishers);
  }

  const placements = new Map<string, CompetitorPlacement>();
  for (const finishers of finishersByClass.values()) {
    finishers.sort(
      (left, right) =>
        (left.runningTimeSec ?? 999999) - (right.runningTimeSec ?? 999999)
    );
    const winnerTime = finishers[0]?.runningTimeSec ?? 0;
    finishers.forEach((competitor, index) => {
      placements.set(competitor.id, {
        pos: index + 1,
        total: finishers.length,
        diffSec: (competitor.runningTimeSec ?? 0) - winnerTime,
      });
    });
  }
  return placements;
}

export function getCompetitorPlacement(
  competitor: Competitor | null,
  competitors: Competitor[]
): CompetitorPlacement | null {
  if (!competitor || competitor.status !== 'OK') return null;
  return getCompetitorPlacements(competitors).get(competitor.id) ?? null;
}

export function getMissingPunchExplanation(
  validation: ReadoutValidation | null | undefined
): string | null {
  if (!validation) return null;

  const reasons = [
    validation.missingControls.length > 0
      ? `Saknar ${validation.missingControls.map((code) => `(${code})`).join(', ')}`
      : null,
    validation.extraControls.length > 0
      ? `Extra ${validation.extraControls.map((punch) => `(${punch.code})`).join(', ')}`
      : null,
  ].filter((reason): reason is string => reason !== null);

  return reasons.length > 0 ? reasons.join(' · ') : 'Inga avvikande kontroller registrerade.';
}
