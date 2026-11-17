import type { RunnerDbEntry } from '../types/sportident';

function normalizeName(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function getRunnerNameSuggestions(
  runners: RunnerDbEntry[],
  query: string
): RunnerDbEntry[] {
  const searchTerms = normalizeName(query).trim().split(/\s+/).filter(Boolean);
  if (searchTerms.join('').length < 2) return [];

  return runners
    .filter((runner) => {
      const name = normalizeName(runner.fullName);
      return searchTerms.every((term) => name.includes(term));
    })
    .slice(0, 8);
}
