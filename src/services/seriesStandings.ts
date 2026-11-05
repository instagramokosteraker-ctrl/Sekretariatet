import type {
  SeriesScoringConfig,
  SeriesStandingClassGroup,
  SeriesStandingRow,
  SeriesStandingsBundle,
} from '../types/sportident';

export const DEFAULT_SERIES_SCORING_CONFIG: SeriesScoringConfig = {
  model: 'PLACEMENT',
  placementPoints: [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  participationPoints: 1,
};

interface SeriesEvent {
  competition: {
    id: string;
    shortCode: string;
    name: string;
    date: string;
    status: 'LIVE' | 'UPCOMING' | 'COMPLETED';
    seriesName?: string;
  };
  classes: Array<{
    id: string;
    name: string;
    classFormat?: 'STANDARD' | 'FORKED' | 'ROGAINING';
  }>;
  competitors: Array<{
    id: string;
    classId: string;
    fullName: string;
    club: string;
    status: string;
    runningTimeSec: number | null;
    validation?: { rogainingPoints?: number | null } | null;
  }>;
}

function getSeriesConfig(
  configs: Record<string, SeriesScoringConfig> | undefined,
  seriesName: string
): SeriesScoringConfig {
  const config = configs?.[seriesName];
  if (!config || (config.model !== 'PLACEMENT' && config.model !== 'PARTICIPATION')) {
    return DEFAULT_SERIES_SCORING_CONFIG;
  }
  const placementPoints = Array.isArray(config.placementPoints)
    ? config.placementPoints
        .filter((points) => Number.isInteger(points) && points >= 0 && points <= 10000)
        .slice(0, 100)
    : [];
  const participationPoints =
    Number.isInteger(config.participationPoints) &&
    config.participationPoints >= 0 &&
    config.participationPoints <= 10000
      ? config.participationPoints
      : DEFAULT_SERIES_SCORING_CONFIG.participationPoints;
  return {
    model: config.model,
    placementPoints,
    participationPoints,
  };
}

export function normalizeSeriesScoringSettings(
  value: unknown
): Record<string, SeriesScoringConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized: Record<string, SeriesScoringConfig> = {};
  for (const [seriesName, rawConfig] of Object.entries(value)) {
    if (!seriesName.trim() || seriesName.length > 80 || !rawConfig || typeof rawConfig !== 'object') {
      continue;
    }
    const config = rawConfig as Partial<SeriesScoringConfig>;
    if (config.model !== 'PLACEMENT' && config.model !== 'PARTICIPATION') continue;
    const placementPoints = Array.isArray(config.placementPoints)
      ? config.placementPoints
          .filter(
            (points): points is number =>
              Number.isInteger(points) && points >= 0 && points <= 10000
          )
          .slice(0, 100)
      : [];
    const participationPoints =
      Number.isInteger(config.participationPoints) &&
      Number(config.participationPoints) >= 0 &&
      Number(config.participationPoints) <= 10000
        ? Number(config.participationPoints)
        : DEFAULT_SERIES_SCORING_CONFIG.participationPoints;
    normalized[seriesName.trim()] = {
      model: config.model,
      placementPoints,
      participationPoints,
    };
  }
  return normalized;
}

export function calculateSeriesStandings(
  events: readonly SeriesEvent[],
  scoringSettings?: Record<string, SeriesScoringConfig>
): SeriesStandingsBundle[] {
  const bySeries = new Map<string, SeriesEvent[]>();
  for (const event of events) {
    const seriesName = (event.competition.seriesName || '').trim();
    if (!seriesName) continue;
    const seriesEvents = bySeries.get(seriesName) ?? [];
    seriesEvents.push(event);
    bySeries.set(seriesName, seriesEvents);
  }

  const bundles: SeriesStandingsBundle[] = [];
  for (const [seriesName, rawEvents] of bySeries) {
    const config = getSeriesConfig(scoringSettings, seriesName);
    const sortedStages = [...rawEvents].sort((a, b) =>
      a.competition.date.localeCompare(b.competition.date)
    );
    const stages = sortedStages.map((event) => ({
      eventId: event.competition.id,
      shortCode: event.competition.shortCode,
      name: event.competition.name,
      date: event.competition.date,
      status: event.competition.status,
    }));
    const classMap = new Map<string, Map<string, SeriesStandingRow>>();

    for (const event of sortedStages) {
      for (const compClass of event.classes) {
        const className = compClass.name.trim();
        if (!className) continue;
        const classCompetitors = event.competitors.filter(
          (competitor) => competitor.classId === compClass.id
        );
        const startedCompetitors = classCompetitors.filter((competitor) =>
          ['IN_FOREST', 'PRELIMINARY_FIN', 'OK', 'MP', 'DNF'].includes(competitor.status)
        );
        if (startedCompetitors.length === 0) continue;

        const okCompetitors = startedCompetitors
          .filter(
            (competitor) => competitor.status === 'OK' && competitor.runningTimeSec !== null
          )
          .sort((a, b) => {
            if (compClass.classFormat === 'ROGAINING') {
              const pointsDiff =
                (b.validation?.rogainingPoints ?? 0) - (a.validation?.rogainingPoints ?? 0);
              if (pointsDiff !== 0) return pointsDiff;
            }
            return (a.runningTimeSec ?? 999999) - (b.runningTimeSec ?? 999999);
          });

        let runnerTable = classMap.get(className);
        if (!runnerTable) {
          runnerTable = new Map<string, SeriesStandingRow>();
          classMap.set(className, runnerTable);
        }

        let rankIndex = 0;
        const pointsByRunnerId = new Map<string, { points: number; isWinner: boolean }>();
        okCompetitors.forEach((runner, index) => {
          if (index > 0) {
            const previous = okCompetitors[index - 1];
            const tied =
              compClass.classFormat === 'ROGAINING'
                ? (runner.validation?.rogainingPoints ?? 0) ===
                    (previous.validation?.rogainingPoints ?? 0) &&
                  runner.runningTimeSec === previous.runningTimeSec
                : runner.runningTimeSec === previous.runningTimeSec;
            if (!tied) rankIndex = index;
          }
          const points =
            config.model === 'PARTICIPATION'
              ? config.participationPoints
              : (config.placementPoints[rankIndex] ?? config.participationPoints);
          pointsByRunnerId.set(runner.id, {
            points,
            isWinner: rankIndex === 0,
          });
        });

        for (const runner of startedCompetitors) {
          const result = pointsByRunnerId.get(runner.id);
          const points =
            config.model === 'PARTICIPATION'
              ? config.participationPoints
              : (result?.points ?? config.participationPoints);
          const runnerKey = `${runner.fullName.trim().toLowerCase()}|${runner.club
            .trim()
            .toLowerCase()}`;
          const existing = runnerTable.get(runnerKey);
          if (existing) {
            existing.totalPoints += points;
            existing.participations += 1;
            if (result?.isWinner) existing.wins += 1;
            existing.stagePoints[event.competition.id] = points;
          } else {
            runnerTable.set(runnerKey, {
              runnerKey,
              fullName: runner.fullName,
              club: runner.club,
              totalPoints: points,
              participations: 1,
              wins: result?.isWinner ? 1 : 0,
              stagePoints: { [event.competition.id]: points },
            });
          }
        }
      }
    }

    const classes: SeriesStandingClassGroup[] = Array.from(classMap.entries())
      .map(([className, rows]) => ({
        className,
        rows: Array.from(rows.values()).sort((a, b) => {
          if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (b.participations !== a.participations) return b.participations - a.participations;
          return a.fullName.localeCompare(b.fullName, 'sv');
        }),
      }))
      .sort((a, b) => a.className.localeCompare(b.className, 'sv'));

    bundles.push({ seriesName, stages, classes });
  }

  return bundles.sort((a, b) => a.seriesName.localeCompare(b.seriesName, 'sv'));
}
