import { describe, expect, it } from 'vitest';
import type { Competitor, FullCardReadoutPayload } from '../types/sportident';
import {
  getReadoutStatusPresentation,
  getReadoutStatusText,
} from '../utils/readoutStatusPresentation';
import {
  addReadoutHistoryRecord,
  createDuplicateReadoutHistoryUpdate,
  filterOutstandingReadouts,
  getWrongCompetitorIssueUpdateForFailure,
  isEligibleWrongCompetitorReadout,
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
    receiptStatus:
      readoutState === 'PROCESSED'
        ? 'PROCESSED'
        : readoutState === 'UNKNOWN'
          ? 'UNKNOWN'
          : null,
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
    correctionOperationId: null,
    correctionAudit: [],
    suggestedRunner: null,
    syncError: null,
  };
}

function createCompetitor(status: Competitor['status']): Competitor {
  return {
    id: 'competitor-1',
    bib: 12,
    fullName: 'Ada Runner',
    club: 'Example Club',
    classId: 'class-1',
    siNumber: 429898,
    cardSeries: 'SI-Card 10',
    isRentalCard: false,
    rentalReturned: false,
    status,
    allocatedStartSec: null,
    checkTimeSec: null,
    startTimeSec: 23194,
    finishTimeSec: 68050,
    manualFinishTimeSec: null,
    runningTimeSec: 44856,
    lastSeenControl: null,
    lastSeenTimeSec: null,
    readoutAt: null,
    radioSplits: [],
    cardPunches: [],
    rawReadout: null,
    validation: null,
  };
}

describe('readout history ordering', () => {
  it.each(['OK', 'MP', 'PRELIMINARY_FIN'] as const)(
    'allows a matched %s readout without a completed reassignment',
    (resultStatus) => {
      const record = {
        ...createRecord(`readout-${resultStatus}`, 1, 'PROCESSED'),
        competitorId: 'anna',
        originalCompetitorId: 'anna',
        resultStatus,
        issueType: 'MP_REVIEW' as const,
        issueState: 'OPEN' as const,
      };

      expect(isEligibleWrongCompetitorReadout(record)).toBe(true);
      expect(
        isEligibleWrongCompetitorReadout({
          ...record,
          correctionOperationId: 'readout-correction-done',
        })
      ).toBe(true);
      expect(
        isEligibleWrongCompetitorReadout({
          ...record,
          competitorId: 'mikael',
          correctionOperationId: 'readout-correction-done',
          correctionAudit: [
            {
              operationId: 'readout-correction-done',
              readoutId: record.clientReadoutId,
              actorUid: 'official',
              actorRole: 'READOUT',
              timestamp: '2026-01-01T00:00:00.000Z',
              reason: 'Correct initial match',
              originalCompetitor: { id: 'anna', name: 'Anna' },
              previousCompetitor: { id: 'anna', name: 'Anna' },
              correctedCompetitor: { id: 'mikael', name: 'Mikael' },
              result: {
                status: 'APPLIED',
                previousStatus: 'OK',
                newStatus: 'OK',
                finishTimeSec: 1000,
                runningTimeSec: 900,
                bomSec: null,
                placing: null,
              },
            },
          ],
        })
      ).toBe(true);
    }
  );

  it('does not expose reassignment for unmatched or unprocessed readouts', () => {
    const record = {
      ...createRecord('readout-unmatched', 1),
      resultStatus: 'OK' as const,
    };

    expect(isEligibleWrongCompetitorReadout(record)).toBe(false);
    expect(
      isEligibleWrongCompetitorReadout({
        ...record,
        readoutState: 'PROCESSED',
        receiptStatus: 'PROCESSED',
        competitorId: 'anna',
        resultStatus: 'DNF',
      })
    ).toBe(false);
    expect(
      isEligibleWrongCompetitorReadout({
        ...record,
        readoutState: 'PROCESSED',
        receiptStatus: 'UNKNOWN',
        competitorId: 'anna',
        originalCompetitorId: 'anna',
        resultStatus: 'OK',
      })
    ).toBe(false);
    expect(
      isEligibleWrongCompetitorReadout({
        ...record,
        readoutState: 'PROCESSED',
        receiptStatus: 'PROCESSED',
        competitorId: 'anna',
        originalCompetitorId: null,
        resultStatus: 'OK',
      })
    ).toBe(false);
  });

  it('enables reassignment only after an unknown-card receipt is promoted', () => {
    const unknown = {
      ...createRecord('readout-promoted', 1, 'UNKNOWN'),
      competitorId: null,
      originalCompetitorId: null,
      resultStatus: null,
    };
    const promoted = updateReadoutHistoryRecord(
      [unknown],
      unknown.clientReadoutId,
      {
        readoutState: 'PROCESSED',
        receiptStatus: 'PROCESSED',
        competitorId: 'runner-new',
        originalCompetitorId: 'runner-new',
        resultStatus: 'OK',
        issueType: 'UNKNOWN_CARD',
        issueState: 'RESOLVED',
      }
    )[0];

    expect(isEligibleWrongCompetitorReadout(unknown)).toBe(false);
    expect(isEligibleWrongCompetitorReadout(promoted)).toBe(true);
  });

  it('keeps the original match while updating the current competitor repeatedly', () => {
    const record = {
      ...createRecord('readout-corrected', 1, 'PROCESSED'),
      competitorId: 'anna',
      competitorName: 'Anna',
      originalCompetitorId: 'anna',
      originalCompetitorName: 'Anna',
      resultStatus: 'OK' as const,
      issueType: 'WRONG_COMPETITOR' as const,
      issueState: 'OPEN' as const,
    };

    const corrected = updateReadoutHistoryRecord([record], record.clientReadoutId, {
      competitorId: 'erik',
      competitorName: 'Erik',
      issueState: 'RESOLVED',
      correctionOperationId: 'readout-correction-op-1',
    })[0];
    const correctedAgain = updateReadoutHistoryRecord(
      [corrected],
      record.clientReadoutId,
      {
        competitorId: 'anna',
        competitorName: 'Anna',
        correctionOperationId: 'readout-correction-op-2',
      }
    )[0];

    expect(correctedAgain).toMatchObject({
      competitorId: 'anna',
      competitorName: 'Anna',
      originalCompetitorId: 'anna',
      originalCompetitorName: 'Anna',
      issueType: 'WRONG_COMPETITOR',
      correctionOperationId: 'readout-correction-op-2',
    });
  });

  it('clears only a pending wrong-competitor issue after a failed request', () => {
    const record = {
      ...createRecord('readout-failed-correction', 1, 'PROCESSED'),
      issueType: 'WRONG_COMPETITOR' as const,
      issueState: 'OPEN' as const,
    };

    const rollback = getWrongCompetitorIssueUpdateForFailure(record);
    expect(rollback).toEqual({
      issueType: null,
      issueState: 'NONE',
    });
    expect(
      updateReadoutHistoryRecord([record], record.clientReadoutId, rollback ?? {})[0]
    ).toMatchObject({ issueType: null, issueState: 'NONE' });
    expect(
      getWrongCompetitorIssueUpdateForFailure({
        ...record,
        issueType: 'MP_REVIEW',
      })
    ).toBeNull();
    expect(
      getWrongCompetitorIssueUpdateForFailure({
        ...record,
        issueState: 'RESOLVED',
      })
    ).toBeNull();
  });

  it('keeps a reassignment draft out of Outstanding Issues until correction succeeds', () => {
    const record = {
      ...createRecord('readout-reassignment-draft', 1, 'PROCESSED'),
      competitorId: 'anna',
      originalCompetitorId: 'anna',
      resultStatus: 'OK' as const,
    };

    expect(filterOutstandingReadouts([record])).toEqual([]);

    const committed = updateReadoutHistoryRecord(
      [record],
      record.clientReadoutId,
      {
        issueType: 'WRONG_COMPETITOR',
        issueState: 'RESOLVED',
        correctionOperationId: 'readout-correction-1',
      }
    )[0];
    expect(filterOutstandingReadouts([committed])).toEqual([]);
    expect(committed).toMatchObject({
      issueType: 'WRONG_COMPETITOR',
      issueState: 'RESOLVED',
    });
  });

  it('keeps an existing open reassignment issue visible until its request fails', () => {
    const record = {
      ...createRecord('readout-existing-reassignment', 1, 'PROCESSED'),
      competitorId: 'anna',
      originalCompetitorId: 'anna',
      resultStatus: 'OK' as const,
      issueType: 'WRONG_COMPETITOR' as const,
      issueState: 'OPEN' as const,
    };

    expect(filterOutstandingReadouts([record])).toEqual([record]);
    expect(getWrongCompetitorIssueUpdateForFailure(record)).toEqual({
      issueType: null,
      issueState: 'NONE',
    });
  });

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
    const alreadyRead = {
      ...createRecord('duplicate-readout', 3),
      issueType: 'DUPLICATE_READOUT' as const,
      issueState: 'NONE' as const,
    };

    expect(
      filterOutstandingReadouts([
        ordinaryMp,
        mpReview,
        inProgressIssue,
        alreadyRead,
      ]).map((record) => record.clientReadoutId)
    ).toEqual(['mp-review-readout', 'in-progress-readout']);
  });

  it('marks an exact duplicate as an informational blue history row', () => {
    const record = createRecord('duplicate-readout', 3);
    const competitor = createCompetitor('MP');
    const update = createDuplicateReadoutHistoryUpdate(
      record,
      competitor,
      'Open class'
    );
    const [duplicate] = updateReadoutHistoryRecord(
      [record],
      record.clientReadoutId,
      update
    );

    expect(duplicate).toMatchObject({
      clientReadoutId: 'duplicate-readout',
      captureSequence: 3,
      capturedAt: record.capturedAt,
      deliveryState: 'SYNCED',
      readoutState: 'PROCESSED',
      issueType: 'DUPLICATE_READOUT',
      issueState: 'NONE',
      competitorId: competitor.id,
      resultStatus: 'MP',
    });
    expect(getReadoutStatusText(duplicate)).toBe('MP');
    expect(getReadoutStatusPresentation(duplicate).tone).toBe('mp');
    expect(filterOutstandingReadouts([duplicate])).toEqual([]);
  });

  it('does not recreate a history row when an asynchronous update has no capture ID match', () => {
    const records = [createRecord('readout-a', 1)];

    expect(updateReadoutHistoryRecord(records, 'missing-readout', { deliveryState: 'SYNCED' }))
      .toBe(records);
  });
});
