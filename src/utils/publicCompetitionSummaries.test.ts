import { describe, expect, it } from 'vitest';
import type { CompetitionSummary } from '../types/sportident';
import {
  applyPublicCompetitionCounts,
  mergePublicCompetitionSummaries,
} from './publicCompetitionSummaries';

function createSummary(
  id: string,
  competitorCount: number,
  finishedCount: number,
  overrides: Partial<CompetitionSummary> = {}
): CompetitionSummary {
  return {
    id,
    competitionId: id,
    shortCode: id,
    status: 'LIVE',
    name: id,
    organizer: 'Club',
    date: '2026-11-17',
    zeroTimeStr: '10:00:00',
    arenaInfo: '',
    competitorCount,
    finishedCount,
    classCount: 0,
    ...overrides,
  };
}

describe('mergePublicCompetitionSummaries', () => {
  it('derives 46 registered and 4 finished from public result projections', () => {
    const summary = createSummary('event-1', 4, 4);
    const publicResults = [
      ...Array.from({ length: 42 }, () => ({ status: 'REGISTERED' })),
      ...Array.from({ length: 3 }, () => ({ status: 'OK' })),
      { status: 'PRELIMINARY_FIN' },
    ];

    expect(applyPublicCompetitionCounts(summary, publicResults)).toMatchObject({
      competitorCount: 46,
      finishedCount: 4,
    });
  });

  it('uses Firestore counts for matching competitions and preserves unrelated merge behavior', () => {
    const apiSummary = createSummary('event-1', 0, 0, { classCount: 5 });
    const firestoreSummary = createSummary('event-1', 24, 6, {
      name: 'Updated event title',
      classCount: 0,
    });

    expect(
      mergePublicCompetitionSummaries([apiSummary], [firestoreSummary])[0]
    ).toMatchObject({
      name: 'Updated event title',
      competitorCount: 24,
      finishedCount: 6,
      classCount: 5,
    });
  });

  it('retains API counts for API-only competitions', () => {
    const apiSummary = createSummary('event-1', 12, 4);

    expect(mergePublicCompetitionSummaries([apiSummary], [])[0]).toMatchObject({
      competitorCount: 12,
      finishedCount: 4,
    });
  });

  it('retains Firestore-only competitions when the API does not include them', () => {
    const firestoreOnly = createSummary('event-2', 8, 4);

    expect(
      mergePublicCompetitionSummaries([], [firestoreOnly])
    ).toMatchObject([
      {
        id: 'event-2',
        competitorCount: 8,
        finishedCount: 4,
      },
    ]);
  });
});
