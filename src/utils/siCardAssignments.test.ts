import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import {
  assignmentMatchesCompetitorIdentity,
  buildSICardAssignmentValidationReport,
  parseSICardAssignmentDocument,
} from './siCardAssignments';

const assignment = (siNumber: number, competitorId: string | null, state = 'ACTIVE') => ({
  competitionId: 'evt_test',
  siNumber,
  cardSeries: 'SI-Card 10',
  competitorId,
  competitorDocumentId: competitorId,
  state,
  assignmentVersion: 1,
  source: 'DIRECT_ENTRY',
  ownerUid: 'admin_uid',
  schemaVersion: 1,
  createdAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')),
  updatedAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')),
});

describe('SI card assignment helpers', () => {
  it('requires SI, competitor, card-series, and owner parity', () => {
    const parsed = parseSICardAssignmentDocument(
      '8500111',
      'evt_test',
      assignment(8500111, 'cmp_1')
    );
    const identity = {
      competitionId: 'evt_test',
      competitorId: 'cmp_1',
      siNumber: 8500111,
      cardSeries: 'SI-Card 10',
      ownerUid: 'admin_uid',
    };

    expect(assignmentMatchesCompetitorIdentity(parsed, identity)).toBe(true);
    expect(
      assignmentMatchesCompetitorIdentity(parsed, { ...identity, cardSeries: 'SI-Card 11' })
    ).toBe(false);
    expect(
      assignmentMatchesCompetitorIdentity(parsed, { ...identity, ownerUid: 'other_admin' })
    ).toBe(false);
    expect(
      assignmentMatchesCompetitorIdentity(parsed, { ...identity, competitorId: 'cmp_other' })
    ).toBe(false);
    expect(
      assignmentMatchesCompetitorIdentity(parsed, { ...identity, siNumber: 8500112 })
    ).toBe(false);
  });

  it('rejects assignment parity drift that would break the server-side transaction guard', () => {
    const parsed = parseSICardAssignmentDocument(
      '8500111',
      'evt_test',
      assignment(8500111, 'cmp_1')
    );

    expect(
      assignmentMatchesCompetitorIdentity(parsed, {
        competitionId: 'evt_test',
        competitorId: 'cmp_1',
        siNumber: 8500111,
        cardSeries: 'SI-Card 10',
        ownerUid: 'different_admin',
      })
    ).toBe(false);

    expect(
      assignmentMatchesCompetitorIdentity(parsed, {
        competitionId: 'evt_test',
        competitorId: 'cmp_2',
        siNumber: 8500111,
        cardSeries: 'SI-Card 10',
        ownerUid: 'admin_uid',
      })
    ).toBe(false);
  });

  it('parses valid documents and rejects mismatched document IDs', () => {
    expect(
      parseSICardAssignmentDocument(
        '8500111',
        'evt_test',
        assignment(8500111, 'cmp_1')
      )?.state
    ).toBe('ACTIVE');
    expect(
      parseSICardAssignmentDocument(
        '8500112',
        'evt_test',
        assignment(8500111, 'cmp_1')
      )
    ).toBeNull();
  });

  it('requires the aligned schema and accepts confirmed duplicate state', () => {
    const duplicate = assignment(8500115, 'cmp_4', 'DUPLICATE_CONFIRMED');
    expect(
      parseSICardAssignmentDocument('8500115', 'evt_test', duplicate)?.state
    ).toBe('DUPLICATE_CONFIRMED');
    expect(
      parseSICardAssignmentDocument('8500115', 'evt_test', {
        ...duplicate,
        status: duplicate.state,
      })
    ).toBeNull();
    expect(
      parseSICardAssignmentDocument('8500115', 'evt_test', {
        ...duplicate,
        createdAt: new Date().toISOString(),
      })
    ).toBeNull();
    expect(
      parseSICardAssignmentDocument('8500115', 'evt_test', {
        ...duplicate,
        schemaVersion: 2,
      })
    ).toBeNull();
  });

  it('reports duplicate SI and competitor assignments, retired assignments, and orphans', () => {
    const report = buildSICardAssignmentValidationReport({
      competitionId: 'evt_test',
      records: [
        { documentId: '8500111', data: assignment(8500111, 'cmp_1') },
        { documentId: '8500112', data: assignment(8500112, 'cmp_1') },
        { documentId: '8500111-copy', data: assignment(8500111, 'cmp_2') },
        { documentId: '8500113', data: assignment(8500113, 'cmp_missing') },
        { documentId: '8500114', data: assignment(8500114, 'cmp_3', 'RETIRED') },
        { documentId: '8500115', data: assignment(8500115, 'cmp_4', 'DUPLICATE_CONFIRMED') },
      ],
      competitorSiNumbers: new Map([
        ['cmp_1', 8500111],
        ['cmp_2', 8500111],
        ['cmp_3', 8500114],
      ]),
    });

    expect(report.assignmentCount).toBe(6);
    expect(report.activeCount).toBe(3);
    expect(report.retiredCount).toBe(1);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'DUPLICATE_SI_NUMBER',
        'DUPLICATE_COMPETITOR_ASSIGNMENT',
        'DOCUMENT_ID_MISMATCH',
        'ORPHANED_COMPETITOR',
        'DUPLICATE_CONFIRMED',
      ])
    );
  });
});
