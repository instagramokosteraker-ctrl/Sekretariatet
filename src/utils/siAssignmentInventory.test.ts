import { describe, expect, it } from 'vitest';
import {
  buildSIAssignmentInventory,
  formatSIAssignmentInventoryMarkdown,
  planMissingSIAssignments,
  type SIAssignmentInventoryReport,
} from './siAssignmentInventory';

const competitor = (siNumber: unknown, status = 'REGISTERED') => ({
  data: { siNumber, status },
});

const assignment = (
  siNumber: unknown,
  competitorId: string | null,
  state = 'ACTIVE',
  competitionId = 'evt_test'
) => ({
  data: { siNumber, competitorId, competitorDocumentId: competitorId, state, competitionId },
});

describe('SI assignment inventory', () => {
  it('plans only unique valid SI numbers with no existing assignment', () => {
    const plan = planMissingSIAssignments({
      competitors: [
        {
          documentId: 'cmp_unique',
          data: { siNumber: 11, cardSeries: 'SI-Card 10' },
        },
        {
          documentId: 'cmp_duplicate_a',
          data: { siNumber: 12, cardSeries: 'SI-Card 10' },
        },
        {
          documentId: 'cmp_duplicate_b',
          data: { siNumber: 12, cardSeries: 'SI-Card 10' },
        },
        {
          documentId: 'cmp_existing',
          data: { siNumber: 13, cardSeries: 'SI-Card 8' },
        },
        {
          documentId: 'cmp_invalid_series',
          data: { siNumber: 14, cardSeries: '' },
        },
        {
          documentId: 'cmp_invalid_si',
          data: { siNumber: 0, cardSeries: 'SI-Card 9' },
        },
      ],
      existingAssignmentDocumentIds: new Set(['13']),
    });

    expect(plan.candidates).toEqual([
      { competitorId: 'cmp_unique', siNumber: 11, cardSeries: 'SI-Card 10' },
    ]);
    expect(plan.duplicates).toEqual([
      { siNumber: 12, competitorIds: ['cmp_duplicate_a', 'cmp_duplicate_b'] },
    ]);
    expect(plan.skipped.map((item) => item.reason).sort()).toEqual([
      'DUPLICATE_SI_NUMBER',
      'DUPLICATE_SI_NUMBER',
      'ALREADY_EXISTS',
      'INVALID_CARD_SERIES',
      'INVALID_SI_NUMBER',
    ].sort());
  });

  it('reports competitor and assignment conflicts without modifying source records', () => {
    const report = buildSIAssignmentInventory({
      competitionId: 'evt_test',
      competitionName: 'Test',
      competitors: [
        { documentId: 'cmp_dup_1', ...competitor(10) },
        { documentId: 'cmp_dup_2', ...competitor(10) },
        { documentId: 'cmp_missing_si', ...competitor(undefined) },
        { documentId: 'cmp_invalid_si', ...competitor('bad') },
        { documentId: 'cmp_without_assignment', ...competitor(20) },
        { documentId: 'cmp_retired_active', ...competitor(30) },
        { documentId: 'cmp_mismatch', ...competitor(40) },
      ],
      assignments: [
        { documentId: '10', ...assignment(10, 'cmp_dup_1') },
        { documentId: '10-copy', ...assignment(10, 'cmp_dup_2') },
        { documentId: '50', ...assignment(50, 'cmp_not_found') },
        { documentId: '30', ...assignment(30, 'cmp_retired_active', 'RETIRED') },
        { documentId: '40', ...assignment(40, 'cmp_other') },
        { documentId: '60', ...assignment(60, 'cmp_wrong_competition', 'ACTIVE', 'evt_other') },
      ],
    });

    const conflictTypes = report.issues.map((issue) => issue.conflictType);
    expect(conflictTypes).toEqual(
      expect.arrayContaining([
        'SAKNAT_SI_NUMMER',
        'OGILTIGT_SI_NUMMER',
        'DUBBELT_SI_NUMMER',
        'SI_TILLDELAT_FLERA_KONKURRENTER',
        'ASSIGNMENT_UTAN_KONKURRENT',
        'KONKURRENT_UTAN_ASSIGNMENT',
        'ASSIGNMENT_KONKURRENT_MISMATCH',
        'PENSIONERAD_ASSIGNMENT_AKTIV_KONKURRENT',
        'ASSIGNMENT_TAVLINGSMISMATCH',
      ])
    );
    expect(report.issues.find((issue) => issue.conflictType === 'SAKNAT_SI_NUMMER')?.severity)
      .toBe('WARNING');
    expect(report.issues.find((issue) => issue.conflictType === 'OGILTIGT_SI_NUMMER')?.severity)
      .toBe('ERROR');
  });

  it('reports a clean competition as INFO and formats a markdown report', () => {
    const competition = buildSIAssignmentInventory({
      competitionId: 'evt_test',
      competitionName: 'Test competition',
      competitors: [],
      assignments: [],
    });
    const report: SIAssignmentInventoryReport = {
      generatedAtIso: '2026-03-01T10:00:00.000Z',
      competitionCount: 1,
      competitorCount: 0,
      assignmentCount: 0,
      competitions: [competition],
    };

    expect(competition.issues[0].severity).toBe('INFO');
    expect(formatSIAssignmentInventoryMarkdown(report)).toContain(
      '## Test competition (evt_test)'
    );
    expect(formatSIAssignmentInventoryMarkdown(report)).toContain('Inga konflikter');
    expect(formatSIAssignmentInventoryMarkdown(report)).toContain('Löpar-ID');
  });
});
