import { describe, expect, it } from 'vitest';
import { getReadoutHistoryPage } from './readoutHistoryPaging';

describe('readout history paging', () => {
  it('keeps large history rendering bounded to the selected page', () => {
    const records = Array.from({ length: 10_000 }, (_, index) => index);
    const page = getReadoutHistoryPage(records, 100, 50);

    expect(page).toHaveLength(50);
    expect(page[0]).toBe(5_000);
    expect(page[49]).toBe(5_049);
  });

  it('treats a negative page as the first page', () => {
    expect(getReadoutHistoryPage([1, 2, 3], -1, 20)).toEqual([1, 2, 3]);
  });
});
