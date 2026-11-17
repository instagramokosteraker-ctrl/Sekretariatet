import type { Competitor, ReadoutValidation } from '../types/sportident';

export interface CompetitorPlacement {
  pos: number;
  total: number;
  diffSec: number;
}

export function getCompetitorPlacement(
  competitor: Competitor | null,
  competitors: Competitor[]
): CompetitorPlacement | null {
  if (!competitor || competitor.status !== 'OK') return null;

  const finishers = competitors
    .filter(
      (candidate) =>
        candidate.classId === competitor.classId &&
        candidate.status === 'OK' &&
        candidate.runningTimeSec !== null
    )
    .sort((a, b) => (a.runningTimeSec ?? 999999) - (b.runningTimeSec ?? 999999));
  const index = finishers.findIndex((candidate) => candidate.id === competitor.id);
  if (index < 0) return null;

  return {
    pos: index + 1,
    total: finishers.length,
    diffSec:
      (competitor.runningTimeSec ?? 0) - (finishers[0]?.runningTimeSec ?? 0),
  };
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
