import type { CardPunch, ReadoutValidation } from '../types/sportident';

export type ReadoutControlState = 'correct' | 'missing' | 'extra' | 'unassigned';

export interface ReadoutControlSequenceItem {
  code: number;
  state: ReadoutControlState;
}

export function buildReadoutControlSequence(
  validation: ReadoutValidation | null,
  punches: CardPunch[],
  excludedControlCodes: ReadonlySet<number> = new Set()
): ReadoutControlSequenceItem[] {
  if (!validation) {
    return punches
      .filter((punch) => !excludedControlCodes.has(punch.code))
      .map((punch) => ({ code: punch.code, state: 'unassigned' }));
  }

  const sequence: ReadoutControlSequenceItem[] = [];
  let punchCursor = 0;
  const courseSplits = validation.splits.filter(
    (split) => split.controlCode !== 999
  );
  const courseCodes = new Set(courseSplits.map((split) => split.controlCode));
  const coursePunches = punches.filter(
    (punch) =>
      !excludedControlCodes.has(punch.code) || courseCodes.has(punch.code)
  );

  for (const split of courseSplits) {
    if (split.status !== 'OK' || split.punchTimeSec === null) {
      sequence.push({ code: split.controlCode, state: 'missing' });
      continue;
    }

    let matchedIndex = -1;
    for (let index = punchCursor; index < coursePunches.length; index += 1) {
      if (coursePunches[index].code === split.controlCode) {
        matchedIndex = index;
        break;
      }
    }

    if (matchedIndex === -1) {
      sequence.push({ code: split.controlCode, state: 'correct' });
      continue;
    }

    for (let index = punchCursor; index < matchedIndex; index += 1) {
      sequence.push({ code: coursePunches[index].code, state: 'extra' });
    }
    sequence.push({ code: split.controlCode, state: 'correct' });
    punchCursor = matchedIndex + 1;
  }

  for (let index = punchCursor; index < coursePunches.length; index += 1) {
    sequence.push({ code: coursePunches[index].code, state: 'extra' });
  }

  return sequence;
}

const STATE_CLASSES: Record<ReadoutControlState, string> = {
  correct: 'text-emerald-700 dark:text-emerald-300',
  missing: 'font-semibold text-red-700 dark:text-red-300',
  extra: 'text-slate-900 dark:text-slate-100',
  unassigned: 'text-slate-900 dark:text-slate-100',
};

const STATE_LABELS: Record<ReadoutControlState, string> = {
  correct: 'korrekt stämplad',
  missing: 'saknas',
  extra: 'extra stämpling',
  unassigned: 'stämpling utan kursmatchning',
};

interface ReadoutControlSequenceProps {
  validation: ReadoutValidation | null;
  punches: CardPunch[];
  excludedControlCodes?: ReadonlySet<number>;
  startTimeSec: number | null;
  finishTimeSec: number | null;
  showStartStamp: boolean;
}

export function ReadoutControlSequence({
  validation,
  punches,
  excludedControlCodes = new Set(),
  startTimeSec,
  finishTimeSec,
  showStartStamp,
}: ReadoutControlSequenceProps) {
  const sequence = buildReadoutControlSequence(
    validation,
    punches,
    excludedControlCodes
  );
  const startStatus =
    startTimeSec != null && Number.isFinite(startTimeSec) && startTimeSec >= 0
      ? 'OK'
      : 'Saknas';
  const finishStatus =
    finishTimeSec != null && Number.isFinite(finishTimeSec) && finishTimeSec >= 0
      ? 'OK'
      : 'Saknas';

  return (
    <div className="mt-2 text-xs">
      <div
        aria-label="Kontrollföljd"
        className="flex min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap"
      >
        <span className="shrink-0 text-slate-600 dark:text-slate-400">
          Kontroller:
        </span>
        {sequence.map((item, index) => (
          <span
            key={`${item.code}-${item.state}-${index}`}
            aria-label={`Kontroll ${item.code} ${STATE_LABELS[item.state]}`}
            className={`shrink-0 font-mono ${STATE_CLASSES[item.state]}`}
            data-control-state={item.state}
          >
            {item.state === 'missing' ? `(${item.code})` : item.code}
          </span>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 text-slate-700 dark:text-slate-300">
        {showStartStamp && (
          <span>
            Startstämpling: <span className="font-semibold">{startStatus}</span>
          </span>
        )}
        <span>
          Målstämpling: <span className="font-semibold">{finishStatus}</span>
        </span>
      </div>
    </div>
  );
}
