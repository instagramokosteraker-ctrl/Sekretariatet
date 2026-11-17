import { describe, expect, it } from 'vitest';
import type { CompetitionSummary } from '../types/sportident';
import { mergePublicCompetitionSummaries } from './publicCompetitionSummaries';

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
  it('keeps current API finish counts when Firestore metadata has stale zero counts', () => {
    const apiSummary = createSummary('event-1', 42, 17, { classCount: 5 });
    const firestoreSummary = createSummary('event-1', 0, 0, {
      name: 'Updated event title',
      classCount: 0,
    });

    expect(
      mergePublicCompetitionSummaries([apiSummary], [firestoreSummary])[0]
    ).toMatchObject({
      name: 'Updated event title',
      competitorCount: 42,
      finishedCount: 17,
      classCount: 5,
    });
  });

  it('retains Firestore-only competitions when the API does not include them', () => {
    const apiSummary = createSummary('event-1', 3, 1);
    const firestoreOnly = createSummary('event-2', 8, 4);

    expect(
      mergePublicCompetitionSummaries([apiSummary], [firestoreOnly]).map(
        (competition) => competition.id
      )
    ).toEqual(['event-1', 'event-2']);
  });
});
