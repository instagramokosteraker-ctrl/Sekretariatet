export interface CompetitorIdentitySnapshotRow {
  competitionId: string;
  competitorId: string;
  siNumber: number;
  cardSeries?: string;
  status?: string;
}

function identityKey(row: CompetitorIdentitySnapshotRow): string {
  return JSON.stringify([
    row.competitionId,
    row.competitorId,
    String(row.siNumber),
    row.cardSeries ?? '',
    row.status ?? '',
  ]);
}

export function hasSameCompetitorIdentitySnapshot(
  current: readonly CompetitorIdentitySnapshotRow[],
  restored: readonly CompetitorIdentitySnapshotRow[]
): boolean {
  if (current.length !== restored.length) return false;

  const currentKeys = current.map(identityKey).sort();
  const restoredKeys = restored.map(identityKey).sort();
  return currentKeys.every((key, index) => key === restoredKeys[index]);
}
