import { describe, expect, it } from 'vitest';
import {
  findExactProcessedReadoutDuplicateId,
  type ReadoutDuplicatePayload,
  type ReadoutReceiptDuplicateCandidate,
} from './readoutDuplicate';

const payload: ReadoutDuplicatePayload = {
  competitorId: 'competitor-1',
  siNumber: 429898,
  cardSeries: 'SI-Card 5',
  startTimeSec: 23194,
  finishTimeSec: 68050,
  punchCodes: [157, 154, 138],
  punchTimes: [23257, 23301, 24066],
  rawHex: 'same-card-payload',
};

function createReceipt(
  overrides: Partial<ReadoutReceiptDuplicateCandidate> = {}
): ReadoutReceiptDuplicateCandidate {
  return {
    id: 'existing-readout',
    status: 'PROCESSED',
    ...payload,
    ...overrides,
  };
}

describe('findExactProcessedReadoutDuplicateId', () => {
  it('finds an exact processed receipt with a different readout ID', () => {
    expect(
      findExactProcessedReadoutDuplicateId(
        [createReceipt()],
        'new-readout',
        payload
      )
    ).toBe('existing-readout');
  });

  it.each([
    ['competitorId', { competitorId: 'competitor-2' }],
    ['SI number', { siNumber: 429899 }],
    ['card series', { cardSeries: 'SI-Card 6' }],
    ['start time', { startTimeSec: 23195 }],
    ['finish time', { finishTimeSec: 68051 }],
    ['punch codes', { punchCodes: [157, 154, 139] }],
    ['punch times', { punchTimes: [23257, 23301, 24067] }],
    ['raw payload', { rawHex: 'different-card-payload' }],
    ['receipt status', { status: 'UNKNOWN' }],
  ] as const)(
    'does not classify a partial match with different %s as a duplicate',
    (_field, receiptChanges) => {
      expect(
        findExactProcessedReadoutDuplicateId(
          [createReceipt(receiptChanges)],
          'new-readout',
          payload
        )
      ).toBeNull();
    }
  );

  it('does not classify the same receipt ID as a new duplicate', () => {
    expect(
      findExactProcessedReadoutDuplicateId(
        [createReceipt({ id: 'current-readout' })],
        'current-readout',
        payload
      )
    ).toBeNull();
  });
});
