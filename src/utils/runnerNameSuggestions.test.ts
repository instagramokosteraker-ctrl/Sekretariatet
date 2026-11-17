import { describe, expect, it } from 'vitest';
import type { RunnerDbEntry } from '../types/sportident';
import { getRunnerNameSuggestions } from './runnerNameSuggestions';

function createRunner(id: string, fullName: string): RunnerDbEntry {
  return {
    id,
    siNumber: 510000 + Number(id.replace(/\D/g, '')),
    cardSeries: 'SI-Card 10',
    fullName,
    club: 'OK Österåker',
    birthYear: null,
    defaultClassName: null,
    eventorPersonId: null,
    eventorOrgId: null,
    source: 'EVENTOR_API',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('runner name suggestions', () => {
  it('searches name parts without case or accent sensitivity', () => {
    const runners = [
      createRunner('runner-1', 'Anna Björk'),
      createRunner('runner-2', 'Sara Lund'),
    ];

    expect(getRunnerNameSuggestions(runners, 'BJORK').map((runner) => runner.id)).toEqual([
      'runner-1',
    ]);
  });

  it('requires at least two characters and limits the suggestion list', () => {
    const runners = Array.from({ length: 10 }, (_, index) =>
      createRunner(`runner-${index}`, `Anna Runner ${index}`)
    );

    expect(getRunnerNameSuggestions(runners, 'a')).toEqual([]);
    expect(getRunnerNameSuggestions(runners, 'Anna')).toHaveLength(8);
  });
});
