import {
  filterOutstandingReadouts,
  type ReadoutHistoryRecord,
} from '../services/readoutHistoryStore';

export type ReadoutTimelineFilter =
  | 'ALL'
  | 'ACTION_REQUIRED'
  | 'OK'
  | 'MP'
  | 'UNKNOWN_CARD'
  | 'DUPLICATE_READOUT';

export interface ReadoutTimelineItem {
  record: ReadoutHistoryRecord;
  isLatest: boolean;
  isExpanded: boolean;
}

export function getReadoutTimelineItems(
  records: ReadoutHistoryRecord[],
  latestReadoutId: string | null,
  expandedReadoutId: string | null,
  filter: ReadoutTimelineFilter
): ReadoutTimelineItem[] {
  const sortedRecords = [...new Map(
    records.map((record) => [record.clientReadoutId, record])
  ).values()].sort(
    (left, right) =>
      right.captureSequence - left.captureSequence ||
      right.capturedAt.localeCompare(left.capturedAt) ||
      left.clientReadoutId.localeCompare(right.clientReadoutId)
  );

  const filteredRecords = (() => {
    switch (filter) {
      case 'ACTION_REQUIRED':
        return filterOutstandingReadouts(sortedRecords);
      case 'OK':
        return sortedRecords.filter((record) => record.resultStatus === 'OK');
      case 'MP':
        return sortedRecords.filter((record) => record.resultStatus === 'MP');
      case 'UNKNOWN_CARD':
        return sortedRecords.filter((record) => record.issueType === 'UNKNOWN_CARD');
      case 'DUPLICATE_READOUT':
        return sortedRecords.filter(
          (record) => record.issueType === 'DUPLICATE_READOUT'
        );
      case 'ALL':
        return sortedRecords;
    }
  })();

  return filteredRecords.map((record) => ({
    record,
    isLatest: record.clientReadoutId === latestReadoutId,
    isExpanded: record.clientReadoutId === expandedReadoutId,
  }));
}
