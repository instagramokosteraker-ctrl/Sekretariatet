export type CompetitorMutationOperation =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'IMPORT'
  | 'RESTORE'
  | 'SNAPSHOT_EXPORT'
  | 'SNAPSHOT_HYDRATE'
  | 'SNAPSHOT_SEED';

export type AssignmentHandlingDeclaration =
  | {
      mode: 'VALIDATED';
      validatedSiNumber: number;
      assignmentVersion: number;
    }
  | {
      mode: 'LEGACY';
      reason: string;
    };

export interface CompetitorMutationDeclaration {
  source: string;
  operation: CompetitorMutationOperation;
  competitionId: string;
  competitorId?: string;
  siNumber?: number;
  previousSiNumber?: number;
  assignmentHandling: AssignmentHandlingDeclaration;
  identityAffecting: boolean;
}

/**
 * Central declaration point for competitor writes. The legacy phase records
 * missing SI-assignment validation but deliberately never blocks the mutation.
 */
export function declareCompetitorMutation(
  declaration: CompetitorMutationDeclaration
): { allowed: true } {
  if (
    declaration.assignmentHandling.mode === 'VALIDATED' &&
    (!Number.isInteger(declaration.assignmentHandling.validatedSiNumber) ||
      declaration.assignmentHandling.validatedSiNumber !== declaration.siNumber ||
      !Number.isInteger(declaration.assignmentHandling.assignmentVersion) ||
      declaration.assignmentHandling.assignmentVersion < 1)
  ) {
    console.error(
      `[competitor-mutation] Invalid SI-assignment validation declaration: ${JSON.stringify(declaration)}`
    );
  }

  const diagnostic = {
    ...declaration,
    enforcementActive: false,
  };
  console.info(`[competitor-mutation] ${JSON.stringify(diagnostic)}`);

  if (declaration.assignmentHandling.mode === 'LEGACY' && declaration.identityAffecting) {
    console.warn(
      `[si-assignment-bypass] ${JSON.stringify({
        ...diagnostic,
        assignmentValidation: false,
        legacyReason: declaration.assignmentHandling.reason,
      })}`
    );
  }

  return { allowed: true };
}
