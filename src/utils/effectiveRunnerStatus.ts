import type { CompetitionMeta, Competitor, RunnerStatus } from '../types/sportident';

export type CompetitorWithEffectiveStatus = Competitor & {
  effectiveStatus: RunnerStatus;
};

export type CompetitorWithOptionalEffectiveStatus = Competitor & {
  effectiveStatus?: RunnerStatus;
};

export type StartCorralStatusAction = 'CHECK' | 'START_PUNCH';

export function transitionStartCorralStatus(
  status: RunnerStatus,
  action: StartCorralStatusAction
): RunnerStatus {
  if (action === 'CHECK') {
    return status === 'REGISTERED' || status === 'DNS' ? 'CHECKED' : status;
  }
  return status === 'REGISTERED' || status === 'CHECKED' || status === 'DNS'
    ? 'IN_FOREST'
    : status;
}

interface StockholmDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const stockholmDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function getStockholmDateTime(timestampMs: number): StockholmDateTime | null {
  if (!Number.isFinite(timestampMs)) return null;
  const parts = stockholmDateTimeFormatter.formatToParts(new Date(timestampMs));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const result = {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute')),
    second: Number(values.get('second')),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

function parseCompetitionDate(
  date: string
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function isValidAllocatedStart(
  allocatedStartSec: number | null
): allocatedStartSec is number {
  return (
    Number.isInteger(allocatedStartSec) &&
    allocatedStartSec !== null &&
    allocatedStartSec >= 0 &&
    allocatedStartSec < 86400
  );
}

export function getScheduledStartTimestamp(
  competitionDate: string,
  allocatedStartSec: number | null
): number | null {
  const date = parseCompetitionDate(competitionDate);
  if (!date || !isValidAllocatedStart(allocatedStartSec)) return null;
  const hour = Math.floor(allocatedStartSec / 3600);
  const minute = Math.floor((allocatedStartSec % 3600) / 60);
  const second = allocatedStartSec % 60;
  const wallClockAsUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    hour,
    minute,
    second
  );
  let timestamp = wallClockAsUtc;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const local = getStockholmDateTime(timestamp);
    if (!local) return null;
    const representedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second
    );
    const adjustedTimestamp =
      wallClockAsUtc - (representedAsUtc - timestamp);
    if (adjustedTimestamp === timestamp) break;
    timestamp = adjustedTimestamp;
  }

  const resolved = getStockholmDateTime(timestamp);
  if (
    !resolved ||
    resolved.year !== date.year ||
    resolved.month !== date.month ||
    resolved.day !== date.day ||
    resolved.hour !== hour ||
    resolved.minute !== minute ||
    resolved.second !== second
  ) {
    return null;
  }
  return timestamp;
}

export function getEffectiveRunnerStatus(
  competitor: Pick<Competitor, 'status' | 'allocatedStartSec'>,
  competition: Pick<CompetitionMeta, 'date' | 'status'>,
  nowMs: number
): RunnerStatus {
  if (
    competitor.status !== 'CHECKED' ||
    competition.status === 'COMPLETED' ||
    !isValidAllocatedStart(competitor.allocatedStartSec)
  ) {
    return competitor.status;
  }

  const scheduledStart = getScheduledStartTimestamp(
    competition.date,
    competitor.allocatedStartSec
  );
  if (scheduledStart === null || !Number.isFinite(nowMs)) return competitor.status;
  return nowMs >= scheduledStart ? 'IN_FOREST' : competitor.status;
}

export function getCompetitorEffectiveStatus(
  competitor: CompetitorWithOptionalEffectiveStatus
): RunnerStatus {
  return competitor.effectiveStatus ?? competitor.status;
}

export function withEffectiveStatus(
  competitor: Competitor,
  competition: Pick<CompetitionMeta, 'date' | 'status'>,
  nowMs: number
): CompetitorWithEffectiveStatus {
  return {
    ...competitor,
    effectiveStatus: getEffectiveRunnerStatus(competitor, competition, nowMs),
  };
}
