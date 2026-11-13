export type StartDrawMode = 'INTERVAL' | 'MASS' | 'FREE';

export interface StartDrawCompetitor {
  id: string;
  classId: string;
  club: string;
  status: string;
}

export interface StartDrawOptions {
  classId: string;
  mode: StartDrawMode;
  firstStartClock: string;
  intervalSec: number;
  vacancies: number;
  clubSeparation: boolean;
  includeAlreadyStarted: boolean;
  defaultFirstStartSec: number;
}

export interface StartDrawAllocation {
  competitorId: string;
  allocatedStartSec: number | null;
}

export interface StartDrawPlan {
  mode: StartDrawMode;
  freeStart: boolean;
  drawnCount: number;
  allocations: StartDrawAllocation[];
  vacantStartTimes: string[];
}

function parseClockToSeconds(clock: string): number | null {
  const match = clock.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function formatClock(seconds: number): string {
  const normalized = ((Math.floor(seconds) % 86400) + 86400) % 86400;
  const hours = Math.floor(normalized / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((normalized % 3600) / 60).toString().padStart(2, '0');
  const remainder = (normalized % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${remainder}`;
}

function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function shuffleWithClubSeparation(
  competitors: StartDrawCompetitor[]
): StartDrawCompetitor[] {
  const pool = shuffle(competitors);
  const result: StartDrawCompetitor[] = [];
  while (pool.length > 0) {
    const previousClub =
      result.length > 0
        ? result[result.length - 1].club.trim().toLowerCase()
        : null;
    const clubCounts = new Map<string, number>();
    for (const competitor of pool) {
      const club = competitor.club.trim().toLowerCase();
      clubCounts.set(club, (clubCounts.get(club) ?? 0) + 1);
    }

    let bestIndex = -1;
    let bestCount = -1;
    for (let index = 0; index < pool.length; index++) {
      const club = pool[index].club.trim().toLowerCase();
      if (club !== previousClub) {
        const count = clubCounts.get(club) ?? 0;
        if (count > bestCount) {
          bestCount = count;
          bestIndex = index;
        }
      }
    }
    if (bestIndex === -1) bestIndex = 0;
    result.push(pool.splice(bestIndex, 1)[0]);
  }
  return result;
}

export function calculateClassStartDraw(
  competitors: StartDrawCompetitor[],
  options: StartDrawOptions
): StartDrawPlan {
  const eligible = competitors.filter(
    (competitor) =>
      competitor.classId === options.classId &&
      (options.includeAlreadyStarted ||
        competitor.status === 'REGISTERED' ||
        competitor.status === 'DNS' ||
        competitor.status === 'CHECKED')
  );
  const firstStartSec =
    parseClockToSeconds(options.firstStartClock) ?? options.defaultFirstStartSec;

  if (options.mode === 'FREE') {
    return {
      mode: options.mode,
      freeStart: true,
      drawnCount: eligible.length,
      allocations: eligible.map((competitor) => ({
        competitorId: competitor.id,
        allocatedStartSec: null,
      })),
      vacantStartTimes: [],
    };
  }

  if (options.mode === 'MASS') {
    return {
      mode: options.mode,
      freeStart: false,
      drawnCount: eligible.length,
      allocations: eligible.map((competitor) => ({
        competitorId: competitor.id,
        allocatedStartSec: firstStartSec,
      })),
      vacantStartTimes: [],
    };
  }

  const intervalSec = Math.max(15, Number(options.intervalSec) || 120);
  const vacancies = Math.max(
    0,
    Math.min(20, Math.floor(Number(options.vacancies) || 0))
  );
  const ordered = options.clubSeparation
    ? shuffleWithClubSeparation(eligible)
    : shuffle(eligible);
  const vacantStartTimes: string[] = [];
  let nextStartSec = firstStartSec;
  for (let index = 0; index < vacancies; index++) {
    vacantStartTimes.push(formatClock(nextStartSec));
    nextStartSec += intervalSec;
  }

  const allocations = ordered.map((competitor) => {
    const allocation = {
      competitorId: competitor.id,
      allocatedStartSec: nextStartSec,
    };
    nextStartSec += intervalSec;
    return allocation;
  });

  return {
    mode: options.mode,
    freeStart: false,
    drawnCount: eligible.length,
    allocations,
    vacantStartTimes,
  };
}
