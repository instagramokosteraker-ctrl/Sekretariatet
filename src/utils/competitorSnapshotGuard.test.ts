import { describe, expect, it } from 'vitest';
import { getChangedSnapshotFields } from './competitorSnapshotGuard';

describe('getChangedSnapshotFields', () => {
  it('returns only fields whose snapshot values differ', () => {
    expect(
      getChangedSnapshotFields(
        { bib: 12, fullName: 'Ada', punchCodes: [31, 32] },
        { bib: 12, fullName: 'Older name', punchCodes: [31] }
      )
    ).toEqual(['fullName', 'punchCodes']);
  });

  it('treats equivalent arrays as unchanged', () => {
    expect(
      getChangedSnapshotFields(
        { punchCodes: [31, 32], punchTimes: [36000, 36100] },
        { punchCodes: [31, 32], punchTimes: [36000, 36100] }
      )
    ).toEqual([]);
  });
});
