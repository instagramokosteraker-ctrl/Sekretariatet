import { describe, expect, it } from 'vitest';
import type { FullCardReadoutPayload } from '../types/sportident';
import {
  addReadoutHistoryRecord,
  getLatestReadoutId,
  sortReadoutHistory,
  updateReadoutHistoryRecord,
  type ReadoutHistoryRecord,
} from './readoutHistoryStore';

function createRecord(
  clientReadoutId: string,
  captureSequence: number,
  readoutState: ReadoutHistoryRecord['readoutState'] = 'CAPTURED'
): ReadoutHistoryRecord {
  const readout: FullCardReadoutPayload & {
    clientReadoutId: string;
    captureSequence: number;
    capturedAt: string;
  } = {
    clientReadoutId,
    captureSequence,
    capturedAt: `2026-01-01T00:00:${captureSequence.toString().padStart(2, '0')}.000Z`,
    siNumber: 510000 + captureSequence,
    cardSeries: 'SI-Card 10',
    stationCode: 1,
    checkTimeSec: null,
    startTimeSec: null,
    finishTimeSec: 1000 + captureSequence,
    punches: [],
    source: 'USB_WEBSERIAL',
  };
  return {
    clientReadoutId,
    captureSequence,
    capturedAt: readout.capturedAt,
    eventId: 'event-1',
    readout,
    readoutState,
    deliveryState: 'QUEUED',
    competitorId: null,
    competitorName: null,
    className: null,
    resultStatus: null,
    competitorSnapshot: null,
    suggestedRunner: null,
    syncError: null,
  };
}

describe('readout history ordering', () => {
  it('keeps the newest captured readout latest when responses arrive out of order', () => {
    const readoutA = createRecord('readout-a', 100);
    const readoutB = createRecord('readout-b', 101);
    let records = addReadoutHistoryRecord([], readoutA);
    records = addReadoutHistoryRecord(records, readoutB);

    records = updateReadoutHistoryRecord(records, readoutB.clientReadoutId, {
      deliveryState: 'SYNCED',
      readoutState: 'PROCESSED',
      resultStatus: 'OK',
    });
    expect(getLatestReadoutId(records, 'event-1')).toBe('readout-b');

    records = updateReadoutHistoryRecord(records, readoutA.clientReadoutId, {
      deliveryState: 'SYNCED',
      readoutState: 'PROCESSED',
      resultStatus: 'MP',
    });
    expect(getLatestReadoutId(records, 'event-1')).toBe('readout-b');
    expect(sortReadoutHistory(records, 'event-1').map((record) => record.clientReadoutId))
      .toEqual(['readout-b', 'readout-a']);
  });

  it('updates a duplicate receipt in its existing row without adding another row', () => {
    const record = createRecord('readout-a', 1);
    const records = addReadoutHistoryRecord([record], createRecord('readout-a', 2));
    const updated = updateReadoutHistoryRecord(records, 'readout-a', {
      deliveryState: 'SYNCED',
    });

    expect(updated).toHaveLength(1);
    expect(updated[0].captureSequence).toBe(1);
    expect(updated[0].deliveryState).toBe('SYNCED');
  });

  it('retains multiple unknown-card records independently', () => {
    const records = addReadoutHistoryRecord(
      addReadoutHistoryRecord([], createRecord('unknown-a', 1, 'UNKNOWN')),
      createRecord('unknown-b', 2, 'UNKNOWN')
    );

    expect(records).toHaveLength(2);
    expect(getLatestReadoutId(records, 'event-1')).toBe('unknown-b');
    expect(updateReadoutHistoryRecord(records, 'unknown-a', { readoutState: 'PROCESSED' }))
      .toHaveLength(2);
  });

  it('does not recreate a history row when an asynchronous update has no capture ID match', () => {
    const records = [createRecord('readout-a', 1)];

    expect(updateReadoutHistoryRecord(records, 'missing-readout', { deliveryState: 'SYNCED' }))
      .toBe(records);
  });
});
