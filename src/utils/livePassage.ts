import type { Competitor } from '../types/sportident';

const SECONDS_PER_DAY = 24 * 60 * 60;

const stockholmClockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Stockholm',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export interface LivePassageProgress {
  nextRadioControlCode: number | null;
  completedRadioCount: number;
  projectedPassageTimeSec: number | null;
}

export function getProjectedPassageTimeSec(
  actualStartTimeSec: number | null,
  nowMs: number
): number | null {
  if (
    actualStartTimeSec === null ||
    !Number.isInteger(actualStartTimeSec) ||
    actualStartTimeSec < 0 ||
    actualStartTimeSec >= SECONDS_PER_DAY ||
    !Number.isFinite(nowMs)
  ) {
    return null;
  }

  const parts = stockholmClockFormatter.formatToParts(new Date(nowMs));
  const values = new Map(parts.map((part) => [part.type, Number(part.value)]));
  const hour = values.get('hour');
  const minute = values.get('minute');
  const second = values.get('second');
  if (
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    ![hour, minute, second].every(Number.isFinite)
  ) {
    return null;
  }

  const currentTimeSec = hour * 3600 + minute * 60 + second;
  const difference = currentTimeSec - actualStartTimeSec;
  const elapsedSec =
    difference < -12 * 3600 ? difference + SECONDS_PER_DAY : difference;
  return elapsedSec >= 0 ? elapsedSec : null;
}

export function getLivePassageProgress(
  competitor: Pick<
    Competitor,
    'radioSplits' | 'startTimeSec' | 'allocatedStartSec' | 'validation'
  >,
  radioControlCodes: number[],
  nowMs: number
): LivePassageProgress {
  const passedControlCodes = new Set(
    competitor.radioSplits.map((split) => split.controlCode)
  );
  competitor.validation?.splits.forEach((split) => {
    if (split.cumulativeSec !== null && Number.isFinite(split.cumulativeSec)) {
      passedControlCodes.add(split.controlCode);
    }
  });
  const nextPassageIndex = radioControlCodes.findIndex(
    (controlCode) => !passedControlCodes.has(controlCode)
  );

  return {
    nextRadioControlCode:
      nextPassageIndex === -1 ? null : radioControlCodes[nextPassageIndex],
    completedRadioCount: radioControlCodes.filter((controlCode) =>
      passedControlCodes.has(controlCode)
    ).length,
    projectedPassageTimeSec: getProjectedPassageTimeSec(
      competitor.startTimeSec ?? competitor.allocatedStartSec,
      nowMs
    ),
  };
}
