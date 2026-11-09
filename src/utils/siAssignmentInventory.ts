import { parseSICardAssignmentDocument } from './siCardAssignments';

export type SIAssignmentInventorySeverity = 'INFO' | 'WARNING' | 'ERROR';

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

function displaySiNumber(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

function distinct(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
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
        'Konkurrenten saknar SI-nummer.'
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
        `Assignment-dokumentet ${assignment.documentId} avviker från det definierade schemat.`
      );
    }

    if (!assignment.siNumber) {
      addIssue(
        'ERROR',
        'OGILTIGT_ASSIGNMENT_SI_NUMMER',
        [assignment.competitorId],
        assignment.data.siNumber,
        `Assignment-dokumentet ${assignment.documentId} innehåller ett ogiltigt SI-nummer.`
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
          `Dokument-ID ${assignment.documentId} matchar inte SI-numret.`
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
        `Assignment-dokumentet ${assignment.documentId} refererar till en konkurrent som saknas.`
      );
    }

    if (assignment.state === 'ACTIVE' && !assignment.competitorId) {
      addIssue(
        'ERROR',
        'AKTIV_ASSIGNMENT_UTAN_KONKURRENT',
        [],
        assignment.siNumber ?? assignment.data.siNumber,
        `Aktivt assignment-dokument ${assignment.documentId} saknar konkurrent-ID.`
      );
    }

    if (assignment.state === 'DUPLICATE_CONFIRMED') {
      addIssue(
        'WARNING',
        'BEKRAFTAD_SI_DUBBLETT',
        [assignment.competitorId],
        assignment.siNumber ?? assignment.data.siNumber,
        `Assignment-dokumentet ${assignment.documentId} är markerat DUPLICATE_CONFIRMED.`
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
          `Assignment-dokumentet ${assignment.documentId} är pensionerat men konkurrenten har status ${status}.`
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
        `Assignment-dokumentet pekar på SI ${assignment.siNumber}, men konkurrentdokumentet innehåller ${displaySiNumber(linkedCompetitor.data.siNumber)}.`
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
        `Assignment-dokumentet ${assignment.documentId} innehåller ett annat tävlings-ID.`
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
        'Flera konkurrenter i samma tävling har samma SI-nummer.'
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
        'SI-numret är kopplat till flera konkurrenter i assignment-dokumenten.'
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
        'Konkurrenten saknar motsvarande SI-assignment-dokument.'
      );
      continue;
    }

    if (assignment.competitorId !== competitor.documentId) {
      addIssue(
        'ERROR',
        'ASSIGNMENT_KONKURRENT_MISMATCH',
        [competitor.documentId, assignment.competitorId],
        siNumber,
        `SI-assignment-dokumentet pekar på ${assignment.competitorId ?? 'inget konkurrent-ID'}.`
      );
    }

    if (assignment.state !== 'ACTIVE') {
      addIssue(
        'ERROR',
        'KONKURRENT_EJ_AKTIV_ASSIGNMENT',
        [competitor.documentId],
        siNumber,
        `Konkurrenten har SI-numret men assignment-dokumentets state är ${assignment.state ?? 'saknat'}.`
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
    '# SI Assignment Inventory',
    '',
    `- Skannad: ${report.generatedAtIso}`,
    `- Tävlingar: ${report.competitionCount}`,
    `- Konkurrenter: ${report.competitorCount}`,
    `- SI-assignment-dokument: ${report.assignmentCount}`,
    `- ERROR: ${count('ERROR')} | WARNING: ${count('WARNING')} | INFO: ${count('INFO')}`,
    '',
    'Inventeringen är skrivskyddad. Inga konkurrenter eller assignment-dokument har ändrats.',
    '',
  ];

  for (const competition of report.competitions) {
    lines.push(
      `## ${competition.competitionName} (${competition.competitionId})`,
      '',
      `- Konkurrenter: ${competition.competitorCount}`,
      `- SI-assignment-dokument: ${competition.assignmentCount}`,
      '',
      '| Severity | Konflikttyp | Konkurrent-ID:n | SI-nummer | Detalj |',
      '|---|---|---|---:|---|'
    );

    for (const issue of competition.issues) {
      const competitorIds = issue.competitorIds.length
        ? issue.competitorIds.join(', ')
        : '—';
      const detail = issue.detail.replace(/\|/g, '\\|');
      lines.push(
        `| ${issue.severity} | ${issue.conflictType} | ${competitorIds} | ${issue.siNumber} | ${detail} |`
      );
    }

    lines.push('');
  }

  return lines.join('\n');
}
