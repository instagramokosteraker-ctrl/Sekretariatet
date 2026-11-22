import { describe, expect, it } from 'vitest';
import { getReadoutHistoryNavigationIndex } from './readoutHistoryKeyboard';

describe('readout history keyboard navigation', () => {
  it('moves through visible rows without wrapping', () => {
    expect(getReadoutHistoryNavigationIndex('ArrowDown', 0, 3)).toBe(1);
    expect(getReadoutHistoryNavigationIndex('ArrowUp', 2, 3)).toBe(1);
    expect(getReadoutHistoryNavigationIndex('ArrowUp', 0, 3)).toBeNull();
    expect(getReadoutHistoryNavigationIndex('ArrowDown', 2, 3)).toBeNull();
  });

  it('starts at the nearest edge when focus is outside the history rows', () => {
    expect(getReadoutHistoryNavigationIndex('ArrowDown', -1, 3)).toBe(0);
    expect(getReadoutHistoryNavigationIndex('ArrowUp', -1, 3)).toBe(2);
  });

  it('ignores unrelated keys and empty histories', () => {
    expect(getReadoutHistoryNavigationIndex('Enter', 0, 3)).toBeNull();
    expect(getReadoutHistoryNavigationIndex('ArrowDown', -1, 0)).toBeNull();
  });
});
