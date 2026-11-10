export interface CompetitorIdentitySnapshot {
  competitionId: string;
  competitorId: string;
  siNumber: number | null;
  status?: string;
}

export interface SIAssignmentRuleSnapshot {
  competitionId: string;
  siNumber: number;
  competitorId: string | null;
  state: string;
}

export type SIAssignmentRuleMutation =
  | {
      collection: 'competitors';
      operation: 'create' | 'update' | 'delete';
      before?: CompetitorIdentitySnapshot | null;
      after?: CompetitorIdentitySnapshot | null;
    }
  | {
      collection: 'siCardAssignments';
      operation: 'create' | 'update' | 'delete';
      before?: SIAssignmentRuleSnapshot | null;
      after?: SIAssignmentRuleSnapshot | null;
    };

export type SIAssignmentRuleDiagnosticCode =
  | 'COMPETITOR_SI_UPDATE_WITHOUT_ASSIGNMENT_CHANGE'
  | 'ASSIGNMENT_UPDATE_WITHOUT_COMPETITOR_CHANGE'
  | 'ASSIGNMENT_DELETE_WITHOUT_RETIREMENT_FLOW';

export interface SIAssignmentRuleDiagnostic {
  code: SIAssignmentRuleDiagnosticCode;
  collection: 'competitors' | 'siCardAssignments';
  documentId: string;
  detail: string;
  enforcementActive: false;
}

export function inspectSIAssignmentRuleMutations(
  mutations: readonly SIAssignmentRuleMutation[]
): SIAssignmentRuleDiagnostic[] {
  const diagnostics: SIAssignmentRuleDiagnostic[] = [];
  const competitorMutations = mutations.filter(
    (mutation): mutation is Extract<SIAssignmentRuleMutation, { collection: 'competitors' }> =>
      mutation.collection === 'competitors'
  );
  const assignmentMutations = mutations.filter(
    (mutation): mutation is Extract<SIAssignmentRuleMutation, { collection: 'siCardAssignments' }> =>
      mutation.collection === 'siCardAssignments'
  );

  for (const mutation of competitorMutations) {
    const before = mutation.before ?? null;
    const after = mutation.after ?? null;
    if (
      mutation.operation !== 'update' ||
      !before ||
      !after ||
      before.siNumber === after.siNumber
    ) {
      continue;
    }

    const hasOldRetirement = assignmentMutations.some((assignmentMutation) => {
      const old = assignmentMutation.before ?? null;
      const next = assignmentMutation.after ?? null;
      return (
        old?.competitionId === before.competitionId &&
        old.siNumber === before.siNumber &&
        old.competitorId === before.competitorId &&
        old.state === 'ACTIVE' &&
        next?.state === 'RETIRED'
      );
    });
    const hasTargetActivation =
      after.siNumber === null ||
      assignmentMutations.some((assignmentMutation) => {
        const next = assignmentMutation.after ?? null;
        return (
          next?.competitionId === after.competitionId &&
          next.siNumber === after.siNumber &&
          next.competitorId === after.competitorId &&
          next.state === 'ACTIVE'
        );
      });

    if (!hasOldRetirement || !hasTargetActivation) {
      diagnostics.push({
        code: 'COMPETITOR_SI_UPDATE_WITHOUT_ASSIGNMENT_CHANGE',
        collection: 'competitors',
        documentId: before.competitorId,
        detail:
          'SI number changed without both retiring the prior assignment and activating the requested assignment.',
        enforcementActive: false,
      });
    }
  }

  for (const mutation of assignmentMutations) {
    const before = mutation.before ?? null;
    const after = mutation.after ?? null;
    const assignment = after ?? before;
    if (!assignment) continue;

    if (mutation.operation === 'delete') {
      diagnostics.push({
        code: 'ASSIGNMENT_DELETE_WITHOUT_RETIREMENT_FLOW',
        collection: 'siCardAssignments',
        documentId: String(assignment.siNumber),
        detail: 'Assignment documents must be retired; hard deletion is not an approved retirement flow.',
        enforcementActive: false,
      });
      continue;
    }

    const hasCompetitorCounterpart = competitorMutations.some((competitorMutation) => {
      const competitorBefore = competitorMutation.before ?? null;
      const competitorAfter = competitorMutation.after ?? null;
      if (competitorMutation.operation === 'delete') {
        return (
          competitorBefore?.competitionId === assignment.competitionId &&
          competitorBefore.siNumber === assignment.siNumber &&
          competitorBefore.competitorId === assignment.competitorId
        );
      }
      if (!competitorBefore && competitorAfter) {
        return (
          competitorAfter.competitionId === assignment.competitionId &&
          competitorAfter.siNumber === assignment.siNumber &&
          competitorAfter.competitorId === assignment.competitorId
        );
      }
      if (!competitorBefore || !competitorAfter) return false;
      if (after?.state === 'RETIRED') {
        return (
          competitorBefore.competitionId === assignment.competitionId &&
          competitorBefore.competitorId === assignment.competitorId &&
          (competitorAfter.siNumber !== assignment.siNumber ||
            competitorAfter.status === 'DNS' ||
            competitorAfter.status === 'DNF')
        );
      }
      return (
        competitorAfter.competitionId === assignment.competitionId &&
        competitorAfter.siNumber === assignment.siNumber &&
        competitorAfter.competitorId === assignment.competitorId
      );
    });

    if (!hasCompetitorCounterpart) {
      diagnostics.push({
        code: 'ASSIGNMENT_UPDATE_WITHOUT_COMPETITOR_CHANGE',
        collection: 'siCardAssignments',
        documentId: String(assignment.siNumber),
        detail: 'Assignment create/update has no matching competitor identity or retirement mutation.',
        enforcementActive: false,
      });
    }
  }

  return diagnostics;
}

export function logSIAssignmentRuleDiagnostics(
  diagnostics: readonly SIAssignmentRuleDiagnostic[]
): void {
  for (const diagnostic of diagnostics) {
    console.warn(`[si-assignment-rule-diagnostic] ${JSON.stringify(diagnostic)}`);
  }
}
