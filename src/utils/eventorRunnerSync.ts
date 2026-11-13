import type { RunnerDbEntry } from '../types/sportident';

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizePersonId(value: string | null | undefined): string {
  return (value || '').trim();
}

function isEventorSource(source: RunnerDbEntry['source']): boolean {
  return source === 'EVENTOR_API' || source === 'EVENTOR_XML';
}

export function reconcileEventorRunnerDbEntries(
  incoming: RunnerDbEntry[],
  existing: RunnerDbEntry[]
): RunnerDbEntry[] {
  const existingBySi = new Map(existing.map((runner) => [runner.siNumber, runner]));
  const claimedExistingIds = new Set<string>();
  const seenIncomingKeys = new Set<string>();
  const resolved: RunnerDbEntry[] = [];

  for (const runner of incoming) {
    if (!isEventorSource(runner.source)) {
      resolved.push(runner);
      continue;
    }

    const personId = normalizePersonId(runner.eventorPersonId);
    const name = normalizeText(runner.fullName);
    const club = normalizeText(runner.club);
    const incomingKey = personId
      ? `person:${personId}`
      : `name-club:${name}\u0000${club}`;
    if (seenIncomingKeys.has(incomingKey)) continue;
    seenIncomingKeys.add(incomingKey);

    const personMatches = personId
      ? existing.filter(
          (candidate) =>
            normalizePersonId(candidate.eventorPersonId) === personId
        )
      : [];
    let match =
      personMatches.find((candidate) => candidate.siNumber === runner.siNumber) ??
      personMatches[0];

    if (!match) {
      const nameClubMatches = existing.filter(
        (candidate) =>
          !normalizePersonId(candidate.eventorPersonId) &&
          normalizeText(candidate.fullName) === name &&
          normalizeText(candidate.club) === club
      );
      if (nameClubMatches.length > 1) {
        throw new Error(
          `Flera lokala löpare matchar Eventor-medlemmen "${runner.fullName}" (${runner.club}); synkningen stoppades för att undvika felkoppling.`
        );
      }
      match = nameClubMatches[0];
    }

    if (match) {
      if (claimedExistingIds.has(match.id)) continue;
      claimedExistingIds.add(match.id);
      resolved.push({
        ...runner,
        id: match.id,
        siNumber: match.siNumber,
        cardSeries: match.cardSeries,
        birthYear: runner.birthYear ?? match.birthYear,
        defaultClassName: runner.defaultClassName ?? match.defaultClassName,
        eventorPersonId: personId || match.eventorPersonId,
        eventorOrgId: runner.eventorOrgId || match.eventorOrgId,
      });
      continue;
    }

    if (existingBySi.has(runner.siNumber)) {
      throw new Error(
        `Eventor-medlemmen "${runner.fullName}" använder SI-bricka ${runner.siNumber}, som redan tillhör en annan lokal löpare. Ingen profil skrevs över.`
      );
    }
    resolved.push(runner);
  }

  const seenProfileIds = new Set<string>();
  const seenSiNumbers = new Set<number>();
  return resolved.filter((runner) => {
    if (seenProfileIds.has(runner.id)) return false;
    if (seenSiNumbers.has(runner.siNumber)) {
      throw new Error(
        `Flera Eventor-profiler tilldelas samma SI-bricka ${runner.siNumber}; synkningen stoppades.`
      );
    }
    seenProfileIds.add(runner.id);
    seenSiNumbers.add(runner.siNumber);
    return true;
  });
}
