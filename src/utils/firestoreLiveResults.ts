import { validateCompetitorReadout } from './readoutValidation';
import type {
  CardPunch,
  CompClass,
  Competitor,
  Course,
  EmergencySettings,
  RadioSplit,
  RunnerStatus,
  SICardSeries,
  StationFunction,
} from '../types/sportident';

export interface FirestoreCompetitorContext {
  classes: CompClass[];
  courses: Course[];
  competitionZeroTimeSec: number;
  emergency: EmergencySettings;
}

export interface FirestoreLiveRadioPunch {
  competitorId: string;
  siNumber: number;
  stationCode: number;
  stationName: string;
  stationFunction: Extract<StationFunction, 'RADIO' | 'PREWARNING'>;
  punchTimeSec: number;
  runningTimeSec: number | null;
}

export function mapFirestoreCompetitor(
  documentId: string,
  data: Record<string, unknown>,
  context: FirestoreCompetitorContext
): Competitor {
  const codes = Array.isArray(data.punchCodes) ? data.punchCodes.map(Number) : [];
  const times = Array.isArray(data.punchTimes) ? data.punchTimes.map(Number) : [];
  const punches: CardPunch[] = [];
  for (let index = 0; index < Math.min(codes.length, times.length); index += 1) {
    punches.push({ code: codes[index], timeSec: times[index] });
  }

  const checkSec = decodeNullableSec(data.checkTimeSec);
  const startSec = decodeNullableSec(data.startTimeSec);
  const finishSec = decodeNullableSec(data.finishTimeSec);
  const manualFinishSec = decodeNullableSec(data.manualFinishTimeSec);
  const allocatedStartSec = decodeNullableSec(data.allocatedStartSec);
  const readoutAtIso = typeof data.readoutAtIso === 'string' ? data.readoutAtIso : '';
  const hasReadout = Boolean(readoutAtIso) || punches.length > 0;
  const effectiveFinish = manualFinishSec ?? finishSec;
  const classId = typeof data.classId === 'string' ? data.classId : '';
  const validation =
    hasReadout && effectiveFinish !== null
      ? validateCompetitorReadout(
          context.classes.find((candidate) => candidate.id === classId),
          context.courses,
          startSec ?? allocatedStartSec ?? context.competitionZeroTimeSec,
          effectiveFinish,
          punches,
          context.emergency
        )
      : null;

  return {
    id: typeof data.competitorId === 'string' ? data.competitorId : documentId,
    ...(typeof data.eventorPersonId === 'string'
      ? { eventorPersonId: data.eventorPersonId }
      : {}),
    ...(typeof data.eventorOrgId === 'string'
      ? { eventorOrgId: data.eventorOrgId }
      : {}),
    bib: Number(data.bib || 1),
    fullName: typeof data.fullName === 'string' ? data.fullName : 'Deltagare',
    club: typeof data.club === 'string' ? data.club : 'Klubblös',
    classId: classId || context.classes[0]?.id || 'cls_open',
    siNumber: Number(data.siNumber || 1000),
    cardSeries: (data.cardSeries || 'SI-Card 10') as SICardSeries,
    isRentalCard: Boolean(data.isRentalCard),
    ...(typeof data.isBorrowedCard === 'boolean'
      ? { isBorrowedCard: data.isBorrowedCard }
      : {}),
    rentalReturned: Boolean(data.rentalReturned),
    status: (data.status || 'REGISTERED') as RunnerStatus,
    allocatedStartSec,
    checkTimeSec: checkSec,
    startTimeSec: startSec,
    finishTimeSec: finishSec,
    manualFinishTimeSec: manualFinishSec,
    runningTimeSec: decodeNullableSec(data.runningTimeSec),
    lastSeenControl: punches.length > 0 ? 1 : null,
    lastSeenTimeSec: finishSec ?? startSec ?? checkSec,
    readoutAt: readoutAtIso || null,
    radioSplits: [],
    cardPunches: punches,
    rawReadout: hasReadout
      ? {
          checkTimeSec: checkSec,
          startTimeSec: startSec,
          finishTimeSec: finishSec,
          punches,
          receivedAt: readoutAtIso || new Date().toISOString(),
        }
      : null,
    validation,
  };
}

export function applyFirestoreRadioPunches(
  competitors: Competitor[],
  punches: FirestoreLiveRadioPunch[]
): Competitor[] {
  const competitorsById = new Map(competitors.map((competitor) => [competitor.id, competitor]));
  const splitsByCompetitor = new Map<string, Map<number, RadioSplit>>();

  for (const punch of punches) {
    const competitor = competitorsById.get(punch.competitorId);
    if (
      !punch.competitorId ||
      !competitor ||
      competitor.siNumber !== punch.siNumber ||
      !Number.isInteger(punch.siNumber) ||
      !Number.isInteger(punch.stationCode) ||
      !Number.isInteger(punch.punchTimeSec)
    ) {
      continue;
    }

    let splits = splitsByCompetitor.get(punch.competitorId);
    if (!splits) {
      splits = new Map<number, RadioSplit>();
      splitsByCompetitor.set(punch.competitorId, splits);
    }
    const split: RadioSplit = {
      controlCode: punch.stationCode,
      stationName: punch.stationName || `(${punch.stationCode})`,
      punchTimeSec: punch.punchTimeSec,
      runningTimeSec: punch.runningTimeSec,
      isPrewarning: punch.stationFunction === 'PREWARNING',
    };
    const current = splits.get(split.controlCode);
    if (!current || split.punchTimeSec < current.punchTimeSec) {
      splits.set(split.controlCode, split);
    }
  }

  return competitors.map((competitor) => {
    const radioSplits = Array.from(
      (splitsByCompetitor.get(competitor.id) ?? new Map<number, RadioSplit>()).values()
    )
      .sort(
        (left, right) =>
          left.punchTimeSec - right.punchTimeSec ||
          left.controlCode - right.controlCode
      );
    return { ...competitor, radioSplits };
  });
}

function decodeNullableSec(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
