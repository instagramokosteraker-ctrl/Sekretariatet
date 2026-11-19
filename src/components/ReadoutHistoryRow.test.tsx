import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ReadoutHistoryRecord } from '../services/readoutHistoryStore';
import { ReadoutHistoryRow } from './ReadoutHistoryRow';

interface TestElementProps {
  children?: ReactNode;
  onClick?: () => void;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  className?: string;
  type?: string;
}

function findButtons(node: ReactNode): ReactElement<TestElementProps>[] {
  if (Array.isArray(node)) {
    return node.flatMap(findButtons);
  }
  if (!isValidElement<TestElementProps>(node)) {
    return [];
  }

  const buttons = node.type === 'button' ? [node] : [];
  return [...buttons, ...findButtons(node.props.children)];
}

function makeRecord(
  overrides: Partial<ReadoutHistoryRecord> = {}
): ReadoutHistoryRecord {
  const record: ReadoutHistoryRecord = {
    clientReadoutId: 'readout-1',
    captureSequence: 1,
    capturedAt: '2026-11-19T10:00:00.000Z',
    eventId: 'event-1',
    readout: {
      clientReadoutId: 'readout-1',
      captureSequence: 1,
      capturedAt: '2026-11-19T10:00:00.000Z',
      siNumber: 123456,
      cardSeries: 'SI-Card 9',
      stationCode: 8,
      checkTimeSec: null,
      startTimeSec: null,
      finishTimeSec: 3600,
      punches: [{ code: 31, timeSec: 1800 }],
      source: 'USB_WEBSERIAL',
    },
    readoutState: 'PROCESSED',
    deliveryState: 'SYNCED',
    competitorId: 'competitor-1',
    competitorName: 'Test Runner',
    className: 'D21',
    resultStatus: 'OK',
    competitorSnapshot: null,
    originalCompetitorId: 'competitor-1',
    originalCompetitorName: 'Test Runner',
    originalClassName: 'D21',
    originalResultStatus: 'OK',
    originalCompetitorSnapshot: null,
    issueType: null,
    issueState: 'NONE',
    correctionOperationId: null,
    correctionAudit: [],
    suggestedRunner: null,
    syncError: null,
  };
  return { ...record, ...overrides };
}

const reopenCases: Array<{
  label: string;
  record: ReadoutHistoryRecord;
}> = [
  { label: 'OK', record: makeRecord() },
  { label: 'MP', record: makeRecord({ resultStatus: 'MP', originalResultStatus: 'MP' }) },
  {
    label: 'unknown-card',
    record: makeRecord({
      readoutState: 'UNKNOWN',
      competitorId: null,
      competitorName: null,
      resultStatus: null,
      issueType: 'UNKNOWN_CARD',
      issueState: 'OPEN',
    }),
  },
  {
    label: 'duplicate-readout',
    record: makeRecord({
      issueType: 'DUPLICATE_READOUT',
      issueState: 'NONE',
    }),
  },
];

describe('ReadoutHistoryRow', () => {
  it.each(reopenCases)('$label rows open their selected readout', ({ record }) => {
    let selectedRecord: ReadoutHistoryRecord | null = null;
    const onSelect = vi.fn((selected: ReadoutHistoryRecord) => {
      selectedRecord = selected;
    });
    const element = ReadoutHistoryRow({
      record,
      isSelected: false,
      onSelect,
    });
    const rowButton = findButtons(element).find((button) =>
      button.props['aria-label']?.startsWith('Öppna avläsning')
    );

    expect(rowButton).toBeDefined();
    expect(rowButton?.props.type).toBe('button');
    expect(rowButton?.props['aria-pressed']).toBe(false);
    expect(rowButton?.props.className).toContain('cursor-pointer');
    expect(rowButton?.props.className).toContain('hover:bg-');
    expect(rowButton?.props.className).toContain('px-3 py-2');

    rowButton?.props.onClick?.();

    expect(onSelect).toHaveBeenCalledWith(record);
    expect(selectedRecord).toBe(record);
  });

  it('keeps the unknown-card registration action separate from opening the row', () => {
    const record = reopenCases.find(({ label }) => label === 'unknown-card')!.record;
    const onSelect = vi.fn();
    const buttons = findButtons(
      ReadoutHistoryRow({ record, isSelected: false, onSelect })
    );
    const registerButton = buttons.find((button) => button.props.children === 'Anmäl');

    expect(buttons).toHaveLength(2);
    expect(registerButton).toBeDefined();

    registerButton?.props.onClick?.();

    expect(onSelect).toHaveBeenCalledWith(record, true);
  });

  it('exposes selected state on the open-details button', () => {
    const record = reopenCases[0].record;
    const rowButton = findButtons(
      ReadoutHistoryRow({
        record,
        isSelected: true,
        onSelect: vi.fn(),
      })
    ).find((button) => button.props['aria-label']?.startsWith('Öppna avläsning'));

    expect(rowButton?.props['aria-pressed']).toBe(true);
  });
});
