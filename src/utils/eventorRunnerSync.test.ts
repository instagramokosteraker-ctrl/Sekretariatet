import { describe, expect, it } from 'vitest';
import type { RunnerDbEntry } from '../types/sportident';
import { reconcileEventorRunnerDbEntries } from './eventorRunnerSync';

function runner(overrides: Partial<RunnerDbEntry> = {}): RunnerDbEntry {
  return {
    id: '8500100',
    siNumber: 8500100,
    cardSeries: 'SI-Card 10',
    fullName: 'Ada Löpare',
    club: 'OK Exempel',
    birthYear: 1990,
    defaultClassName: 'D35',
    eventorPersonId: null,
    eventorOrgId: '123',
    source: 'EVENTOR_API',
    updatedAt: '2026-11-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('Eventor runner sync reconciliation', () => {
  it('matches by person ID first and preserves the local SI number and profile ID', () => {
    const [resolved] = reconcileEventorRunnerDbEntries(
      [
        runner({
          id: '8500200',
          siNumber: 8500200,
          fullName: 'Ada Updated',
          birthYear: 1991,
          eventorPersonId: 'person-1',
        }),
      ],
      [
        runner({
          id: '8500100',
          siNumber: 8500100,
          fullName: 'Ada Old',
          eventorPersonId: 'person-1',
        }),
      ]
    );

    expect(resolved).toMatchObject({
      id: '8500100',
      siNumber: 8500100,
      fullName: 'Ada Updated',
      birthYear: 1991,
      eventorPersonId: 'person-1',
    });
  });

  it('links an unlinked same-name-and-club profile instead of creating a new one', () => {
    const [resolved] = reconcileEventorRunnerDbEntries(
      [
        runner({
          id: '8500200',
          siNumber: 8500200,
          fullName: ' ADA   LÖPARE ',
          club: 'ok exempel',
          eventorPersonId: 'person-2',
        }),
      ],
      [runner({ eventorPersonId: null })]
    );

    expect(resolved).toMatchObject({
      id: '8500100',
      siNumber: 8500100,
      eventorPersonId: 'person-2',
    });
  });

  it('deduplicates multiple Eventor rows for the same person ID', () => {
    const resolved = reconcileEventorRunnerDbEntries(
      [
        runner({ eventorPersonId: 'person-duplicate' }),
        runner({
          id: '8500200',
          siNumber: 8500200,
          eventorPersonId: 'person-duplicate',
        }),
      ],
      []
    );

    expect(resolved).toHaveLength(1);
  });

  it('creates a new profile when neither identity nor name-and-club match', () => {
    const incoming = runner({
      id: '8500200',
      siNumber: 8500200,
      fullName: 'New Runner',
      eventorPersonId: 'person-3',
    });

    expect(reconcileEventorRunnerDbEntries([incoming], [runner()])).toEqual([
      incoming,
    ]);
  });
});
