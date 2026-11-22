export interface ReadoutDuplicatePayload {
  competitorId: string;
  siNumber: number;
  cardSeries: string;
  startTimeSec: number | null;
  finishTimeSec: number | null;
  punchCodes: readonly number[];
  punchTimes: readonly number[];
  rawHex: string;
}

export interface ReadoutReceiptDuplicateCandidate {
  id: string;
  status: unknown;
  competitorId: unknown;
  currentCompetitorId?: unknown;
  siNumber: unknown;
  cardSeries: unknown;
  startTimeSec: unknown;
  finishTimeSec: unknown;
  punchCodes: unknown;
  punchTimes: unknown;
  rawHex: unknown;
}

function matchesNumberArray(value: unknown, expected: readonly number[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  );
}

export function findExactProcessedReadoutDuplicateId(
  receipts: readonly ReadoutReceiptDuplicateCandidate[],
  currentReadoutId: string,
  payload: ReadoutDuplicatePayload
): string | null {
  const duplicate = receipts.find(
    (receipt) =>
      receipt.id !== currentReadoutId &&
      receipt.status === 'PROCESSED' &&
      receipt.competitorId === payload.competitorId &&
      receipt.siNumber === payload.siNumber &&
      receipt.cardSeries === payload.cardSeries &&
      receipt.startTimeSec === payload.startTimeSec &&
      receipt.finishTimeSec === payload.finishTimeSec &&
      matchesNumberArray(receipt.punchCodes, payload.punchCodes) &&
      matchesNumberArray(receipt.punchTimes, payload.punchTimes) &&
      receipt.rawHex === payload.rawHex
  );

  return duplicate?.id ?? null;
}
