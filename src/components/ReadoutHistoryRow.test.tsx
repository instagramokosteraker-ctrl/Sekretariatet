import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ReadoutHistoryRecord } from '../services/readoutHistoryStore';
import { ReadoutHistoryRow } from './ReadoutHistoryRow';

interface TestElementProps {
  children?: ReactNode;
  onClick?: () => void;
  'aria-label'?: string;
  'aria-expanded'?: boolean;
  'aria-pressed'?: boolean;
  className?: string;
  'data-readout-primary-state'?: string;
  'data-readout-history-primary'?: string;
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

function findText(node: ReactNode): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(findText);
  if (!isValidElement<TestElementProps>(node)) return [];
  return findText(node.props.children);
}

function findPrimaryStateLabels(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(findPrimaryStateLabels);
  if (!isValidElement<TestElementProps>(node)) return [];
  if (node.props['data-readout-primary-state'] === 'true') {
    return findText(node.props.children);
  }
  return findPrimaryStateLabels(node.props.children);
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
    receiptStatus: 'PROCESSED',
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
      isLatest: false,
      isExpanded: false,
      placementLabel: '—',
      onSelect,
    });
    const rowButton = findButtons(element).find((button) =>
      button.props['aria-label']?.startsWith('Öppna avläsning')
    );

    expect(rowButton).toBeDefined();
    expect(rowButton?.props.type).toBe('button');
    expect(rowButton?.props['aria-expanded']).toBe(false);
    expect(rowButton?.props.className).toContain('cursor-pointer');
    expect(rowButton?.props.className).toContain('hover:bg-');
    expect(rowButton?.props.className).toContain('px-3 py-2');

    rowButton?.props.onClick?.();

    expect(onSelect).toHaveBeenCalledWith(record);
    expect(selectedRecord).toBe(record);
  });

  it('keeps unknown-card registration inside the expanded row', () => {
    const record = reopenCases.find(({ label }) => label === 'unknown-card')!.record;
    const onSelect = vi.fn();
    const collapsed = ReadoutHistoryRow({
      record,
      isLatest: false,
      isExpanded: false,
      placementLabel: '—',
      onSelect,
      children: <button type="button">Anmäl</button>,
    });

    expect(findButtons(collapsed)).toHaveLength(1);
    expect(findText(collapsed)).not.toContain('Anmäl');

    const expanded = ReadoutHistoryRow({
      record,
      isLatest: false,
      isExpanded: true,
      placementLabel: '—',
      onSelect,
      children: <button type="button">Anmäl</button>,
    });

    expect(findText(expanded)).toContain('Anmäl');
  });

  it('keeps reassignment inside the expanded row', () => {
    const record = reopenCases[0].record;
    const collapsed = ReadoutHistoryRow({
      record: makeRecord({ issueType: 'WRONG_COMPETITOR', issueState: 'OPEN' }),
      isLatest: false,
      isExpanded: false,
      placementLabel: '—',
      onSelect: vi.fn(),
    });
    const expanded = ReadoutHistoryRow({
      record,
      isLatest: false,
      isExpanded: true,
      placementLabel: '—',
      onSelect: vi.fn(),
      children: (
        <>
          <div>Resultat: OK</div>
          <button type="button">Fel löpare</button>
        </>
      ),
    });

    expect(findPrimaryStateLabels(collapsed)).toEqual(['OK']);
    expect(findText(collapsed)).not.toContain('Fel löpare');
    expect(findText(expanded)).toContain('Resultat: OK');
    expect(findText(expanded)).toContain('Fel löpare');
  });

  it('hides reassignment when the receipt is not a processed result', () => {
    const record = makeRecord({ receiptStatus: 'UNKNOWN' });
    const buttons = findButtons(
      ReadoutHistoryRow({
        record,
        isLatest: false,
        isExpanded: false,
        placementLabel: '—',
        onSelect: vi.fn(),
      })
    );

    expect(buttons.some((button) => button.props.children === 'Fel löpare')).toBe(false);
  });

  it('exposes selected state on the open-details button', () => {
    const record = reopenCases[0].record;
    const rowButton = findButtons(
      ReadoutHistoryRow({
        record,
        isLatest: true,
        isExpanded: true,
        placementLabel: '1/2',
        onSelect: vi.fn(),
      })
    ).find((button) => button.props['aria-label']?.startsWith('Öppna avläsning'));

    expect(rowButton?.props['aria-expanded']).toBe(true);
  });

  it('shows the latest badge and renders expanded actions within the row', () => {
    const record = reopenCases[0].record;
    const element = ReadoutHistoryRow({
      record,
      isLatest: true,
      isExpanded: true,
      placementLabel: '1/1',
      onSelect: vi.fn(),
      children: <div>Row actions</div>,
    });

    const text = findText(element).join('');
    expect(text).toContain('Senaste');
    expect(text).toContain('Placering: 1/1');
    expect(text).toContain('Row actions');
  });

  it('renders the result status instead of workflow labels in the collapsed row', () => {
    const record = makeRecord({
      issueType: 'WRONG_COMPETITOR',
      issueState: 'OPEN',
    });
    const element = ReadoutHistoryRow({
      record,
      isLatest: false,
      isExpanded: false,
      placementLabel: '1/1',
      onSelect: vi.fn(),
    });
    const text = findText(element);

    expect(text).toContain('OK');
    expect(text).not.toContain('Fel löpare');
    expect(text).not.toContain('Åtgärd krävs');
    expect(text).not.toContain('Synkad');
    expect(element.props.className).toContain('bg-emerald-100');
    expect(element.props.className).not.toContain('bg-orange');
  });

  it.each([
    { label: 'OK', record: makeRecord() },
    { label: 'MP', record: makeRecord({ resultStatus: 'MP' }) },
    {
      label: 'Okänd bricka',
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
      label: 'OK',
      record: makeRecord({
        issueType: 'WRONG_COMPETITOR',
        issueState: 'OPEN',
      }),
    },
    {
      label: 'MP',
      record: makeRecord({
        resultStatus: 'MP',
        issueType: 'MP_REVIEW',
        issueState: 'OPEN',
      }),
    },
    {
      label: 'Redan avläst',
      record: makeRecord({
        issueType: 'DUPLICATE_READOUT',
        issueState: 'NONE',
      }),
    },
  ])('shows only $label as the collapsed result/readout status', ({ label, record }) => {
    const element = ReadoutHistoryRow({
      record,
      isLatest: false,
      isExpanded: false,
      placementLabel: '—',
      onSelect: vi.fn(),
    });
    const text = findText(element);

    expect(findPrimaryStateLabels(element)).toEqual([label]);
    expect(text).not.toContain('Synkad');
    expect(text).not.toContain('Löst');
    expect(text).not.toContain('Fel löpare');
    expect(text).not.toContain('MP-granskning');
    expect(text).not.toContain('Åtgärd krävs');
  });
});
