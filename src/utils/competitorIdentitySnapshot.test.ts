import { describe, expect, it } from 'vitest';
import { hasSameCompetitorIdentitySnapshot } from './competitorIdentitySnapshot';

const current = [
  {
    competitionId: 'event-1',
    competitorId: 'cmp-1',
    siNumber: 12345,
    cardSeries: 'SI-Card 10',
    status: 'REGISTERED',
  },
  {
    competitionId: 'event-1',
    competitorId: 'cmp-2',
    siNumber: 67890,
    cardSeries: 'SI-Card 10',
    status: 'OK',
  },
];

describe('hasSameCompetitorIdentitySnapshot', () => {
  it('accepts the same identities regardless of order', () => {
    expect(hasSameCompetitorIdentitySnapshot(current, [...current].reverse())).toBe(true);
  });

  it('rejects competitor additions or removals', () => {
    expect(
      hasSameCompetitorIdentitySnapshot(current, [
        ...current,
        { competitionId: 'event-1', competitorId: 'cmp-3', siNumber: 54321 },
      ])
    ).toBe(false);
    expect(hasSameCompetitorIdentitySnapshot(current, current.slice(0, 1))).toBe(false);
  });

  it('rejects SI reassignment, card-series, lifecycle-status, and competition changes', () => {
    expect(
      hasSameCompetitorIdentitySnapshot(current, [
        { ...current[0], siNumber: 11111 },
        current[1],
      ])
    ).toBe(false);
    expect(
      hasSameCompetitorIdentitySnapshot(current, [
        { ...current[0], cardSeries: 'SI-Card 11' },
        current[1],
      ])
    ).toBe(false);
    expect(
      hasSameCompetitorIdentitySnapshot(current, [
        { ...current[0], status: 'DNS' },
        current[1],
      ])
    ).toBe(false);
    expect(
      hasSameCompetitorIdentitySnapshot(current, [
        { ...current[0], competitionId: 'event-2' },
        current[1],
      ])
    ).toBe(false);
  });
});
