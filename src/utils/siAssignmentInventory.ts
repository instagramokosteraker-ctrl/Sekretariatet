import { parseSICardAssignmentDocument } from './siCardAssignments';

export type SIAssignmentInventorySeverity = 'INFO' | 'WARNING' | 'ERROR';

export interface SIAssignmentInventoryQueryFailure {
  path: string;
  competitionId: string | null;
  operation: 'get' | 'list';
  errorCode: string;
  userRole: string;
  adminTier: string;
  requiredRole: string;
  message: string;
}

export class SIAssignmentInventoryQueryError extends Error {
  readonly diagnostic: SIAssignmentInventoryQueryFailure;

  constructor(diagnostic: SIAssignmentInventoryQueryFailure) {
    super(diagnostic.message);
    this.name = 'SIAssignmentInventoryQueryError';
    this.diagnostic = diagnostic;
  }
}

export interface SIAssignmentInventoryIssue {
  severity: SIAssignmentInventorySeverity;
  conflictType: string;
  competitorIds: string[];
  siNumber: string;
  detail: string;
}

export interface SIAssignmentInventoryCompetition {
  competitionId: string;
  competitionName: string;
  competitorCount: number;
  assignmentCount: number;
  issues: SIAssignmentInventoryIssue[];
}

export interface SIAssignmentInventoryReport {
  generatedAtIso: string;
  competitionCount: number;
  competitorCount: number;
  assignmentCount: number;
  competitions: SIAssignmentInventoryCompetition[];
}

export interface SIAssignmentInventoryRecord {
  documentId: string;
  data: Record<string, unknown>;
}

export interface MissingSIAssignmentCandidate {
  competitorId: string;
  siNumber: number;
  cardSeries: string;
}

export interface MissingSIAssignmentSkip {
  competitorId: string;
  siNumber: string;
  reason: 'INVALID_SI_NUMBER' | 'DUPLICATE_SI_NUMBER' | 'ALREADY_EXISTS' | 'INVALID_CARD_SERIES';
}

export interface MissingSIAssignmentDuplicate {
  siNumber: number;
  competitorIds: string[];
}

export interface MissingSIAssignmentPlan {
  candidates: MissingSIAssignmentCandidate[];
  skipped: MissingSIAssignmentSkip[];
  duplicates: MissingSIAssignmentDuplicate[];
}

interface AssignmentRecord extends SIAssignmentInventoryRecord {
  siNumber: number | null;
  competitorId: string | null;
  state: string | null;
}

const VALID_SI_NUMBER = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 99999999;

const ACTIVE_COMPETITOR_STATUSES = new Set([
  'REGISTERED',
  'CHECKED',
  'IN_FOREST',
  'PRELIMINARY_FIN',
]);

const CONFLICT_LABELS: Record<string, string> = {
  SAKNAT_SI_NUMMER: 'Löpare saknar SI-nummer',
  OGILTIGT_SI_NUMMER: 'Ogiltigt SI-nummer',
  FELAKTIGT_ASSIGNMENT_DOKUMENT: 'Felaktigt SI-kopplingsdokument',
  OGILTIGT_ASSIGNMENT_SI_NUMMER: 'Ogiltigt SI-nummer i kopplingsdokument',
  FELAKTIGT_ASSIGNMENT_DOKUMENT_ID: 'Dokument-ID stämmer inte med SI-numret',
  ASSIGNMENT_UTAN_KONKURRENT: 'SI-koppling utan löpare',
  AKTIV_ASSIGNMENT_UTAN_KONKURRENT: 'Aktiv SI-koppling utan löpare',
  BEKRAFTAD_SI_DUBBLETT: 'Bekräftad SI-dubblett',
  PENSIONERAD_ASSIGNMENT_AKTIV_KONKURRENT: 'Avslutad SI-koppling med aktiv löpare',
  ASSIGNMENT_SI_MISMATCH: 'SI-numret skiljer sig mellan löpare och koppling',
  ASSIGNMENT_TAVLINGSMISMATCH: 'SI-kopplingen tillhör en annan tävling',
  DUBBELT_SI_NUMMER: 'Samma SI-nummer används av flera löpare',
  SI_TILLDELAT_FLERA_KONKURRENTER: 'SI-numret är kopplat till flera löpare',
  KONKURRENT_UTAN_ASSIGNMENT: 'Löpare utan SI-koppling',
  ASSIGNMENT_KONKURRENT_MISMATCH: 'SI-kopplingen pekar på en annan löpare',
  KONKURRENT_EJ_AKTIV_ASSIGNMENT: 'Löparens SI-koppling är inte aktiv',
  INGA_KONFLIKTER: 'Inga konflikter',
};

function getConflictLabel(conflictType: string): string {
  return CONFLICT_LABELS[conflictType] ?? conflictType;
}

function displaySiNumber(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

function distinct(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function planMissingSIAssignments(params: {
  competitors: SIAssignmentInventoryRecord[];
  existingAssignmentDocumentIds: Set<string>;
}): MissingSIAssignmentPlan {
  const { competitors, existingAssignmentDocumentIds } = params;
  const groupsBySi = new Map<number, SIAssignmentInventoryRecord[]>();
  const skipped: MissingSIAssignmentSkip[] = [];
  const candidates: MissingSIAssignmentCandidate[] = [];

  for (const competitor of competitors) {
    const siNumber = competitor.data.siNumber;
    if (!VALID_SI_NUMBER(siNumber)) {
      skipped.push({
        competitorId: competitor.documentId,
        siNumber: displaySiNumber(siNumber),
        reason: 'INVALID_SI_NUMBER',
      });
      continue;
    }

    const group = groupsBySi.get(siNumber) ?? [];
    group.push(competitor);
    groupsBySi.set(siNumber, group);
  }

  const duplicates: MissingSIAssignmentDuplicate[] = [];
  for (const [siNumber, group] of groupsBySi) {
    if (group.length > 1) {
      const competitorIds = group.map((competitor) => competitor.documentId);
      duplicates.push({ siNumber, competitorIds });
      for (const competitorId of competitorIds) {
        skipped.push({
          competitorId,
          siNumber: String(siNumber),
          reason: 'DUPLICATE_SI_NUMBER',
        });
      }
      continue;
    }

    const competitor = group[0];
    if (existingAssignmentDocumentIds.has(String(siNumber))) {
      skipped.push({
        competitorId: competitor.documentId,
        siNumber: String(siNumber),
        reason: 'ALREADY_EXISTS',
      });
      continue;
    }

    const cardSeries = competitor.data.cardSeries;
    if (
      typeof cardSeries !== 'string' ||
      cardSeries.trim().length === 0 ||
      cardSeries.length > 24
    ) {
      skipped.push({
        competitorId: competitor.documentId,
        siNumber: String(siNumber),
        reason: 'INVALID_CARD_SERIES',
      });
      continue;
    }

    candidates.push({
      competitorId: competitor.documentId,
      siNumber,
      cardSeries,
    });
  }

  return { candidates, skipped, duplicates };
}

export function buildSIAssignmentInventory(params: {
  competitionId: string;
  competitionName: string;
  competitors: SIAssignmentInventoryRecord[];
  assignments: SIAssignmentInventoryRecord[];
}): SIAssignmentInventoryCompetition {
  const { competitionId, competitionName, competitors, assignments } = params;
  const issues: SIAssignmentInventoryIssue[] = [];
  const competitorsById = new Map(competitors.map((record) => [record.documentId, record]));
  const competitorGroupsBySi = new Map<number, SIAssignmentInventoryRecord[]>();
  const assignmentGroupsBySi = new Map<number, AssignmentRecord[]>();
  const assignmentsByDocumentId = new Map<string, AssignmentRecord>();

  const addIssue = (
    severity: SIAssignmentInventorySeverity,
    conflictType: string,
    competitorIds: Array<string | null>,
    siNumber: unknown,
    detail: string
  ) => {
    issues.push({
      severity,
      conflictType,
      competitorIds: distinct(competitorIds),
      siNumber: displaySiNumber(siNumber),
      detail,
    });
  };

  for (const competitor of competitors) {
    const rawSiNumber = competitor.data.siNumber;
    if (rawSiNumber === undefined || rawSiNumber === null || rawSiNumber === '') {
      addIssue(
        'WARNING',
        'SAKNAT_SI_NUMMER',
        [competitor.documentId],
        rawSiNumber,
        'Löparen saknar SI-nummer.'
      );
      continue;
    }

    if (!VALID_SI_NUMBER(rawSiNumber)) {
      addIssue(
        'ERROR',
        'OGILTIGT_SI_NUMMER',
        [competitor.documentId],
        rawSiNumber,
        'SI-numret är inte ett heltal mellan 1 och 99 999 999.'
      );
      continue;
    }

    const group = competitorGroupsBySi.get(rawSiNumber) ?? [];
    group.push(competitor);
    competitorGroupsBySi.set(rawSiNumber, group);
  }

  const parsedAssignments: AssignmentRecord[] = assignments.map((record) => ({
    ...record,
    siNumber: VALID_SI_NUMBER(record.data.siNumber) ? record.data.siNumber : null,
    competitorId:
      typeof record.data.competitorId === 'string' ? record.data.competitorId : null,
    state: typeof record.data.state === 'string' ? record.data.state : null,
  }));

  for (const assignment of parsedAssignments) {
    assignmentsByDocumentId.set(assignment.documentId, assignment);

    if (
      !parseSICardAssignmentDocument(
        assignment.documentId,
        competitionId,
        assignment.data
      )
    ) {
      addIssue(
        'ERROR',
        'FELAKTIGT_ASSIGNMENT_DOKUMENT',
        [assignment.competitorId],
        assignment.siNumber ?? assignment.data.siNumber,
        `SI-kopplingsdokumentet ${assignment.documentId} avviker från det definierade schemat.`
      );
    }

    if (!assignment.siNumber) {
      addIssue(
        'ERROR',
        'OGILTIGT_ASSIGNMENT_SI_NUMMER',
        [assignment.competitorId],
        assignment.data.siNumber,
        `SI-kopplingsdokumentet ${assignment.documentId} innehåller ett ogiltigt SI-nummer.`
      );
    } else {
      const group = assignmentGroupsBySi.get(assignment.siNumber) ?? [];
      group.push(assignment);
      assignmentGroupsBySi.set(assignment.siNumber, group);

      if (assignment.documentId !== String(assignment.siNumber)) {
        addIssue(
          'ERROR',
          'FELAKTIGT_ASSIGNMENT_DOKUMENT-ID',
          [assignment.competitorId],
          assignment.siNumber,
          `Dokument-ID ${assignment.documentId} stämmer inte med SI-numret.`
        );
      }
    }

    const linkedCompetitor = assignment.competitorId
      ? competitorsById.get(assignment.competitorId)
      : undefined;

    if (assignment.competitorId && !linkedCompetitor) {
      addIssue(
        assignment.state === 'RETIRED' ? 'WARNING' : 'ERROR',
        'ASSIGNMENT_UTAN_KONKURRENT',
        [assignment.competitorId],
        assignment.siNumber ?? assignment.data.siNumber,
        `SI-kopplingsdokumentet ${assignment.documentId} hänvisar till en löpare som saknas.`
      );
    }

    if (assignment.state === 'ACTIVE' && !assignment.competitorId) {
      addIssue(
        'ERROR',
        'AKTIV_ASSIGNMENT_UTAN_KONKURRENT',
        [],
        assignment.siNumber ?? assignment.data.siNumber,
        `Det aktiva SI-kopplingsdokumentet ${assignment.documentId} saknar löpar-ID.`
      );
    }

    if (assignment.state === 'DUPLICATE_CONFIRMED') {
      addIssue(
        'WARNING',
        'BEKRAFTAD_SI_DUBBLETT',
        [assignment.competitorId],
        assignment.siNumber ?? assignment.data.siNumber,
        `SI-kopplingen ${assignment.documentId} är markerad som bekräftad dubblett.`
      );
    }

    if (assignment.state === 'RETIRED' && linkedCompetitor) {
      const status = linkedCompetitor.data.status;
      if (typeof status === 'string' && ACTIVE_COMPETITOR_STATUSES.has(status)) {
        addIssue(
          'ERROR',
          'PENSIONERAD_ASSIGNMENT_AKTIV_KONKURRENT',
          [assignment.competitorId],
          assignment.siNumber ?? assignment.data.siNumber,
          `SI-kopplingen ${assignment.documentId} är avslutad, men löparens status är ${status}.`
        );
      }
    }

    if (
      assignment.state === 'ACTIVE' &&
      linkedCompetitor &&
      assignment.siNumber !== null &&
      linkedCompetitor.data.siNumber !== assignment.siNumber
    ) {
      addIssue(
        'ERROR',
        'ASSIGNMENT_SI_MISMATCH',
        [assignment.competitorId],
        assignment.siNumber,
        `SI-kopplingen anger ${assignment.siNumber}, men löparens uppgifter anger ${displaySiNumber(linkedCompetitor.data.siNumber)}.`
      );
    }

    if (
      assignment.data.competitionId !== undefined &&
      assignment.data.competitionId !== competitionId
    ) {
      addIssue(
        'ERROR',
        'ASSIGNMENT_TAVLINGSMISMATCH',
        [assignment.competitorId],
        assignment.siNumber ?? assignment.data.siNumber,
        `SI-kopplingsdokumentet ${assignment.documentId} innehåller ett annat tävlings-ID.`
      );
    }
  }

  for (const [siNumber, group] of competitorGroupsBySi) {
    if (group.length > 1) {
      addIssue(
        'ERROR',
        'DUBBELT_SI_NUMMER',
        group.map((competitor) => competitor.documentId),
        siNumber,
        'Flera löpare i samma tävling har samma SI-nummer.'
      );
    }
  }

  for (const [siNumber, group] of assignmentGroupsBySi) {
    const competitorIds = distinct(group.map((assignment) => assignment.competitorId));
    if (competitorIds.length > 1) {
      addIssue(
        'ERROR',
        'SI_TILLDELAT_FLERA_KONKURRENTER',
        competitorIds,
        siNumber,
        'SI-numret är kopplat till flera löpare.'
      );
    }
  }

  for (const competitor of competitors) {
    const siNumber = competitor.data.siNumber;
    if (!VALID_SI_NUMBER(siNumber)) continue;

    const assignment = assignmentsByDocumentId.get(String(siNumber));
    if (!assignment) {
      addIssue(
        'WARNING',
        'KONKURRENT_UTAN_ASSIGNMENT',
        [competitor.documentId],
        siNumber,
        'Löparen saknar en motsvarande SI-koppling.'
      );
      continue;
    }

    if (assignment.competitorId !== competitor.documentId) {
      addIssue(
        'ERROR',
        'ASSIGNMENT_KONKURRENT_MISMATCH',
        [competitor.documentId, assignment.competitorId],
        siNumber,
        `SI-kopplingen pekar på ${assignment.competitorId ?? 'inget löpar-ID'}.`
      );
    }

    if (assignment.state !== 'ACTIVE') {
      addIssue(
        'ERROR',
        'KONKURRENT_EJ_AKTIV_ASSIGNMENT',
        [competitor.documentId],
        siNumber,
        `Löparen har SI-numret, men kopplingens status är ${assignment.state ?? 'saknas'}.`
      );
    }
  }

  if (issues.length === 0) {
    addIssue(
      'INFO',
      'INGA_KONFLIKTER',
      [],
      null,
      'Inga SI-assignment-konflikter upptäcktes.'
    );
  }

  return {
    competitionId,
    competitionName,
    competitorCount: competitors.length,
    assignmentCount: assignments.length,
    issues,
  };
}

export function formatSIAssignmentInventoryMarkdown(
  report: SIAssignmentInventoryReport
): string {
  const allIssues = report.competitions.flatMap((competition) =>
    competition.issues.map((issue) => ({ ...issue, competition }))
  );
  const count = (severity: SIAssignmentInventorySeverity) =>
    allIssues.filter((issue) => issue.severity === severity).length;
  const lines = [
    '# Inventering av SI-kopplingar',
    '',
    `- Skannad: ${report.generatedAtIso}`,
    `- Tävlingar: ${report.competitionCount}`,
    `- Löpare: ${report.competitorCount}`,
    `- SI-kopplingar: ${report.assignmentCount}`,
    `- FEL: ${count('ERROR')} | VARNING: ${count('WARNING')} | INFORMATION: ${count('INFO')}`,
    '',
    'Inventeringen är skrivskyddad. Inga löpare eller SI-kopplingar har ändrats.',
    '',
  ];

  for (const competition of report.competitions) {
    lines.push(
      `## ${competition.competitionName} (${competition.competitionId})`,
      '',
      `- Löpare: ${competition.competitorCount}`,
      `- SI-kopplingar: ${competition.assignmentCount}`,
      '',
      '| Allvarlighetsgrad | Avvikelse | Löpar-ID | SI-nummer | Beskrivning |',
      '|---|---|---|---:|---|'
    );

    for (const issue of competition.issues) {
      const competitorIds = issue.competitorIds.length
        ? issue.competitorIds.join(', ')
        : '—';
      const detail = issue.detail.replace(/\|/g, '\\|');
      lines.push(
        `| ${getSwedishSeverity(issue.severity)} | ${getConflictLabel(issue.conflictType)} | ${competitorIds} | ${issue.siNumber} | ${detail} |`
      );
    }

    lines.push('');
  }

  return lines.join('\n');
}

function getSwedishSeverity(severity: SIAssignmentInventorySeverity): string {
  switch (severity) {
    case 'ERROR':
      return 'FEL';
    case 'WARNING':
      return 'VARNING';
    case 'INFO':
      return 'INFORMATION';
  }
}
