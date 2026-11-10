import { describe, expect, it } from 'vitest';
import { protectCloudHydratedCompetitors } from './cloudHydrateCompetitorFence';

describe('protectCloudHydratedCompetitors', () => {
  it('hydrates mirror fields while preserving identity, lifecycle, and assignment metadata', () => {
    const current = [
      {
        id: 'cmp-1',
        competitorId: 'cmp-1',
        fullName: 'Current name',
        siNumber: 12345,
        cardSeries: 'SI-Card 10',
        status: 'REGISTERED',
        assignmentId: 'assignment-current',
        assignmentVersion: 4,
        assignmentSource: 'MANUAL',
        state: 'ACTIVE',
        ownerUid: 'current-owner',
      },
    ];
    const incoming = [
      {
        id: 'cmp-1',
        competitorId: 'cmp-other',
        fullName: 'Hydrated name',
        siNumber: 67890,
        cardSeries: 'SI-Card 11',
        status: 'DNS',
        assignmentId: 'assignment-other',
        assignmentVersion: 1,
        assignmentSource: 'IMPORT',
        state: 'RETIRED',
        ownerUid: 'other-owner',
      },
    ];

    const result = protectCloudHydratedCompetitors(current, incoming);

    expect(result.competitors).toEqual([
      {
        ...current[0],
        fullName: 'Hydrated name',
      },
    ]);
    expect(result.blockedChanges).toEqual([
      {
        competitorId: 'cmp-1',
        operation: 'UPDATE',
        fields: [
          'competitorId',
          'siNumber',
          'cardSeries',
          'status',
          'assignmentId',
          'assignmentVersion',
          'assignmentSource',
          'state',
          'ownerUid',
        ],
      },
    ]);
  });

  it('preserves local competitors and rejects incoming additions and removals', () => {
    const current = [
      { id: 'cmp-1', fullName: 'One', siNumber: 12345, cardSeries: 'SI-Card 10' },
      { id: 'cmp-2', fullName: 'Two', siNumber: 67890, cardSeries: 'SI-Card 10' },
    ];
    const incoming = [
      { id: 'cmp-1', fullName: 'Hydrated one', siNumber: 99999, cardSeries: 'SI-Card 11' },
      { id: 'cmp-3', fullName: 'New competitor', siNumber: 54321, cardSeries: 'SI-Card 10' },
    ];

    const result = protectCloudHydratedCompetitors(current, incoming);

    expect(result.competitors).toEqual([
      { ...current[0], fullName: 'Hydrated one' },
      current[1],
    ]);
    expect(result.blockedChanges).toContainEqual({
      competitorId: 'cmp-2',
      operation: 'REMOVE',
      fields: ['competitorId', 'siNumber', 'cardSeries', 'assignment'],
    });
    expect(result.blockedChanges).toContainEqual({
      competitorId: 'cmp-3',
      operation: 'ADD',
      fields: ['competitorId', 'siNumber', 'cardSeries', 'assignment'],
    });
  });
});
