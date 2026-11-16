import type { CompetitionMeta } from '../types/sportident';
import {
  calculateClassStartDraw,
  type StartDrawCompetitor,
  type StartDrawMode,
  type StartDrawPlan,
} from '../utils/startListDraw';

export interface ClassDrawEvent {
  competition: Pick<CompetitionMeta, 'zeroTimeStr' | 'zeroTimeSec'>;
  classes: Array<{ id: string; name: string; freeStart: boolean }>;
  competitors: Array<StartDrawCompetitor & { allocatedStartSec: number | null }>;
}

export type ClassDrawResult<TEvent> =
  | { kind: 'competition-not-found' }
  | { kind: 'class-not-found'; event: TEvent }
  | { kind: 'drawn'; event: TEvent; className: string; plan: StartDrawPlan };

export interface ClassDrawInput {
  competitionId: string;
  classId: string;
  mode?: StartDrawMode;
  firstStartClock?: string;
  intervalSec?: number;
  vacancies?: number;
  clubSeparation?: boolean;
  includeAlreadyStarted?: boolean;
}

export function executeClassDraw<TEvent extends ClassDrawEvent>(
  competitions: Record<string, TEvent>,
  input: ClassDrawInput
): ClassDrawResult<TEvent> {
  const event = competitions[input.competitionId];
  if (!event) return { kind: 'competition-not-found' };

  const classRecord = event.classes.find((candidate) => candidate.id === input.classId);
  if (!classRecord) return { kind: 'class-not-found', event };

  const plan = calculateClassStartDraw(event.competitors, {
    classId: classRecord.id,
    mode: input.mode ?? 'INTERVAL',
    firstStartClock: input.firstStartClock ?? event.competition.zeroTimeStr,
    intervalSec: input.intervalSec ?? 120,
    vacancies: input.vacancies ?? 0,
    clubSeparation: input.clubSeparation ?? true,
    includeAlreadyStarted: input.includeAlreadyStarted ?? false,
    defaultFirstStartSec: event.competition.zeroTimeSec,
  });

  classRecord.freeStart = plan.freeStart;
  const competitorsById = new Map(
    event.competitors.map((competitor) => [competitor.id, competitor])
  );
  for (const allocation of plan.allocations) {
    const competitor = competitorsById.get(allocation.competitorId);
    if (competitor) competitor.allocatedStartSec = allocation.allocatedStartSec;
  }

  return {
    kind: 'drawn',
    event,
    className: classRecord.name,
    plan,
  };
}
