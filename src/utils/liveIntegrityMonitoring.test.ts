import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { SI_CARD_ASSIGNMENT_SCHEMA_VERSION } from '../types/sportident';
import {
  ACKNOWLEDGED_HISTORICAL_OWNER_UID_EXCEPTIONS,
  getLiveIntegrityFindingKey,
  partitionLiveIntegrityFindings,
} from './liveIntegrityMonitoring';
import { buildSIAssignmentInventory } from './siAssignmentInventory';

function createReport(params: {
  competitionId: string;
  competitorDocumentId: string;
  siNumber: string;
  assignmentOwnerUid?: string;
  assignmentState?: string;
}) {
  const {
    competitionId,
    competitorDocumentId,
    siNumber,
    assignmentOwnerUid = 'assignment-owner',
    assignmentState = 'ACTIVE',
  } = params;
  const si = Number(siNumber);
  const competition = buildSIAssignmentInventory({
    competitionId,
    competitionName: 'Test competition',
    competitors: [{
      documentId: competitorDocumentId,
      data: {
        competitorId: competitorDocumentId,
        siNumber: si,
        cardSeries: 'SI-Card 10',
        ownerUid: 'competitor-owner',
      },
    }],
    assignments: [{
      documentId: siNumber,
      data: {
        siNumber: si,
        competitorId: competitorDocumentId,
        competitorDocumentId,
        state: assignmentState,
        competitionId,
        cardSeries: 'SI-Card 10',
        ownerUid: assignmentOwnerUid,
        assignmentVersion: 1,
        source: 'MANUAL',
        schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
        createdAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
      },
    }],
  });
  return { competitions: [competition] };
}

describe('live integrity monitoring', () => {
  it('creates stable dismissal keys from finding identity rather than detail text', () => {
    const report = createReport({
      competitionId: 'evt_test',
      competitorDocumentId: 'cmp_test',
      siNumber: '123',
    });
    const issue = report.competitions[0].issues.find(
      (finding) => finding.conflictType === 'ASSIGNMENT_OWNER_UID_MISMATCH'
    );
    expect(issue).toBeDefined();
    if (!issue) return;

    const key = getLiveIntegrityFindingKey({
      competitionId: 'evt_test',
      competitionName: 'Test',
      issue,
    });
    const sameIdentityDifferentDetail = getLiveIntegrityFindingKey({
      competitionId: 'evt_test',
      competitionName: 'Renamed',
      issue: { ...issue, detail: 'Updated finding details.' },
    });
    const differentCompetition = getLiveIntegrityFindingKey({
      competitionId: 'evt_other',
      competitionName: 'Test',
      issue,
    });

    expect(sameIdentityDifferentDetail).toBe(key);
    expect(differentCompetition).not.toBe(key);
  });

  it('acknowledges only the six exact historical ownerUid findings', () => {
    const report = {
      competitions: ACKNOWLEDGED_HISTORICAL_OWNER_UID_EXCEPTIONS.map((exception) =>
        buildSIAssignmentInventory({
          competitionId: exception.competitionId,
          competitionName: exception.competitionName,
          competitors: [{
            documentId: exception.competitorDocumentId,
            data: {
              competitorId: exception.competitorDocumentId,
              siNumber: Number(exception.siNumber),
              cardSeries: 'SI-Card 10',
              ownerUid: 'competitor-owner',
            },
          }],
          assignments: [{
            documentId: exception.assignmentDocumentId,
            data: {
              siNumber: Number(exception.siNumber),
              competitorId: exception.competitorDocumentId,
              competitorDocumentId: exception.competitorDocumentId,
              state: 'ACTIVE',
              competitionId: exception.competitionId,
              cardSeries: 'SI-Card 10',
              ownerUid: 'assignment-owner',
              assignmentVersion: 1,
              source: 'MANUAL',
              schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
              createdAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
              updatedAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
            },
          }],
        })
      ),
    };

    const result = partitionLiveIntegrityFindings(report);

    expect(result.activeFindings).toHaveLength(0);
    expect(result.acknowledgedFindings).toHaveLength(6);
    expect(result.unobservedExceptions).toHaveLength(0);
  });

  it('keeps new or changed ownerUid mismatches active', () => {
    const exception = ACKNOWLEDGED_HISTORICAL_OWNER_UID_EXCEPTIONS[0];
    const report = createReport({
      competitionId: exception.competitionId,
      competitorDocumentId: exception.competitorDocumentId,
      siNumber: '9999999',
    });

    const result = partitionLiveIntegrityFindings(report);

    expect(result.activeFindings.map(({ issue }) => issue.conflictType)).toContain(
      'ASSIGNMENT_OWNER_UID_MISMATCH'
    );
    expect(result.acknowledgedFindings).toHaveLength(0);
    expect(result.unobservedExceptions).toHaveLength(6);
  });

  it('does not acknowledge unrelated integrity findings', () => {
    const report = createReport({
      competitionId: 'evt_other',
      competitorDocumentId: 'cmp_other',
      siNumber: '42',
    });

    const result = partitionLiveIntegrityFindings(report);

    expect(result.activeFindings.map(({ issue }) => issue.conflictType)).toContain(
      'ASSIGNMENT_OWNER_UID_MISMATCH'
    );
    expect(result.acknowledgedFindings).toHaveLength(0);
  });

  it('does not acknowledge a matching owner mismatch after the assignment is retired', () => {
    const exception = ACKNOWLEDGED_HISTORICAL_OWNER_UID_EXCEPTIONS[0];
    const report = createReport({
      competitionId: exception.competitionId,
      competitorDocumentId: exception.competitorDocumentId,
      siNumber: exception.siNumber,
      assignmentState: 'RETIRED',
    });

    const result = partitionLiveIntegrityFindings(report);

    expect(result.activeFindings.map(({ issue }) => issue.conflictType)).toContain(
      'ASSIGNMENT_OWNER_UID_MISMATCH'
    );
    expect(result.acknowledgedFindings).toHaveLength(0);
  });
});
