import type {
  Competitor,
  PublicCompetitorResult,
  RadioSplit,
  RunnerStatus,
} from '../types/sportident';

const RUNNER_STATUSES = new Set<RunnerStatus>([
  'REGISTERED',
  'CHECKED',
  'IN_FOREST',
  'PRELIMINARY_FIN',
  'OK',
  'MP',
  'DNF',
  'DNS',
]);

export interface PublicResultDocument extends Record<string, unknown> {
  competitionId: string;
  competitorId: string;
  bib: number;
  fullName: string;
  club: string;
  classId: string;
  status: RunnerStatus;
  allocatedStartSec: number;
  startTimeSec: number;
  finishTimeSec: number;
  runningTimeSec: number;
  radioSplits?: RadioSplit[];
}

export function createPublicResultDocument(
  competitionId: string,
  competitor: Competitor
): PublicResultDocument {
  return {
    competitionId,
    competitorId: competitor.id,
    bib: competitor.bib,
    fullName: competitor.fullName,
    club: competitor.club,
    classId: competitor.classId,
    status: competitor.status,
    allocatedStartSec: encodeSec(competitor.allocatedStartSec),
    startTimeSec: encodeSec(competitor.startTimeSec),
    finishTimeSec: encodeSec(competitor.finishTimeSec),
    runningTimeSec: encodeSec(competitor.runningTimeSec),
    radioSplits: sanitizeRadioSplits(competitor.radioSplits),
  };
}

export function toPublicCompetitorResult(
  competitor: Competitor
): PublicCompetitorResult {
  return {
    id: competitor.id,
    bib: competitor.bib,
    fullName: competitor.fullName,
    club: competitor.club,
    classId: competitor.classId,
    status: competitor.status,
    allocatedStartSec: competitor.allocatedStartSec,
    startTimeSec: competitor.startTimeSec,
    finishTimeSec: competitor.finishTimeSec,
    runningTimeSec: competitor.runningTimeSec,
    radioSplits: sanitizeRadioSplits(competitor.radioSplits),
  };
}

export function createPublicResultDocumentFromFirestore(
  competitionId: string,
  competitorId: string,
  data: Record<string, unknown>,
  radioSplits?: unknown
): PublicResultDocument {
  return {
    competitionId,
    competitorId,
    bib: boundedInteger(data.bib, 1, 99999, 1),
    fullName: boundedString(data.fullName, 120, 'Deltagare'),
    club: boundedString(data.club, 100, 'Klubblös'),
    classId: boundedString(data.classId, 64, 'cls_open'),
    status: isRunnerStatus(data.status) ? data.status : 'REGISTERED',
    allocatedStartSec: encodeFirestoreSec(data.allocatedStartSec),
    startTimeSec: encodeFirestoreSec(data.startTimeSec),
    finishTimeSec: encodeFirestoreSec(data.finishTimeSec),
    runningTimeSec: encodeFirestoreSec(data.runningTimeSec),
    ...(radioSplits === undefined
      ? {}
      : { radioSplits: sanitizeRadioSplits(radioSplits) }),
  };
}

export function parsePublicResultDocument(
  documentId: string,
  data: Record<string, unknown>
): PublicCompetitorResult | null {
  const id =
    typeof data.competitorId === 'string' && data.competitorId
      ? data.competitorId
      : documentId;
  if (!id || !isRunnerStatus(data.status)) return null;

  return {
    id,
    bib: boundedInteger(data.bib, 1, 99999, 1),
    fullName: boundedString(data.fullName, 120, 'Deltagare'),
    club: boundedString(data.club, 100, 'Klubblös'),
    classId: boundedString(data.classId, 64, 'cls_open'),
    status: data.status,
    allocatedStartSec: decodeFirestoreSec(data.allocatedStartSec),
    startTimeSec: decodeFirestoreSec(data.startTimeSec),
    finishTimeSec: decodeFirestoreSec(data.finishTimeSec),
    runningTimeSec: decodeFirestoreSec(data.runningTimeSec),
    radioSplits: sanitizeRadioSplits(data.radioSplits),
  };
}

export function toPublicResultCompetitor(
  result: PublicCompetitorResult
): Competitor {
  return {
    ...result,
    siNumber: 0,
    cardSeries: 'SI-Card 10',
    isRentalCard: false,
    rentalReturned: false,
    checkTimeSec: null,
    manualFinishTimeSec: null,
    lastSeenControl: null,
    lastSeenTimeSec: result.finishTimeSec,
    readoutAt: null,
    cardPunches: [],
    rawReadout: null,
    validation: null,
  };
}

export function addPublicRadioSplit(
  current: unknown,
  split: RadioSplit
): RadioSplit[] {
  return sanitizeRadioSplits([...(Array.isArray(current) ? current : []), split]);
}

function sanitizeRadioSplits(value: unknown): RadioSplit[] {
  if (!Array.isArray(value)) return [];
  const byControl = new Map<number, RadioSplit>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const split = candidate as Record<string, unknown>;
    const controlCode = boundedInteger(split.controlCode, 1, 999, 0);
    const punchTimeSec = boundedInteger(split.punchTimeSec, 0, 86400, -1);
    if (!controlCode || punchTimeSec < 0) continue;
    const radioSplit: RadioSplit = {
      controlCode,
      stationName: boundedString(split.stationName, 120, `(${controlCode})`),
      punchTimeSec,
      runningTimeSec: decodeFirestoreSec(split.runningTimeSec),
      isPrewarning: split.isPrewarning === true,
    };
    const existing = byControl.get(controlCode);
    if (!existing || radioSplit.punchTimeSec < existing.punchTimeSec) {
      byControl.set(controlCode, radioSplit);
    }
  }
  return Array.from(byControl.values()).sort(
    (left, right) =>
      left.punchTimeSec - right.punchTimeSec ||
      left.controlCode - right.controlCode
  );
}

function isRunnerStatus(value: unknown): value is RunnerStatus {
  return typeof value === 'string' && RUNNER_STATUSES.has(value as RunnerStatus);
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function boundedString(value: unknown, maximum: number, fallback: string): string {
  return typeof value === 'string' && value.length <= maximum
    ? value
    : fallback;
}

function encodeSec(value: number | null): number {
  return value !== null && Number.isInteger(value) && value >= 0 && value <= 86400
    ? value
    : -1;
}

function encodeFirestoreSec(value: unknown): number {
  if (typeof value !== 'number') return -1;
  const number = value;
  return Number.isInteger(number) && number >= 0 && number <= 86400 ? number : -1;
}

function decodeFirestoreSec(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  const number = value;
  return Number.isInteger(number) && number >= 0 && number <= 86400 ? number : null;
}
