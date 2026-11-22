import { describe, expect, it } from 'vitest';
import type { ReadoutHistoryRecord } from '../services/readoutHistoryStore';
import { getReadoutTimelineItems } from './readoutTimeline';

function makeRecord(
  id: string,
  sequence: number,
  overrides: Partial<ReadoutHistoryRecord> = {}
): ReadoutHistoryRecord {
  return {
    clientReadoutId: id,
    captureSequence: sequence,
    capturedAt: `2026-11-22T09:${String(sequence % 60).padStart(2, '0')}:00.000Z`,
    eventId: 'event-1',
    readout: {
      clientReadoutId: id,
      captureSequence: sequence,
      capturedAt: `2026-11-22T09:${String(sequence % 60).padStart(2, '0')}:00.000Z`,
      siNumber: sequence,
      cardSeries: 'SI-Card 9',
      stationCode: 8,
      checkTimeSec: null,
      startTimeSec: null,
      finishTimeSec: sequence * 60,
      punches: [],
      source: 'USB_WEBSERIAL',
    },
    readoutState: 'PROCESSED',
    deliveryState: 'SYNCED',
    competitorId: `competitor-${id}`,
    competitorName: `Runner ${id}`,
    className: 'D21',
    resultStatus: 'OK',
    competitorSnapshot: null,
    originalCompetitorId: `competitor-${id}`,
    originalCompetitorName: `Runner ${id}`,
    originalClassName: 'D21',
    originalResultStatus: 'OK',
    originalCompetitorSnapshot: null,
    issueType: null,
    issueState: 'NONE',
    correctionOperationId: null,
    correctionAudit: [],
    suggestedRunner: null,
    syncError: null,
    ...overrides,
  };
}

describe('readout timeline items', () => {
  it('renders each readout once in descending capture sequence', () => {
    const records = [
      makeRecord('one', 1),
      makeRecord('three', 3),
      makeRecord('two', 2),
      makeRecord('two', 2),
    ];

    const items = getReadoutTimelineItems(records, 'three', null, 'ALL');

    expect(items.map((item) => item.record.clientReadoutId)).toEqual([
      'three',
      'two',
      'one',
    ]);
    expect(new Set(items.map((item) => item.record.clientReadoutId)).size).toBe(3);
    expect(items.filter((item) => item.isLatest).map((item) => item.record.clientReadoutId))
      .toEqual(['three']);
  });

  it('keeps expansion attached to the record when a newer readout arrives', () => {
    const expandedId = 'two';
    const initial = getReadoutTimelineItems(
      [makeRecord('one', 1), makeRecord(expandedId, 2)],
      'two',
      expandedId,
      'ALL'
    );
    const afterCapture = getReadoutTimelineItems(
      [makeRecord('one', 1), makeRecord(expandedId, 2), makeRecord('three', 3)],
      'three',
      expandedId,
      'ALL'
    );

    expect(initial.find((item) => item.isExpanded)?.record.clientReadoutId).toBe(
      expandedId
    );
    expect(afterCapture.find((item) => item.isExpanded)?.record.clientReadoutId).toBe(
      expandedId
    );
    expect(afterCapture[0].isLatest).toBe(true);
  });

  it.each([
    ['ACTION_REQUIRED', { issueType: 'UNKNOWN_CARD', issueState: 'OPEN' }],
    ['OK', { resultStatus: 'OK' }],
    ['MP', { resultStatus: 'MP' }],
    ['UNKNOWN_CARD', { issueType: 'UNKNOWN_CARD', issueState: 'RESOLVED' }],
    ['DUPLICATE_READOUT', { issueType: 'DUPLICATE_READOUT', issueState: 'NONE' }],
  ] as const)('filters %s within the timeline item set', (filter, match) => {
    const records = [
      makeRecord('match', 2, match),
      makeRecord('other', 1, {
        resultStatus: 'DNS',
        issueType: null,
        issueState: 'NONE',
      }),
    ];

    expect(
      getReadoutTimelineItems(records, null, null, filter).map(
        (item) => item.record.clientReadoutId
      )
    ).toEqual(['match']);
  });
});
