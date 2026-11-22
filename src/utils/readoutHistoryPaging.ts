export function getReadoutHistoryPage<T>(
  records: readonly T[],
  pageIndex: number,
  pageSize: 20 | 30 | 50
): T[] {
  const start = Math.max(0, pageIndex) * pageSize;
  return records.slice(start, start + pageSize);
}
