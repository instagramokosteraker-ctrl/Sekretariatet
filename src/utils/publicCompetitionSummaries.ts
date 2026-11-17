import type { CompetitionSummary } from '../types/sportident';

export function mergePublicCompetitionSummaries(
  apiCompetitions: CompetitionSummary[],
  firestoreCompetitions: CompetitionSummary[]
): CompetitionSummary[] {
  const firestoreById = new Map(
    firestoreCompetitions.map((competition) => [competition.id, competition])
  );
  const apiIds = new Set(apiCompetitions.map((competition) => competition.id));
  const merged = apiCompetitions.map((competition) => {
    const firestoreCompetition = firestoreById.get(competition.id);
    if (!firestoreCompetition) return competition;
    return {
      ...competition,
      ...firestoreCompetition,
      competitorCount: competition.competitorCount,
      finishedCount: competition.finishedCount,
      classCount: firestoreCompetition.classCount || competition.classCount,
    };
  });

  for (const competition of firestoreCompetitions) {
    if (!apiIds.has(competition.id)) merged.push(competition);
  }
  return merged;
}
