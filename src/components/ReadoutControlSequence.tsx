import type { CardPunch, ReadoutValidation } from '../types/sportident';

export type ReadoutControlState = 'correct' | 'missing' | 'extra';

export interface ReadoutControlSequenceItem {
  code: number;
  state: ReadoutControlState;
}

export function buildReadoutControlSequence(
  validation: ReadoutValidation,
  punches: CardPunch[]
): ReadoutControlSequenceItem[] {
  const sequence: ReadoutControlSequenceItem[] = [];
  let punchCursor = 0;
  const courseSplits = validation.splits.filter(
    (split) => split.controlCode !== 999
  );

  for (const split of courseSplits) {
    if (split.status !== 'OK' || split.punchTimeSec === null) {
      sequence.push({ code: split.controlCode, state: 'missing' });
      continue;
    }

    let matchedIndex = -1;
    for (let index = punchCursor; index < punches.length; index += 1) {
      if (punches[index].code === split.controlCode) {
        matchedIndex = index;
        break;
      }
    }

    if (matchedIndex === -1) {
      sequence.push({ code: split.controlCode, state: 'correct' });
      continue;
    }

    for (let index = punchCursor; index < matchedIndex; index += 1) {
      sequence.push({ code: punches[index].code, state: 'extra' });
    }
    sequence.push({ code: split.controlCode, state: 'correct' });
    punchCursor = matchedIndex + 1;
  }

  for (let index = punchCursor; index < punches.length; index += 1) {
    sequence.push({ code: punches[index].code, state: 'extra' });
  }

  return sequence;
}

const STATE_CLASSES: Record<ReadoutControlState, string> = {
  correct: 'text-emerald-700 dark:text-emerald-300',
  missing: 'font-semibold text-red-700 dark:text-red-300',
  extra: 'text-slate-900 dark:text-slate-100',
};

const STATE_LABELS: Record<ReadoutControlState, string> = {
  correct: 'korrekt stämplad',
  missing: 'saknas',
  extra: 'extra stämpling',
};

interface ReadoutControlSequenceProps {
  validation: ReadoutValidation;
  punches: CardPunch[];
}

export function ReadoutControlSequence({
  validation,
  punches,
}: ReadoutControlSequenceProps) {
  const sequence = buildReadoutControlSequence(validation, punches);

  return (
    <div
      aria-label="Kontrollföljd"
      className="mt-2 flex min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap text-xs"
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
  );
}
