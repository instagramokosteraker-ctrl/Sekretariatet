import type {
  SIAssignmentInventoryIssue,
  SIAssignmentInventoryReport,
} from './siAssignmentInventory';

export interface AcknowledgedIntegrityException {
  competitionId: string;
  competitionName: string;
  competitorDocumentId: string;
  assignmentDocumentId: string;
  siNumber: string;
  rationale: string;
}

export interface LiveIntegrityFinding {
  competitionId: string;
  competitionName: string;
  issue: SIAssignmentInventoryIssue;
}

export const ACKNOWLEDGED_HISTORICAL_OWNER_UID_EXCEPTIONS: readonly AcknowledgedIntegrityException[] = [
  {
    competitionId: 'evt-1794087219877',
    competitionName: 'Reflexcup#2',
    competitorDocumentId: 'cmp_1794087402138_z0j2wy',
    assignmentDocumentId: '8501992',
    siNumber: '8501992',
    rationale: 'Legacy SYSTEM assignment from the early inventory bootstrap.',
  },
  {
    competitionId: 'evt-1794087219877',
    competitionName: 'Reflexcup#2',
    competitorDocumentId: 'cmp_1794087402744_uzvhzj',
    assignmentDocumentId: '8502410',
    siNumber: '8502410',
    rationale: 'Legacy SYSTEM assignment from the early inventory bootstrap.',
  },
  {
    competitionId: 'evt-1794087219877',
    competitionName: 'Reflexcup#2',
    competitorDocumentId: 'cmp_1794087403371_9fjfj9',
    assignmentDocumentId: '8509112',
    siNumber: '8509112',
    rationale: 'Legacy SYSTEM assignment from the early inventory bootstrap.',
  },
  {
    competitionId: 'evt-1794087219877',
    competitionName: 'Reflexcup#2',
    competitorDocumentId: 'cmp_1794087404007_62q0ok',
    assignmentDocumentId: '8509448',
    siNumber: '8509448',
    rationale: 'Legacy SYSTEM assignment from the early inventory bootstrap.',
  },
  {
    competitionId: 'evt-1794343263813',
    competitionName: 'Lång-TM',
    competitorDocumentId: 'cmp_1794343935035_1f32fw',
    assignmentDocumentId: '123456',
    siNumber: '123456',
    rationale: 'Acknowledged ownerUid mismatch; writer/deployment provenance remains unknown.',
  },
  {
    competitionId: 'evt-1794343263813',
    competitionName: 'Lång-TM',
    competitorDocumentId: 'cmp_1794343951204_oa6epr',
    assignmentDocumentId: '234567',
    siNumber: '234567',
    rationale: 'Acknowledged ownerUid mismatch; writer/deployment provenance remains unknown.',
  },
];

export function partitionLiveIntegrityFindings(
  report: Pick<SIAssignmentInventoryReport, 'competitions'>
): {
  activeFindings: LiveIntegrityFinding[];
  acknowledgedFindings: LiveIntegrityFinding[];
  unobservedExceptions: AcknowledgedIntegrityException[];
} {
  const activeFindings: LiveIntegrityFinding[] = [];
  const acknowledgedFindings: LiveIntegrityFinding[] = [];
  const observedExceptions = new Set<AcknowledgedIntegrityException>();

  for (const competition of report.competitions) {
    for (const issue of competition.issues) {
      if (issue.severity === 'INFO') continue;
      const finding = {
        competitionId: competition.competitionId,
        competitionName: competition.competitionName,
        issue,
      };
      const exception =
        issue.conflictType === 'ASSIGNMENT_OWNER_UID_MISMATCH'
          ? ACKNOWLEDGED_HISTORICAL_OWNER_UID_EXCEPTIONS.find(
              (candidate) =>
                candidate.competitionId === competition.competitionId &&
                candidate.competitorDocumentId === issue.competitorIds[0] &&
                candidate.assignmentDocumentId === issue.assignmentDocumentIds[0] &&
                candidate.siNumber === issue.siNumber &&
                competition.ownerUidForensicRecords.some(
                  (record) =>
                    record.competitorDocumentId === candidate.competitorDocumentId &&
                    record.siNumber === candidate.siNumber &&
                    record.assignmentState === 'ACTIVE'
                )
            )
          : undefined;

      if (exception) {
        observedExceptions.add(exception);
        acknowledgedFindings.push(finding);
      } else {
        activeFindings.push(finding);
      }
    }
  }

  return {
    activeFindings,
    acknowledgedFindings,
    unobservedExceptions: ACKNOWLEDGED_HISTORICAL_OWNER_UID_EXCEPTIONS.filter(
      (exception) => !observedExceptions.has(exception)
    ),
  };
}
