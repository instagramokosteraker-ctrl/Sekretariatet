import type {
  SICardAssignment,
  SICardAssignmentSource,
  SICardAssignmentStatus,
  SICardAssignmentValidationIssue,
  SICardAssignmentValidationReport,
} from '../types/sportident';

const ASSIGNMENT_STATUSES = new Set<SICardAssignmentStatus>([
  'ACTIVE',
  'RETIRED',
  'REASSIGNED',
  'DUPLICATE_CONFIRMED',
  'UNKNOWN',
]);

const ASSIGNMENT_SOURCES = new Set<SICardAssignmentSource>([
  'DIRECT_ENTRY',
  'EVENTOR_IMPORT',
  'MANUAL_ASSIGNMENT',
  'LEGACY_MIGRATION',
]);

export function parseSICardAssignmentDocument(
  documentId: string,
  competitionId: string,
  data: Record<string, unknown>
): SICardAssignment | null {
  const siNumber = Number(data.siNumber);
  if (
    data.competitionId !== competitionId ||
    !Number.isInteger(siNumber) ||
    siNumber < 1 ||
    siNumber > 99999999 ||
    documentId !== String(siNumber) ||
    typeof data.status !== 'string' ||
    !ASSIGNMENT_STATUSES.has(data.status as SICardAssignmentStatus) ||
    typeof data.source !== 'string' ||
    !ASSIGNMENT_SOURCES.has(data.source as SICardAssignmentSource) ||
    !Number.isInteger(data.assignmentVersion) ||
    Number(data.assignmentVersion) < 1
  ) {
    return null;
  }

  return {
    competitionId,
    siNumber,
    competitorId: typeof data.competitorId === 'string' ? data.competitorId : null,
    status: data.status as SICardAssignmentStatus,
    assignmentVersion: Number(data.assignmentVersion),
    source: data.source as SICardAssignmentSource,
    ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : null,
    assignedAtIso: typeof data.assignedAtIso === 'string' ? data.assignedAtIso : null,
    retiredAtIso: typeof data.retiredAtIso === 'string' ? data.retiredAtIso : null,
    retirementReason:
      typeof data.retirementReason === 'string' ? data.retirementReason : null,
    createdAtIso: typeof data.createdAtIso === 'string' ? data.createdAtIso : null,
    updatedAtIso: typeof data.updatedAtIso === 'string' ? data.updatedAtIso : null,
  };
}

export function buildSICardAssignmentValidationReport(params: {
  competitionId: string;
  records: Array<{ documentId: string; data: Record<string, unknown> }>;
  competitorSiNumbers: Map<string, number>;
}): SICardAssignmentValidationReport {
  const { competitionId, records, competitorSiNumbers } = params;
  const issues: SICardAssignmentValidationIssue[] = [];
  const parsed: Array<{ documentId: string; assignment: SICardAssignment }> = [];
  const recordsBySi = new Map<number, string[]>();
  const activeByCompetitor = new Map<string, number[]>();
  let activeCount = 0;
  let retiredCount = 0;

  for (const record of records) {
    const rawSiNumber = Number(record.data.siNumber);
    if (Number.isInteger(rawSiNumber) && rawSiNumber >= 1 && rawSiNumber <= 99999999) {
      const documentIds = recordsBySi.get(rawSiNumber) ?? [];
      documentIds.push(record.documentId);
      recordsBySi.set(rawSiNumber, documentIds);
    }

    const assignment = parseSICardAssignmentDocument(
      record.documentId,
      competitionId,
      record.data
    );
    if (!assignment) {
      issues.push({
        code:
          Number.isInteger(rawSiNumber) &&
          rawSiNumber > 0 &&
          record.documentId !== String(rawSiNumber)
            ? 'DOCUMENT_ID_MISMATCH'
            : 'INVALID_DOCUMENT',
        siNumbers:
          Number.isInteger(rawSiNumber) && rawSiNumber > 0 ? [rawSiNumber] : [],
        competitorIds:
          typeof record.data.competitorId === 'string'
            ? [record.data.competitorId]
            : [],
        documentIds: [record.documentId],
        message: `SI assignment document ${record.documentId} is malformed or has an inconsistent document ID.`,
      });
      continue;
    }

    parsed.push({ documentId: record.documentId, assignment });
    if (assignment.status === 'ACTIVE') {
      activeCount += 1;
      if (assignment.competitorId) {
        const siNumbers = activeByCompetitor.get(assignment.competitorId) ?? [];
        siNumbers.push(assignment.siNumber);
        activeByCompetitor.set(assignment.competitorId, siNumbers);
      }
    } else if (assignment.status === 'RETIRED') {
      retiredCount += 1;
    } else if (assignment.status === 'DUPLICATE_CONFIRMED') {
      issues.push({
        code: 'DUPLICATE_CONFIRMED',
        siNumbers: [assignment.siNumber],
        competitorIds: assignment.competitorId ? [assignment.competitorId] : [],
        documentIds: [record.documentId],
        message: `SI ${assignment.siNumber} is marked as a confirmed duplicate and needs manual review.`,
      });
    }
  }

  for (const [siNumber, documentIds] of recordsBySi) {
    if (documentIds.length > 1) {
      issues.push({
        code: 'DUPLICATE_SI_NUMBER',
        siNumbers: [siNumber],
        competitorIds: records
          .filter(
            (record) =>
              Number(record.data.siNumber) === siNumber &&
              typeof record.data.competitorId === 'string'
          )
          .map((record) => String(record.data.competitorId)),
        documentIds,
        message: `SI ${siNumber} appears in multiple assignment documents.`,
      });
    }
  }

  for (const [competitorId, siNumbers] of activeByCompetitor) {
    if (siNumbers.length > 1) {
      issues.push({
        code: 'DUPLICATE_COMPETITOR_ASSIGNMENT',
        siNumbers,
        competitorIds: [competitorId],
        documentIds: parsed
          .filter(
            ({ assignment }) =>
              assignment.status === 'ACTIVE' &&
              assignment.competitorId === competitorId
          )
          .map(({ documentId }) => documentId),
        message: `Competitor ${competitorId} has multiple active SI assignments.`,
      });
    }
  }

  for (const { documentId, assignment } of parsed) {
    if (assignment.status !== 'ACTIVE' || !assignment.competitorId) continue;
    const competitorSiNumber = competitorSiNumbers.get(assignment.competitorId);
    if (competitorSiNumber === undefined) {
      issues.push({
        code: 'ORPHANED_COMPETITOR',
        siNumbers: [assignment.siNumber],
        competitorIds: [assignment.competitorId],
        documentIds: [documentId],
        message: `Active SI assignment ${assignment.siNumber} references missing competitor ${assignment.competitorId}.`,
      });
    } else if (competitorSiNumber !== assignment.siNumber) {
      issues.push({
        code: 'COMPETITOR_SI_MISMATCH',
        siNumbers: [assignment.siNumber, competitorSiNumber],
        competitorIds: [assignment.competitorId],
        documentIds: [documentId],
        message: `SI assignment ${assignment.siNumber} does not match competitor ${assignment.competitorId}'s SI ${competitorSiNumber}.`,
      });
    }
  }

  return {
    competitionId,
    generatedAtIso: new Date().toISOString(),
    assignmentCount: records.length,
    activeCount,
    retiredCount,
    issues,
  };
}
