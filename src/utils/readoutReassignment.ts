import type {
  CardPunch,
  CompClass,
  Competitor,
  Course,
  EmergencySettings,
  ReadoutValidation,
  RunnerStatus,
} from '../types/sportident';
import { getCompetitorPlacement } from '../services/readoutSummary';
import { applyEmergencyTimeOffsets, validateCompetitorReadout } from './readoutValidation';

export interface ReassignmentReadoutData {
  clientReadoutId: string;
  capturedAt: string;
  checkTimeSec: number | null;
  startTimeSec: number | null;
  finishTimeSec: number | null;
  punches: CardPunch[];
}

export interface ReadoutReassignmentPreview {
  competitor: Competitor;
  status: RunnerStatus;
  finishTimeSec: number;
  runningTimeSec: number;
  bomSec: number | null;
  placing: { pos: number; total: number } | null;
  validation: ReadoutValidation;
}

const REASSIGNABLE_TARGET_STATUSES = new Set<RunnerStatus>([
  'REGISTERED',
  'CHECKED',
  'IN_FOREST',
]);

export function calculateReadoutReassignmentPreview(
  readout: ReassignmentReadoutData,
  originalCompetitorId: string,
  target: Competitor,
  competitors: Competitor[],
  classes: CompClass[],
  courses: Course[],
  zeroTimeSec: number,
  emergency: EmergencySettings
): ReadoutReassignmentPreview {
  if (!originalCompetitorId || target.id === originalCompetitorId) {
    throw new Error('Välj en annan löpare än den ursprungliga matchningen.');
  }
  const original = competitors.find(
    (candidate) => candidate.id === originalCompetitorId
  );
  if (!original || !competitors.some((candidate) => candidate.id === target.id)) {
    throw new Error('Den ursprungliga eller valda löparen hittades inte i tävlingen.');
  }
  if (!REASSIGNABLE_TARGET_STATUSES.has(target.status)) {
    throw new Error('Löparen har redan ett resultat eller kan inte ta emot avläsningen.');
  }
  if (
    target.manualFinishTimeSec != null ||
    target.readoutAt != null ||
    target.rawReadout != null ||
    target.cardPunches.length > 0
  ) {
    throw new Error('Löparen har redan avläsningsdata som måste utredas först.');
  }
  if (
    !Number.isInteger(readout.finishTimeSec) ||
    readout.finishTimeSec === null ||
    readout.finishTimeSec < 0 ||
    readout.finishTimeSec > 86400 ||
    !Number.isInteger(zeroTimeSec) ||
    zeroTimeSec < 0 ||
    zeroTimeSec > 86400
  ) {
    throw new Error('Avläsningen saknar en giltig måltid eller tävlingstid.');
  }

  const firstPunch = readout.punches[0];
  const staleCardStart =
    readout.startTimeSec !== null &&
    firstPunch !== undefined &&
    readout.startTimeSec > firstPunch.timeSec &&
    target.startTimeSec !== null &&
    target.startTimeSec <= firstPunch.timeSec;
  const usableCardStart = staleCardStart ? null : readout.startTimeSec;
  const effectiveStart =
    usableCardStart ??
    target.startTimeSec ??
    target.allocatedStartSec ??
    zeroTimeSec;
  const finishTimeSec = readout.finishTimeSec;
  const validation = validateCompetitorReadout(
    classes.find((candidate) => candidate.id === target.classId),
    courses,
    effectiveStart,
    finishTimeSec,
    readout.punches,
    emergency
  );
  const status: RunnerStatus = validation.ok ? 'OK' : 'MP';
  const correctedCompetitor: Competitor = {
    ...target,
    status,
    checkTimeSec: readout.checkTimeSec ?? target.checkTimeSec,
    startTimeSec: usableCardStart ?? target.startTimeSec,
    finishTimeSec,
    runningTimeSec: Math.max(0, finishTimeSec - effectiveStart),
    lastSeenControl: readout.punches.length > 0 ? 1 : target.lastSeenControl,
    lastSeenTimeSec: finishTimeSec,
    readoutAt: readout.capturedAt,
    cardPunches: applyEmergencyTimeOffsets(
      readout.punches,
      emergency.controlTimeOffsets
    ),
    rawReadout: {
      checkTimeSec: readout.checkTimeSec,
      startTimeSec: usableCardStart,
      finishTimeSec,
      punches: readout.punches.map((punch) => ({ ...punch })),
      receivedAt: readout.capturedAt,
      clientReadoutId: readout.clientReadoutId,
    },
    validation,
  };
  const resetOriginal: Competitor = {
    ...original,
    status: 'REGISTERED',
    checkTimeSec: null,
    startTimeSec: null,
    finishTimeSec: null,
    runningTimeSec: null,
    lastSeenControl: null,
    lastSeenTimeSec: null,
    readoutAt: null,
    cardPunches: [],
    rawReadout: null,
    validation: null,
  };
  const projectedCompetitors = competitors.map((candidate) =>
    candidate.id === originalCompetitorId
      ? resetOriginal
      : candidate.id === target.id
        ? correctedCompetitor
        : candidate
  );

  return {
    competitor: correctedCompetitor,
    status,
    finishTimeSec,
    runningTimeSec: correctedCompetitor.runningTimeSec ?? 0,
    bomSec: validation.totalTimeLossSec ?? null,
    placing:
      status === 'OK'
        ? getCompetitorPlacement(correctedCompetitor, projectedCompetitors)
        : null,
    validation,
  };
}
