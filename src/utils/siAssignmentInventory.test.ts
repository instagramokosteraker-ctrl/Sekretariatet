import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  buildSIAssignmentInventory,
  formatConflictRemediationPlanV2Markdown,
  formatLiveIntegrityInventoryV2Markdown,
  formatSIAssignmentInventoryMarkdown,
  planMissingSIAssignments,
  type SIAssignmentInventoryReport,
} from './siAssignmentInventory';
import { SI_CARD_ASSIGNMENT_SCHEMA_VERSION } from '../types/sportident';

const competitor = (
  id: string,
  siNumber: unknown,
  status = 'REGISTERED',
  extra: Record<string, unknown> = {}
) => ({
  documentId: id,
  data: {
    id,
    siNumber,
    status,
    cardSeries: 'SI-Card 10',
    ownerUid: 'owner-1',
    ...extra,
  },
});

const assignment = (
  siNumber: unknown,
  competitorId: string | null,
  state = 'ACTIVE',
  competitionId = 'evt_test',
  extra: Record<string, unknown> = {}
) => ({
  documentId: String(siNumber),
  data: {
    siNumber,
    competitorId,
    competitorDocumentId: competitorId,
    state,
    competitionId,
    cardSeries: 'SI-Card 10',
    ownerUid: 'owner-1',
    assignmentVersion: 1,
    source: 'MANUAL',
    schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
    createdAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
    updatedAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
    ...extra,
  },
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
        competitor('cmp_dup_1', 10),
        competitor('cmp_dup_2', 10),
        competitor('cmp_missing_si', undefined),
        competitor('cmp_invalid_si', 'bad'),
        competitor('cmp_without_assignment', 20),
        competitor('cmp_retired_active', 30),
        competitor('cmp_mismatch', 40),
      ],
      assignments: [
        assignment(10, 'cmp_dup_1'),
        { ...assignment(10, 'cmp_dup_2'), documentId: '10-copy' },
        assignment(50, 'cmp_not_found'),
        assignment(30, 'cmp_retired_active', 'RETIRED'),
        assignment(40, 'cmp_other'),
        assignment(60, 'cmp_wrong_competition', 'ACTIVE', 'evt_other'),
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
        'ORPHANED_RETIRED_ASSIGNMENT',
        'ASSIGNMENT_COMPETITION_ID_MISMATCH',
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
      activeAssignmentCount: 0,
      retiredAssignmentCount: 0,
      historicalReassignmentCount: 0,
      orphanAssignmentCount: 0,
      orphanCompetitorCount: 0,
      parityMismatchCount: 0,
      competitions: [competition],
    };

    expect(competition.issues[0].severity).toBe('INFO');
    expect(formatSIAssignmentInventoryMarkdown(report)).toContain(
      '## Test competition (evt_test)'
    );
    expect(formatSIAssignmentInventoryMarkdown(report)).toContain('Inga konflikter');
    expect(formatSIAssignmentInventoryMarkdown(report)).toContain('Löpar-ID');
  });

  it('classifies a retired SI as a historical reassignment when the competitor has an active successor', () => {
    const report = buildSIAssignmentInventory({
      competitionId: 'evt_test',
      competitionName: 'Test',
      competitors: [
        competitor('cmp_reassigned', 222, 'REGISTERED', { cardSeries: 'SI-Card 8' }),
      ],
      assignments: [
        assignment(111, 'cmp_reassigned', 'RETIRED', 'evt_test', {
          cardSeries: 'SI-Card 10',
        }),
        assignment(222, 'cmp_reassigned', 'ACTIVE', 'evt_test', {
          cardSeries: 'SI-Card 8',
        }),
      ],
    });

    expect(report.historicalReassignmentCount).toBe(1);
    expect(report.retiredAssignmentCount).toBe(1);
    expect(report.activeAssignmentCount).toBe(1);
    expect(report.orphanAssignmentCount).toBe(0);
    expect(report.orphanCompetitorCount).toBe(0);
    expect(report.issues.map((issue) => issue.conflictType)).toContain(
      'HISTORICAL_REASSIGNMENT'
    );
    expect(report.issues.some((issue) => issue.conflictType === 'ASSIGNMENT_CARD_SERIES_MISMATCH'))
      .toBe(false);
  });

  it('reports ownership parity mismatches and orphaned retired assignments', () => {
    const report = buildSIAssignmentInventory({
      competitionId: 'evt_test',
      competitionName: 'Test',
      competitors: [
        competitor('cmp_bad', 333, 'REGISTERED', { cardSeries: 'SI-Card 8', ownerUid: 'owner-2' }),
        competitor('cmp_orphan', 444),
      ],
      assignments: [
        assignment(333, 'cmp_bad', 'ACTIVE', 'evt_test', {
          competitorDocumentId: 'cmp_wrong',
          cardSeries: 'SI-Card 10',
          ownerUid: 'owner-1',
        }),
        assignment(222, 'cmp_bad', 'RETIRED'),
      ],
    });

    expect(report.parityMismatchCount).toBeGreaterThanOrEqual(3);
    expect(report.orphanAssignmentCount).toBe(2);
    expect(report.orphanCompetitorCount).toBe(2);
    expect(report.issues.map((issue) => issue.conflictType)).toEqual(
      expect.arrayContaining([
        'COMPETITOR_DOCUMENT_ID_MISMATCH',
        'ASSIGNMENT_CARD_SERIES_MISMATCH',
        'ASSIGNMENT_OWNER_UID_MISMATCH',
        'ORPHANED_RETIRED_ASSIGNMENT',
      ])
    );
  });

  it('checks embedded competitorId and current SI parity against the document identity', () => {
    const report = buildSIAssignmentInventory({
      competitionId: 'evt_test',
      competitionName: 'Test',
      competitors: [
        competitor('cmp_path', 777, 'REGISTERED', { competitorId: 'cmp_embedded' }),
      ],
      assignments: [assignment(778, 'cmp_path')],
    });

    expect(report.parityMismatchCount).toBeGreaterThanOrEqual(2);
    expect(report.issues.map((issue) => issue.conflictType)).toEqual(
      expect.arrayContaining([
        'COMPETITOR_PATH_ID_MISMATCH',
        'ASSIGNMENT_SI_NUMBER_MISMATCH',
      ])
    );
  });

  it('reports V2 totals and remediation guidance', () => {
    const competition = buildSIAssignmentInventory({
      competitionId: 'evt_test',
      competitionName: 'Test',
      competitors: [competitor('cmp_a', 222)],
      assignments: [
        assignment(111, 'cmp_a', 'RETIRED'),
        assignment(222, 'cmp_a'),
      ],
    });
    const report: SIAssignmentInventoryReport = {
      generatedAtIso: '2026-11-10T00:00:00.000Z',
      competitionCount: 1,
      competitorCount: competition.competitorCount,
      assignmentCount: competition.assignmentCount,
      activeAssignmentCount: competition.activeAssignmentCount,
      retiredAssignmentCount: competition.retiredAssignmentCount,
      historicalReassignmentCount: competition.historicalReassignmentCount,
      orphanAssignmentCount: competition.orphanAssignmentCount,
      orphanCompetitorCount: competition.orphanCompetitorCount,
      parityMismatchCount: competition.parityMismatchCount,
      competitions: [competition],
    };

    expect(formatLiveIntegrityInventoryV2Markdown(report)).toContain(
      '| Test | evt_test | 1 | 1 | 1 | 1 | 0 | 0 | 0 |'
    );
    expect(formatConflictRemediationPlanV2Markdown(report)).toContain(
      'Historical SI reassignments are expected'
    );
  });
});
