import { describe, expect, it } from 'vitest';
import type { FullCardReadoutPayload } from '../types/sportident';
import {
  addReadoutHistoryRecord,
  filterOutstandingReadouts,
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
    originalCompetitorId: null,
    originalCompetitorName: null,
    originalClassName: null,
    originalResultStatus: null,
    originalCompetitorSnapshot: null,
    issueType: readoutState === 'UNKNOWN' ? 'UNKNOWN_CARD' : null,
    issueState: readoutState === 'UNKNOWN' ? 'OPEN' : 'NONE',
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

  it('orders the latest readout by capture sequence rather than timestamp or array order', () => {
    const olderCapture = {
      ...createRecord('readout-older', 20),
      capturedAt: '2026-01-02T00:00:00.000Z',
    };
    const newerCapture = {
      ...createRecord('readout-newer', 21),
      capturedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(getLatestReadoutId([newerCapture, olderCapture], 'event-1')).toBe(
      'readout-newer'
    );
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
    expect(filterOutstandingReadouts(records).map((record) => record.clientReadoutId))
      .toEqual(['unknown-a', 'unknown-b']);
    expect(updateReadoutHistoryRecord(records, 'unknown-a', { readoutState: 'PROCESSED' }))
      .toHaveLength(2);
  });

  it('keeps the original match and result while current match details update', () => {
    let records = [createRecord('readout-a', 1)];
    records = updateReadoutHistoryRecord(records, 'readout-a', {
      competitorId: 'original-competitor',
      competitorName: 'Original Runner',
      resultStatus: 'OK',
      originalCompetitorId: 'original-competitor',
      originalCompetitorName: 'Original Runner',
      originalResultStatus: 'OK',
    });
    records = updateReadoutHistoryRecord(records, 'readout-a', {
      competitorId: 'current-competitor',
      competitorName: 'Current Runner',
      resultStatus: 'MP',
      originalCompetitorId: 'other-competitor',
      originalCompetitorName: 'Other Runner',
      originalResultStatus: 'MP',
    });

    expect(records[0]).toMatchObject({
      competitorId: 'current-competitor',
      competitorName: 'Current Runner',
      resultStatus: 'MP',
      originalCompetitorId: 'original-competitor',
      originalCompetitorName: 'Original Runner',
      originalResultStatus: 'OK',
    });
  });

  it('filters open issues without treating an MP result as an issue by itself', () => {
    const ordinaryMp = {
      ...createRecord('mp-readout', 1),
      resultStatus: 'MP' as const,
    };
    const mpReview = {
      ...ordinaryMp,
      clientReadoutId: 'mp-review-readout',
      readout: {
        ...ordinaryMp.readout,
        clientReadoutId: 'mp-review-readout',
      },
      issueType: 'MP_REVIEW' as const,
      issueState: 'OPEN' as const,
    };
    const inProgressIssue = {
      ...createRecord('in-progress-readout', 2),
      issueType: 'WRONG_COMPETITOR' as const,
      issueState: 'IN_PROGRESS' as const,
    };

    expect(
      filterOutstandingReadouts([ordinaryMp, mpReview, inProgressIssue]).map(
        (record) => record.clientReadoutId
      )
    ).toEqual(['mp-review-readout', 'in-progress-readout']);
  });

  it('does not recreate a history row when an asynchronous update has no capture ID match', () => {
    const records = [createRecord('readout-a', 1)];

    expect(updateReadoutHistoryRecord(records, 'missing-readout', { deliveryState: 'SYNCED' }))
      .toBe(records);
  });
});
