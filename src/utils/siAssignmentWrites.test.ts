import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import type { SICardAssignment } from '../types/sportident';
import {
  planCreateSIAssignmentWrite,
  planRetireSIAssignmentWrite,
} from './siAssignmentWrites';

const existingAssignment = (
  overrides: Partial<SICardAssignment> = {}
): SICardAssignment => ({
  competitionId: 'evt_test',
  siNumber: 12345,
  cardSeries: 'SI-Card 10',
  competitorId: 'cmp_test',
  competitorDocumentId: 'cmp_test',
  state: 'ACTIVE',
  assignmentVersion: 1,
  source: 'DIRECT_ENTRY',
  ownerUid: 'admin_uid',
  schemaVersion: 1,
  createdAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')),
  updatedAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')),
  ...overrides,
});

describe('SI assignment write plans', () => {
  it('creates a new assignment, preserves an exact match, and avoids overwriting conflicts', () => {
    expect(planCreateSIAssignmentWrite(null, 'cmp_test')).toBe('CREATE');
    expect(
      planCreateSIAssignmentWrite(existingAssignment(), 'cmp_test')
    ).toBe('ALREADY_MATCHED');
    expect(
      planCreateSIAssignmentWrite(
        existingAssignment({ competitorId: 'cmp_other', competitorDocumentId: 'cmp_other' }),
        'cmp_test'
      )
    ).toBe('SKIP_CONFLICT');
    expect(
      planCreateSIAssignmentWrite(
        existingAssignment({ state: 'RETIRED' }),
        'cmp_test'
      )
    ).toBe('SKIP_CONFLICT');
  });

  it('creates a retirement tombstone or retires only an assignment owned by the competitor', () => {
    expect(planRetireSIAssignmentWrite(null, 'cmp_test')).toBe('CREATE_RETIRED');
    expect(
      planRetireSIAssignmentWrite(existingAssignment(), 'cmp_test')
    ).toBe('RETIRE');
    expect(
      planRetireSIAssignmentWrite(
        existingAssignment({ state: 'RETIRED' }),
        'cmp_test'
      )
    ).toBe('ALREADY_RETIRED');
    expect(
      planRetireSIAssignmentWrite(
        existingAssignment({ competitorId: 'cmp_other', competitorDocumentId: 'cmp_other' }),
        'cmp_test'
      )
    ).toBe('SKIP_CONFLICT');
  });

  it('does not increment assignment versions past the schema limit', () => {
    expect(
      planRetireSIAssignmentWrite(
        existingAssignment({ assignmentVersion: 65535 }),
        'cmp_test'
      )
    ).toBe('SKIP_VERSION_LIMIT');
  });
});
