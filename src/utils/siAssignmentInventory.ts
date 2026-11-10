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
  assignmentDocumentIds: string[];
  siNumber: string;
  detail: string;
}

export interface SIAssignmentInventoryCompetition {
  competitionId: string;
  competitionName: string;
  competitorCount: number;
  assignmentCount: number;
  activeAssignmentCount: number;
  retiredAssignmentCount: number;
  historicalReassignmentCount: number;
  orphanAssignmentCount: number;
  orphanCompetitorCount: number;
  parityMismatchCount: number;
  issues: SIAssignmentInventoryIssue[];
}

export interface SIAssignmentInventoryReport {
  generatedAtIso: string;
  competitionCount: number;
  competitorCount: number;
  assignmentCount: number;
  activeAssignmentCount: number;
  retiredAssignmentCount: number;
  historicalReassignmentCount: number;
  orphanAssignmentCount: number;
  orphanCompetitorCount: number;
  parityMismatchCount: number;
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
  competitorDocumentId: string | null;
  state: string | null;
}

const VALID_SI_NUMBER = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 99999999;

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
  COMPETITOR_DOCUMENT_ID_MISMATCH: 'Löpar-ID i dokumentet avviker från dokumentets ID',
  COMPETITOR_ID_MISMATCH: 'Assignmentens competitorId avviker',
  COMPETITOR_PATH_ID_MISMATCH: 'Löparens ID avviker från dokumentets ID',
  ASSIGNMENT_OWNER_UID_MISMATCH: 'ownerUid skiljer sig mellan löpare och SI-koppling',
  ASSIGNMENT_CARD_SERIES_MISMATCH: 'cardSeries skiljer sig mellan löpare och SI-koppling',
  ASSIGNMENT_SI_NUMBER_MISMATCH: 'siNumber skiljer sig mellan löpare och SI-koppling',
  ASSIGNMENT_COMPETITION_ID_MISMATCH: 'competitionId skiljer sig från tävlingens ID',
  HISTORICAL_REASSIGNMENT: 'Historisk SI-återtilldelning',
  ORPHANED_RETIRED_ASSIGNMENT: 'Avslutad SI-koppling utan aktiv efterföljare',
  UNKNOWN_ASSIGNMENT_STATE: 'Okänt lifecycle-tillstånd för SI-koppling',
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
  const activeByCompetitor = new Map<string, AssignmentRecord[]>();
  const orphanAssignmentDocumentIds = new Set<string>();
  const orphanCompetitorIds = new Set<string>();
  let parityMismatchCount = 0;
  let historicalReassignmentCount = 0;
  let activeAssignmentCount = 0;
  let retiredAssignmentCount = 0;

  const addIssue = (
    severity: SIAssignmentInventorySeverity,
    conflictType: string,
    competitorIds: Array<string | null>,
    siNumber: unknown,
    detail: string,
    assignmentDocumentIds: string[] = [],
    isParityMismatch = false
  ) => {
    if (isParityMismatch) parityMismatchCount += 1;
    issues.push({
      severity,
      conflictType,
      competitorIds: distinct(competitorIds),
      assignmentDocumentIds,
      siNumber: displaySiNumber(siNumber),
      detail,
    });
  };

  for (const competitor of competitors) {
    const storedCompetitorId =
      typeof competitor.data.competitorId === 'string'
        ? competitor.data.competitorId
        : competitor.data.id;
    if (storedCompetitorId !== competitor.documentId) {
      addIssue(
        'ERROR',
        'COMPETITOR_PATH_ID_MISMATCH',
        [competitor.documentId],
        competitor.data.siNumber,
        `Löparens inbäddade competitorId är ${displaySiNumber(storedCompetitorId)}, men dokument-ID är ${competitor.documentId}.`,
        [],
        true
      );
    }

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
    competitorDocumentId:
      typeof record.data.competitorDocumentId === 'string'
        ? record.data.competitorDocumentId
        : null,
    state: typeof record.data.state === 'string' ? record.data.state : null,
  }));

  for (const assignment of parsedAssignments) {
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
        `SI-kopplingsdokumentet ${assignment.documentId} avviker från det definierade schemat.`,
        [assignment.documentId]
      );
    }

    if (!assignment.siNumber) {
      addIssue(
        'ERROR',
        'OGILTIGT_ASSIGNMENT_SI_NUMMER',
        [assignment.competitorId],
        assignment.data.siNumber,
        `SI-kopplingsdokumentet ${assignment.documentId} innehåller ett ogiltigt SI-nummer.`,
        [assignment.documentId]
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
          `Dokument-ID ${assignment.documentId} stämmer inte med SI-numret.`,
          [assignment.documentId],
          true
        );
      }
    }

    if (assignment.state === 'ACTIVE') activeAssignmentCount += 1;
    if (assignment.state === 'RETIRED') retiredAssignmentCount += 1;

    if (assignment.data.competitorId !== assignment.data.competitorDocumentId) {
      addIssue(
        'ERROR',
        'COMPETITOR_DOCUMENT_ID_MISMATCH',
        [assignment.competitorId, assignment.competitorDocumentId],
        assignment.siNumber ?? assignment.data.siNumber,
        `competitorId (${displaySiNumber(assignment.data.competitorId)}) och competitorDocumentId (${displaySiNumber(assignment.data.competitorDocumentId)}) skiljer sig.`,
        [assignment.documentId],
        true
      );
    }

    const linkedCompetitorId =
      assignment.competitorId ?? assignment.competitorDocumentId;
    const linkedCompetitor = linkedCompetitorId
      ? competitorsById.get(linkedCompetitorId)
      : undefined;

    if (!linkedCompetitor || !assignment.competitorId || !assignment.competitorDocumentId) {
      orphanAssignmentDocumentIds.add(assignment.documentId);
      addIssue(
        'ERROR',
        'ASSIGNMENT_UTAN_KONKURRENT',
        [assignment.competitorId, assignment.competitorDocumentId],
        assignment.siNumber ?? assignment.data.siNumber,
        `SI-kopplingsdokumentet ${assignment.documentId} saknar en giltig länk till en löpardokument-ID.`,
        [assignment.documentId]
      );
    }

    if (assignment.state !== 'ACTIVE' && assignment.state !== 'RETIRED' &&
        assignment.state !== 'DUPLICATE_CONFIRMED' && assignment.state !== 'UNKNOWN') {
      addIssue(
        'ERROR',
        'UNKNOWN_ASSIGNMENT_STATE',
        [assignment.competitorId],
        assignment.siNumber ?? assignment.data.siNumber,
        `SI-kopplingsdokumentet ${assignment.documentId} har okänt tillstånd ${displaySiNumber(assignment.state)}.`,
        [assignment.documentId]
      );
    }
    if (assignment.state === 'UNKNOWN') {
      addIssue(
        'WARNING',
        'UNKNOWN_ASSIGNMENT_STATE',
        [assignment.competitorId],
        assignment.siNumber ?? assignment.data.siNumber,
        `SI-kopplingsdokumentet ${assignment.documentId} har lifecycle-tillståndet UNKNOWN.`,
        [assignment.documentId]
      );
    }

    if (
      assignment.state === 'ACTIVE' &&
      linkedCompetitor &&
      assignment.competitorId &&
      assignment.competitorId === assignment.competitorDocumentId
    ) {
      const activeAssignments = activeByCompetitor.get(assignment.competitorId) ?? [];
      activeAssignments.push(assignment);
      activeByCompetitor.set(assignment.competitorId, activeAssignments);
    }

    if (assignment.state === 'DUPLICATE_CONFIRMED') {
      addIssue(
        'WARNING',
        'BEKRAFTAD_SI_DUBBLETT',
        [assignment.competitorId],
        assignment.siNumber ?? assignment.data.siNumber,
        `SI-kopplingen ${assignment.documentId} är markerad som bekräftad dubblett.`,
        [assignment.documentId]
      );
    }

    if (assignment.state === 'RETIRED') {
      const successor = assignment.competitorId &&
        assignment.competitorId === assignment.competitorDocumentId
        ? parsedAssignments.find((candidate) =>
            candidate.state === 'ACTIVE' &&
            candidate.competitorId === assignment.competitorId &&
            candidate.competitorDocumentId === assignment.competitorId &&
            candidate.documentId !== assignment.documentId
          )
        : undefined;
      if (successor) {
        historicalReassignmentCount += 1;
        addIssue(
          'INFO',
          'HISTORICAL_REASSIGNMENT',
          [assignment.competitorId],
          assignment.siNumber ?? assignment.data.siNumber,
          `RETIRED SI ${assignment.siNumber ?? '—'} har aktiv efterföljare SI ${successor.siNumber ?? '—'} för samma löpare.`,
          [assignment.documentId, successor.documentId]
        );
      } else {
        orphanAssignmentDocumentIds.add(assignment.documentId);
        addIssue(
          'ERROR',
          'ORPHANED_RETIRED_ASSIGNMENT',
          [assignment.competitorId],
          assignment.siNumber ?? assignment.data.siNumber,
          `RETIRED SI-kopplingen ${assignment.documentId} saknar ACTIVE efterföljare för samma löpare.`,
          [assignment.documentId]
        );
      }
    }

    if (linkedCompetitor && assignment.data.ownerUid !== linkedCompetitor.data.ownerUid) {
      addIssue(
        'ERROR',
        'ASSIGNMENT_OWNER_UID_MISMATCH',
        [linkedCompetitor.documentId],
        assignment.siNumber ?? assignment.data.siNumber,
        'ownerUid-värdet skiljer sig mellan SI-kopplingen och löparen.',
        [assignment.documentId],
        true
      );
    }

    if (assignment.state === 'ACTIVE' && linkedCompetitor) {
      const assignmentCompetitorId = assignment.competitorId;
      if (assignment.competitorDocumentId !== linkedCompetitor.documentId) {
        addIssue(
          'ERROR',
          'COMPETITOR_DOCUMENT_ID_MISMATCH',
          [linkedCompetitor.documentId, assignment.competitorDocumentId],
          assignment.siNumber ?? assignment.data.siNumber,
          `competitorDocumentId avviker från löpardokumentet ${linkedCompetitor.documentId}.`,
          [assignment.documentId],
          true
        );
      }
      if (assignmentCompetitorId !== linkedCompetitor.documentId) {
        addIssue(
          'ERROR',
          'COMPETITOR_ID_MISMATCH',
          [linkedCompetitor.documentId, assignmentCompetitorId],
          assignment.siNumber ?? assignment.data.siNumber,
          `competitorId avviker från löpardokumentet ${linkedCompetitor.documentId}.`,
          [assignment.documentId],
          true
        );
      }
      if (assignment.siNumber !== null && linkedCompetitor.data.siNumber !== assignment.siNumber) {
        addIssue(
          'ERROR',
          'ASSIGNMENT_SI_NUMBER_MISMATCH',
          [linkedCompetitor.documentId],
          assignment.siNumber,
          `SI-kopplingen anger ${assignment.siNumber}, men löparen anger ${displaySiNumber(linkedCompetitor.data.siNumber)}.`,
          [assignment.documentId],
          true
        );
      }
      if (assignment.data.cardSeries !== linkedCompetitor.data.cardSeries) {
        addIssue(
          'ERROR',
          'ASSIGNMENT_CARD_SERIES_MISMATCH',
          [linkedCompetitor.documentId],
          assignment.siNumber ?? assignment.data.siNumber,
          `cardSeries skiljer sig mellan SI-kopplingen (${displaySiNumber(assignment.data.cardSeries)}) och löparen (${displaySiNumber(linkedCompetitor.data.cardSeries)}).`,
          [assignment.documentId],
          true
        );
      }
    }

    if (assignment.data.competitionId !== competitionId) {
      addIssue(
        'ERROR',
        'ASSIGNMENT_COMPETITION_ID_MISMATCH',
        [assignment.competitorId],
        assignment.siNumber,
        `SI-kopplingsdokumentet ${assignment.documentId} har competitionId ${displaySiNumber(assignment.data.competitionId)} i stället för ${competitionId}.`,
        [assignment.documentId],
        true
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
    const activeGroup = group.filter((assignment) => assignment.state === 'ACTIVE');
    const competitorIds = distinct(activeGroup.map((assignment) => assignment.competitorId));
    if (activeGroup.length > 1 && competitorIds.length > 1) {
      addIssue(
        'ERROR',
        'SI_TILLDELAT_FLERA_KONKURRENTER',
        competitorIds,
        siNumber,
        'Samma SI-nummer har aktiva kopplingar till flera löpare.',
        activeGroup.map((assignment) => assignment.documentId)
      );
    }
  }

  for (const competitor of competitors) {
    const activeAssignments = activeByCompetitor.get(competitor.documentId) ?? [];
    if (activeAssignments.length === 0) {
      orphanCompetitorIds.add(competitor.documentId);
      addIssue(
        'WARNING',
        'KONKURRENT_UTAN_ASSIGNMENT',
        [competitor.documentId],
        competitor.data.siNumber,
        'Löparen saknar en aktiv SI-koppling.'
      );
    } else if (activeAssignments.length > 1) {
      addIssue(
        'ERROR',
        'DUBBEL_AKTIV_ASSIGNMENT',
        [competitor.documentId],
        competitor.data.siNumber,
        'Löparen har flera aktiva SI-kopplingar.',
        activeAssignments.map((assignment) => assignment.documentId)
      );
    }
  }

  for (const assignment of parsedAssignments) {
    if (
      assignment.competitorId !== assignment.competitorDocumentId ||
      !competitorsById.has(assignment.competitorId ?? '')
    ) {
      orphanAssignmentDocumentIds.add(assignment.documentId);
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
    activeAssignmentCount,
    retiredAssignmentCount,
    historicalReassignmentCount,
    orphanAssignmentCount: orphanAssignmentDocumentIds.size,
    orphanCompetitorCount: orphanCompetitorIds.size,
    parityMismatchCount,
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
    `- Aktiva SI-kopplingar: ${report.activeAssignmentCount}`,
    `- Avslutade SI-kopplingar: ${report.retiredAssignmentCount}`,
    `- Historiska återtilldelningar: ${report.historicalReassignmentCount}`,
    `- Orphan-kopplingar: ${report.orphanAssignmentCount}`,
    `- Orphan-löpare: ${report.orphanCompetitorCount}`,
    `- Paritetsavvikelser: ${report.parityMismatchCount}`,
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
      `- Aktiva kopplingar: ${competition.activeAssignmentCount}`,
      `- Avslutade kopplingar: ${competition.retiredAssignmentCount}`,
      `- Historiska återtilldelningar: ${competition.historicalReassignmentCount}`,
      `- Orphan-kopplingar: ${competition.orphanAssignmentCount}`,
      `- Orphan-löpare: ${competition.orphanCompetitorCount}`,
      `- Paritetsavvikelser: ${competition.parityMismatchCount}`,
      '',
      '| Allvarlighetsgrad | Avvikelse | Löpar-ID | Assignment-dokument | SI-nummer | Beskrivning |',
      '|---|---|---|---|---:|---|'
    );

    for (const issue of competition.issues) {
      const competitorIds = issue.competitorIds.length
        ? issue.competitorIds.join(', ')
        : '—';
      const detail = issue.detail.replace(/\|/g, '\\|');
      lines.push(
        `| ${getSwedishSeverity(issue.severity)} | ${getConflictLabel(issue.conflictType)} | ${competitorIds} | ${issue.assignmentDocumentIds.join(', ') || '—'} | ${issue.siNumber} | ${detail} |`
      );
    }

    lines.push('');
  }

  return lines.join('\n');
}

export function formatLiveIntegrityInventoryV2Markdown(
  report: SIAssignmentInventoryReport
): string {
  const allIssues = report.competitions.flatMap((competition) =>
    competition.issues.map((issue) => ({ ...issue, competition }))
  );
  const count = (severity: SIAssignmentInventorySeverity) =>
    allIssues.filter((issue) => issue.severity === severity).length;
  const lines = [
    '# Live Integrity Inventory V2',
    '',
    `- Scanned: ${report.generatedAtIso}`,
    `- Competitions: ${report.competitionCount}`,
    `- Competitors: ${report.competitorCount}`,
    `- Assignments: ${report.assignmentCount}`,
    `- Active assignments: ${report.activeAssignmentCount}`,
    `- Retired assignments: ${report.retiredAssignmentCount}`,
    `- Historical reassignments: ${report.historicalReassignmentCount}`,
    `- Orphan assignments: ${report.orphanAssignmentCount}`,
    `- Orphan competitors: ${report.orphanCompetitorCount}`,
    `- Parity mismatches: ${report.parityMismatchCount}`,
    `- ERROR: ${count('ERROR')} | WARNING: ${count('WARNING')} | INFO: ${count('INFO')}`,
    '',
    'Read-only audit. No Firestore data was modified.',
    'Retired assignments are classified as historical reassignments only when an ACTIVE assignment with matching competitorId and competitorDocumentId exists for the same competitor.',
    'Card-series parity is compared for ACTIVE assignments because a retired assignment may retain the prior card series after reassignment. Owner UID and identity-document parity are checked for linked assignments.',
    '',
    '| Competition | Competition ID | Competitors | Active | Retired | Historical reassignments | Orphan assignments | Orphan competitors | Parity mismatches |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ];

  for (const competition of report.competitions) {
    lines.push(
      `| ${competition.competitionName} | ${competition.competitionId} | ${competition.competitorCount} | ${competition.activeAssignmentCount} | ${competition.retiredAssignmentCount} | ${competition.historicalReassignmentCount} | ${competition.orphanAssignmentCount} | ${competition.orphanCompetitorCount} | ${competition.parityMismatchCount} |`
    );
  }

  lines.push('', '## Findings', '');
  if (allIssues.length === 0) {
    lines.push('No findings.');
  } else {
    lines.push(
      '| Severity | Competition | Finding | Competitor document IDs | Assignment document IDs | SI | Detail |',
      '|---|---|---|---|---|---:|---|'
    );
    for (const issue of allIssues) {
      const competitors = issue.competitorIds.join(', ') || '—';
      const assignmentIds = issue.assignmentDocumentIds.join(', ') || '—';
      const detail = issue.detail.replace(/\|/g, '\\|');
      lines.push(
        `| ${issue.severity} | ${issue.competition.competitionName} (${issue.competition.competitionId}) | ${getConflictLabel(issue.conflictType)} | ${competitors} | ${assignmentIds} | ${issue.siNumber} | ${detail} |`
      );
    }
  }

  return lines.join('\n');
}

export function formatConflictRemediationPlanV2Markdown(
  report: SIAssignmentInventoryReport
): string {
  const findings = report.competitions.flatMap((competition) =>
    competition.issues
      .filter((issue) => issue.severity !== 'INFO')
      .map((issue) => ({ ...issue, competition }))
  );
  const lines = [
    '# Conflict Remediation Plan V2',
    '',
    `- Based on inventory scanned: ${report.generatedAtIso}`,
    `- Competitions: ${report.competitionCount}`,
    `- Read-only inventory findings requiring review: ${findings.length}`,
    '',
    'No production data was modified. Do not repair records from this report alone; confirm authoritative identity and lifecycle history first.',
    '',
    '## Priority guidance',
    '',
    '- **P0:** active ownership or identity parity mismatch, duplicate active SI ownership, active assignment orphan, or competitor with no active assignment.',
    '- **P1:** retired assignment without an active successor, malformed historical assignment, or other lifecycle cleanup requiring owner review.',
    '- **Informational:** retired assignment with a matching active successor for the same competitor; retain it as historical reassignment unless authoritative history indicates otherwise.',
    '',
    '## Competition totals',
    '',
    '| Competition | ID | Competitors | Active | Retired | Historical reassignments | Orphan assignments | Orphan competitors | Parity mismatches |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ];

  for (const competition of report.competitions) {
    lines.push(
      `| ${competition.competitionName} | ${competition.competitionId} | ${competition.competitorCount} | ${competition.activeAssignmentCount} | ${competition.retiredAssignmentCount} | ${competition.historicalReassignmentCount} | ${competition.orphanAssignmentCount} | ${competition.orphanCompetitorCount} | ${competition.parityMismatchCount} |`
    );
  }

  lines.push('', '## Required review', '');
  if (findings.length === 0) {
    lines.push('No non-informational findings were reported by this audit.');
  } else {
    findings.forEach((finding, index) => {
      const priority =
        finding.conflictType === 'ORPHANED_RETIRED_ASSIGNMENT' ||
        finding.conflictType === 'FELAKTIGT_ASSIGNMENT_DOKUMENT' ||
        finding.conflictType === 'BEKRAFTAD_SI_DUBBLETT'
          ? 'P1'
          : 'P0';
      lines.push(
        `${index + 1}. **${priority} — ${finding.competition.competitionName} (${finding.competition.competitionId}): ${getConflictLabel(finding.conflictType)}**`,
        `   - Competitor document ID(s): ${finding.competitorIds.join(', ') || '—'}`,
        `   - Assignment document ID(s): ${finding.assignmentDocumentIds.join(', ') || '—'}`,
        `   - SI: ${finding.siNumber}`,
        `   - Finding: ${finding.detail}`,
        '   - Next step: inspect trusted event and lifecycle history read-only; determine the authoritative state with the competition owner. If correction is approved, use only the canonical transaction-boundary mutation and rerun this inventory.',
        ''
      );
    });
  }

  lines.push(
    '## Safety rule',
    '',
    'Do not delete or rewrite assignment or competitor documents merely to make totals agree. Historical SI reassignments are expected to retain retired assignment records when the same competitor has a successor ACTIVE assignment.'
  );
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
