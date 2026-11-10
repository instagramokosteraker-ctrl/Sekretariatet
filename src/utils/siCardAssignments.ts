import { Timestamp } from 'firebase/firestore';
import type {
  SICardAssignment,
  SICardAssignmentSource,
  SICardAssignmentState,
  SICardAssignmentValidationIssue,
  SICardAssignmentValidationReport,
} from '../types/sportident';
import { SI_CARD_ASSIGNMENT_SCHEMA_VERSION } from '../types/sportident';

const ASSIGNMENT_STATES = new Set<SICardAssignmentState>([
  'ACTIVE',
  'RETIRED',
  'DUPLICATE_CONFIRMED',
  'UNKNOWN',
]);

const ASSIGNMENT_SOURCES = new Set<SICardAssignmentSource>([
  'DIRECT_ENTRY',
  'IMPORT',
  'EVENTOR',
  'MANUAL',
  'READOUT',
  'SYSTEM',
]);

const REQUIRED_FIELDS = [
  'competitionId',
  'siNumber',
  'cardSeries',
  'competitorId',
  'competitorDocumentId',
  'state',
  'assignmentVersion',
  'source',
  'ownerUid',
  'schemaVersion',
  'createdAt',
  'updatedAt',
];
const OPTIONAL_FIELDS = [
  'previousCompetitorId',
  'retiredAt',
  'retirementReason',
  'conflictReason',
  'lastValidatedAt',
];
const ALLOWED_FIELDS = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);

export interface CompetitorSIAssignmentIdentity {
  competitionId: string;
  competitorId: string;
  siNumber: number;
  cardSeries: string;
  ownerUid: string;
}

export function assignmentMatchesCompetitorIdentity(
  assignment: SICardAssignment | null,
  identity: CompetitorSIAssignmentIdentity
): boolean {
  return Boolean(
    assignment &&
      assignment.competitionId === identity.competitionId &&
      assignment.siNumber === identity.siNumber &&
      assignment.competitorId === identity.competitorId &&
      assignment.competitorDocumentId === identity.competitorId &&
      assignment.cardSeries === identity.cardSeries &&
      assignment.ownerUid === identity.ownerUid
  );
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isOptionalTimestamp(value: unknown): value is Timestamp | null | undefined {
  return value === undefined || value === null || value instanceof Timestamp;
}

export function parseSICardAssignmentDocument(
  documentId: string,
  competitionId: string,
  data: Record<string, unknown>
): SICardAssignment | null {
  const siNumber = Number(data.siNumber);
  if (
    Object.keys(data).some((field) => !ALLOWED_FIELDS.has(field)) ||
    REQUIRED_FIELDS.some((field) => !(field in data)) ||
    data.competitionId !== competitionId ||
    !Number.isInteger(siNumber) ||
    siNumber < 1 ||
    siNumber > 99999999 ||
    documentId !== String(siNumber) ||
    typeof data.cardSeries !== 'string' ||
    data.cardSeries.length < 1 ||
    data.cardSeries.length > 24 ||
    !isNullableString(data.competitorId) ||
    (typeof data.competitorId === 'string' && data.competitorId.length > 128) ||
    !isNullableString(data.competitorDocumentId) ||
    data.competitorDocumentId !== data.competitorId ||
    typeof data.state !== 'string' ||
    !ASSIGNMENT_STATES.has(data.state as SICardAssignmentState) ||
    typeof data.source !== 'string' ||
    !ASSIGNMENT_SOURCES.has(data.source as SICardAssignmentSource) ||
    typeof data.ownerUid !== 'string' ||
    data.ownerUid.length < 1 ||
    data.ownerUid.length > 128 ||
    data.schemaVersion !== SI_CARD_ASSIGNMENT_SCHEMA_VERSION ||
    !Number.isInteger(data.assignmentVersion) ||
    Number(data.assignmentVersion) < 1 ||
    Number(data.assignmentVersion) > 65535 ||
    !(data.createdAt instanceof Timestamp) ||
    !(data.updatedAt instanceof Timestamp) ||
    !isOptionalString(data.previousCompetitorId) ||
    (typeof data.previousCompetitorId === 'string' &&
      data.previousCompetitorId.length > 128) ||
    !isOptionalTimestamp(data.retiredAt) ||
    !isOptionalString(data.retirementReason) ||
    (typeof data.retirementReason === 'string' && data.retirementReason.length > 200) ||
    !isOptionalString(data.conflictReason) ||
    (typeof data.conflictReason === 'string' && data.conflictReason.length > 200) ||
    !isOptionalTimestamp(data.lastValidatedAt)
  ) {
    return null;
  }

  return {
    competitionId,
    siNumber,
    cardSeries: data.cardSeries,
    competitorId: data.competitorId,
    competitorDocumentId: data.competitorDocumentId,
    state: data.state as SICardAssignmentState,
    assignmentVersion: Number(data.assignmentVersion),
    source: data.source as SICardAssignmentSource,
    ownerUid: data.ownerUid,
    schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    ...(data.previousCompetitorId !== undefined
      ? { previousCompetitorId: data.previousCompetitorId }
      : {}),
    ...(data.retiredAt !== undefined ? { retiredAt: data.retiredAt } : {}),
    ...(data.retirementReason !== undefined
      ? { retirementReason: data.retirementReason }
      : {}),
    ...(data.conflictReason !== undefined ? { conflictReason: data.conflictReason } : {}),
    ...(data.lastValidatedAt !== undefined
      ? { lastValidatedAt: data.lastValidatedAt }
      : {}),
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
    if (assignment.state === 'ACTIVE') {
      activeCount += 1;
      if (assignment.competitorId) {
        const siNumbers = activeByCompetitor.get(assignment.competitorId) ?? [];
        siNumbers.push(assignment.siNumber);
        activeByCompetitor.set(assignment.competitorId, siNumbers);
      }
    } else if (assignment.state === 'RETIRED') {
      retiredCount += 1;
    } else if (assignment.state === 'DUPLICATE_CONFIRMED') {
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
              assignment.state === 'ACTIVE' &&
              assignment.competitorId === competitorId
          )
          .map(({ documentId }) => documentId),
        message: `Competitor ${competitorId} has multiple active SI assignments.`,
      });
    }
  }

  for (const { documentId, assignment } of parsed) {
    if (assignment.state !== 'ACTIVE' || !assignment.competitorId) continue;
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
