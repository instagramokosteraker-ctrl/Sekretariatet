import { describe, expect, it } from 'vitest';
import {
  buildSICardAssignmentValidationReport,
  parseSICardAssignmentDocument,
} from './siCardAssignments';

const assignment = (siNumber: number, competitorId: string, status = 'ACTIVE') => ({
  competitionId: 'evt_test',
  siNumber,
  competitorId,
  status,
  assignmentVersion: 1,
  source: 'DIRECT_ENTRY',
  ownerUid: 'admin_uid',
  assignedAtIso: null,
  retiredAtIso: null,
  retirementReason: null,
  createdAtIso: null,
  updatedAtIso: null,
});

describe('SI card assignment helpers', () => {
  it('parses valid documents and rejects mismatched document IDs', () => {
    expect(
      parseSICardAssignmentDocument(
        '8500111',
        'evt_test',
        assignment(8500111, 'cmp_1')
      )?.status
    ).toBe('ACTIVE');
    expect(
      parseSICardAssignmentDocument(
        '8500112',
        'evt_test',
        assignment(8500111, 'cmp_1')
      )
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
