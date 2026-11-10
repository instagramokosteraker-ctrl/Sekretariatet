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

export type CompetitorMutationIntent =
  | 'CREATE_COMPETITOR'
  | 'UPDATE_COMPETITOR_IDENTITY'
  | 'CHANGE_SI_NUMBER'
  | 'RETIRE_COMPETITOR'
  | 'DELETE_COMPETITOR';

export interface CompetitorAssignmentContext {
  mode: 'ASSIGNMENT_AWARE' | 'LEGACY';
  currentSiNumber?: number;
  requestedSiNumber?: number;
  assignmentId?: string;
  assignmentState?: string;
  validationState: 'NOT_RUN' | 'READ_ONLY' | 'VALIDATED';
}

export interface CompetitorRecordContext {
  competitionId: string;
  competitorId?: string;
  currentSiNumber?: number;
  proposedSiNumber?: number;
}

export interface CompetitorMutationValidationContext {
  intent: CompetitorMutationIntent;
  assignment: CompetitorAssignmentContext;
  competitor: CompetitorRecordContext;
}

export interface CompetitorMutationValidationHook {
  name: string;
  validate(
    context: CompetitorMutationValidationContext
  ): { passed: boolean; detail?: string } | void;
}

export interface CompetitorMutationServiceRequest {
  declaration: CompetitorMutationDeclaration;
  intent: CompetitorMutationIntent;
  assignment: CompetitorAssignmentContext;
  competitor: CompetitorRecordContext;
  validationHooks?: readonly CompetitorMutationValidationHook[];
}

export function runCompetitorMutation<T>(
  declaration: CompetitorMutationDeclaration,
  mutation: () => T
): T {
  return runAssignmentAwareCompetitorMutation(
    legacyServiceRequest(declaration),
    mutation
  );
}

export function runCompetitorMutations<T>(
  declarations: readonly CompetitorMutationDeclaration[],
  mutation: () => T
): T {
  return runAssignmentAwareCompetitorMutations(
    declarations.map(legacyServiceRequest),
    mutation
  );
}

export function runAssignmentAwareCompetitorMutation<T>(
  request: CompetitorMutationServiceRequest,
  mutation: () => T
): T {
  return runAssignmentAwareCompetitorMutations([request], mutation);
}

export function runAssignmentAwareCompetitorMutations<T>(
  requests: readonly CompetitorMutationServiceRequest[],
  mutation: () => T
): T {
  requests.forEach(recordMutationServiceUse);
  return mutation();
}

function legacyServiceRequest(
  declaration: CompetitorMutationDeclaration
): CompetitorMutationServiceRequest {
  const currentSiNumber = declaration.previousSiNumber;
  const proposedSiNumber = declaration.siNumber;
  const hasExistingCompetitor = Number.isFinite(currentSiNumber);
  const intent: CompetitorMutationIntent =
    declaration.operation === 'CREATE' ||
    declaration.operation === 'SNAPSHOT_SEED' ||
    declaration.operation === 'SNAPSHOT_HYDRATE' ||
    ((declaration.operation === 'IMPORT' || declaration.operation === 'RESTORE') &&
      !hasExistingCompetitor)
      ? 'CREATE_COMPETITOR'
      : declaration.operation === 'DELETE'
        ? 'DELETE_COMPETITOR'
        : declaration.identityAffecting &&
            currentSiNumber !== undefined &&
            proposedSiNumber !== undefined &&
            currentSiNumber !== proposedSiNumber
          ? 'CHANGE_SI_NUMBER'
          : 'UPDATE_COMPETITOR_IDENTITY';

  return {
    declaration,
    intent,
    assignment: {
      mode: declaration.assignmentHandling.mode === 'VALIDATED' ? 'ASSIGNMENT_AWARE' : 'LEGACY',
      ...(currentSiNumber !== undefined ? { currentSiNumber } : {}),
      ...(proposedSiNumber !== undefined ? { requestedSiNumber: proposedSiNumber } : {}),
      validationState: declaration.assignmentHandling.mode === 'VALIDATED' ? 'VALIDATED' : 'NOT_RUN',
    },
    competitor: {
      competitionId: declaration.competitionId,
      ...(declaration.competitorId ? { competitorId: declaration.competitorId } : {}),
      ...(currentSiNumber !== undefined ? { currentSiNumber } : {}),
      ...(proposedSiNumber !== undefined ? { proposedSiNumber } : {}),
    },
  };
}

function recordMutationServiceUse(request: CompetitorMutationServiceRequest): void {
  const validationContext: CompetitorMutationValidationContext = {
    intent: request.intent,
    assignment: request.assignment,
    competitor: request.competitor,
  };
  const hookResults = (request.validationHooks ?? []).map((hook) => {
    try {
      const result = hook.validate(validationContext);
      const diagnostic = {
        hook: hook.name,
        passed: result === undefined ? true : result.passed,
        detail: result === undefined ? undefined : result.detail,
        enforcementActive: false,
      };
      if (!diagnostic.passed) {
        console.warn(`[competitor-mutation-validation] ${JSON.stringify(diagnostic)}`);
      }
      return diagnostic;
    } catch (error) {
      const diagnostic = {
        hook: hook.name,
        error: error instanceof Error ? error.message : String(error),
        enforcementActive: false,
      };
      console.error(`[competitor-mutation-validation] ${JSON.stringify(diagnostic)}`);
      return diagnostic;
    }
  });

  console.info(
    `[competitor-mutation-service] ${JSON.stringify({
      intent: request.intent,
      competitionId: request.competitor.competitionId,
      competitorId: request.competitor.competitorId,
      assignmentAwarePathUsed: request.assignment.mode === 'ASSIGNMENT_AWARE',
      assignmentValidated: request.assignment.validationState === 'VALIDATED',
      legacyPathBypassed: request.assignment.mode === 'ASSIGNMENT_AWARE',
      legacyAssignmentPath: request.assignment.mode === 'LEGACY',
      assignment: request.assignment,
      competitor: request.competitor,
      validationHooks: hookResults,
      enforcementActive: false,
    })}`
  );
  declareCompetitorMutation(request.declaration);
}

/**
 * Shared logging point for competitor writes. The pre-enforcement phase records
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
    mutationBoundary: 'CENTRALIZED',
    enforcementReadiness: 'PRE_ENFORCEMENT',
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
