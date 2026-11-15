import { useEffect, useMemo, useState } from 'react';
import type { CompetitionMeta, Competitor } from '../types/sportident';
import {
  getScheduledStartTimestamp,
  type CompetitorWithEffectiveStatus,
  withEffectiveStatus,
} from '../utils/effectiveRunnerStatus';

const MAX_TIMEOUT_MS = 2_147_000_000;

export function useEffectiveCompetitors(
  competitors: Competitor[],
  competition: Pick<CompetitionMeta, 'date' | 'status'> | null
): CompetitorWithEffectiveStatus[] {
  const [clockRevision, setClockRevision] = useState(() => Date.now());

  useEffect(() => {
    if (!competition || competition.status === 'COMPLETED') return;

    const now = Date.now();
    const nextStart = competitors.reduce<number | null>((nearest, competitor) => {
      if (competitor.status !== 'CHECKED') return nearest;
      const scheduledStart = getScheduledStartTimestamp(
        competition.date,
        competitor.allocatedStartSec
      );
      if (scheduledStart === null || scheduledStart <= now) return nearest;
      return nearest === null || scheduledStart < nearest ? scheduledStart : nearest;
    }, null);

    if (nextStart === null) return;
    const timer = window.setTimeout(
      () => setClockRevision(Date.now()),
      Math.min(nextStart - now, MAX_TIMEOUT_MS)
    );
    return () => window.clearTimeout(timer);
  }, [competitors, competition, clockRevision]);

  useEffect(() => {
    const refreshClock = () => setClockRevision(Date.now());
    window.addEventListener('focus', refreshClock);
    document.addEventListener('visibilitychange', refreshClock);
    return () => {
      window.removeEventListener('focus', refreshClock);
      document.removeEventListener('visibilitychange', refreshClock);
    };
  }, []);

  return useMemo(
    () => {
      const nowMs = Date.now();
      return competitors.map((competitor) => ({
        ...(competition
          ? withEffectiveStatus(competitor, competition, nowMs)
          : { ...competitor, effectiveStatus: competitor.status }),
      }));
    },
    [competitors, competition, clockRevision]
  );
}
