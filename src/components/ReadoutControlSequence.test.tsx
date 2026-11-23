import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { CardPunch, ReadoutValidation, SplitLegResult } from '../types/sportident';
import {
  buildReadoutControlSequence,
  ReadoutControlSequence,
} from './ReadoutControlSequence';

interface ControlElementProps {
  children?: ReactNode;
  'aria-label'?: string;
  className?: string;
  'data-control-state'?: string;
}

function findControlElements(node: ReactNode): ReactElement<ControlElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(findControlElements);
  if (!isValidElement<ControlElementProps>(node)) return [];
  const controls = node.props['data-control-state'] ? [node] : [];
  return [...controls, ...findControlElements(node.props.children)];
}

function createValidation(
  controls: Array<{ code: number; status: 'OK' | 'MISSING'; timeSec: number | null }>
): ReadoutValidation {
  const splits: SplitLegResult[] = controls.map((control, index) => ({
    order: index + 1,
    controlCode: control.code,
    label: `(${control.code})`,
    status: control.status,
    punchTimeSec: control.timeSec,
    cumulativeSec: control.timeSec,
    legSec: control.timeSec,
  }));
  return {
    ok: controls.every((control) => control.status === 'OK'),
    matchedCourseId: 'course-1',
    matchedCourseName: 'Course 1',
    missingControls: controls
      .filter((control) => control.status === 'MISSING')
      .map((control) => control.code),
    extraControls: [],
    splits,
  };
}

const correctSplits = [
  { code: 31, status: 'OK' as const, timeSec: 100 },
  { code: 42, status: 'OK' as const, timeSec: 200 },
  { code: 55, status: 'OK' as const, timeSec: 300 },
  { code: 100, status: 'OK' as const, timeSec: 400 },
];

function punches(codes: number[]): CardPunch[] {
  return codes.map((code, index) => ({ code, timeSec: (index + 1) * 100 }));
}

describe('ReadoutControlSequence', () => {
  it('marks every required control as correct for an OK course sequence', () => {
    expect(
      buildReadoutControlSequence(createValidation(correctSplits), punches([31, 42, 55, 100]))
    ).toEqual([
      { code: 31, state: 'correct' },
      { code: 42, state: 'correct' },
      { code: 55, state: 'correct' },
      { code: 100, state: 'correct' },
    ]);
  });

  it('marks a missing required control in parentheses', () => {
    const validation = createValidation([
      correctSplits[0],
      correctSplits[1],
      { code: 55, status: 'MISSING', timeSec: null },
      correctSplits[3],
    ]);

    expect(buildReadoutControlSequence(validation, punches([31, 42, 100]))).toEqual([
      { code: 31, state: 'correct' },
      { code: 42, state: 'correct' },
      { code: 55, state: 'missing' },
      { code: 100, state: 'correct' },
    ]);
  });

  it('marks all missing required controls', () => {
    const validation = createValidation([
      correctSplits[0],
      { code: 42, status: 'MISSING', timeSec: null },
      correctSplits[2],
      { code: 100, status: 'MISSING', timeSec: null },
    ]);

    expect(buildReadoutControlSequence(validation, punches([31, 55]))).toEqual([
      { code: 31, state: 'correct' },
      { code: 42, state: 'missing' },
      { code: 55, state: 'correct' },
      { code: 100, state: 'missing' },
    ]);
  });

  it('keeps extra punches in their actual position without changing required controls', () => {
    const validation = createValidation(correctSplits);

    expect(
      buildReadoutControlSequence(
        validation,
        punches([31, 42, 77, 55, 100])
      )
    ).toEqual([
      { code: 31, state: 'correct' },
      { code: 42, state: 'correct' },
      { code: 77, state: 'extra' },
      { code: 55, state: 'correct' },
      { code: 100, state: 'correct' },
    ]);
  });

  it('renders green correct, red parenthesized missing, and neutral extra controls', () => {
    const validation = createValidation([
      correctSplits[0],
      { code: 42, status: 'MISSING', timeSec: null },
    ]);
    const rendered = ReadoutControlSequence({
      validation,
      punches: punches([31, 77]),
    });
    const controls = findControlElements(rendered);

    expect(
      controls.map((control) => ({
        label: control.props['aria-label'],
        className: control.props.className,
        text: control.props.children,
      }))
    ).toEqual([
      {
        label: 'Kontroll 31 korrekt stämplad',
        className: 'shrink-0 font-mono text-emerald-700 dark:text-emerald-300',
        text: 31,
      },
      {
        label: 'Kontroll 42 saknas',
        className: 'shrink-0 font-mono font-semibold text-red-700 dark:text-red-300',
        text: '(42)',
      },
      {
        label: 'Kontroll 77 extra stämpling',
        className: 'shrink-0 font-mono text-slate-900 dark:text-slate-100',
        text: 77,
      },
    ]);
  });
});
