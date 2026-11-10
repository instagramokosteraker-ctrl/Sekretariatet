export interface HydratedCompetitorIdentity {
  id: string;
}

export interface BlockedHydrationIdentityChange {
  competitorId: string;
  operation: 'ADD' | 'REMOVE' | 'UPDATE';
  fields: string[];
}

export interface ProtectedCompetitorHydration<T extends HydratedCompetitorIdentity> {
  competitors: T[];
  blockedChanges: BlockedHydrationIdentityChange[];
}

const protectedCompetitorFields = [
  'id',
  'competitorId',
  'siNumber',
  'cardSeries',
  'status',
  'assignment',
  'assignmentId',
  'assignmentState',
  'assignmentVersion',
  'state',
  'schemaVersion',
  'source',
  'ownerUid',
  'createdAt',
  'updatedAt',
  'retiredAt',
  'retirementReason',
  'conflictReason',
  'lastValidatedAt',
  'competitorDocumentId',
  'previousCompetitorId',
  'siCardAssignment',
  'siCardAssignmentId',
  'siCardAssignments',
] as const;

function isProtectedCompetitorField(field: string): boolean {
  return protectedCompetitorFields.includes(
    field as (typeof protectedCompetitorFields)[number]
  ) || /assignment/i.test(field);
}

function hasSameValue(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  return JSON.stringify(first) === JSON.stringify(second);
}

export function protectCloudHydratedCompetitors<T extends HydratedCompetitorIdentity>(
  existing: readonly T[],
  hydrated: readonly T[]
): ProtectedCompetitorHydration<T> {
  const existingById = new Map(existing.map((competitor) => [competitor.id, competitor]));
  const hydratedById = new Map<string, T>();
  const blockedChanges: BlockedHydrationIdentityChange[] = [];

  for (const competitor of hydrated) {
    if (hydratedById.has(competitor.id)) {
      blockedChanges.push({
        competitorId: competitor.id,
        operation: 'ADD',
        fields: ['duplicateCompetitorId'],
      });
      continue;
    }

    hydratedById.set(competitor.id, competitor);
    const current = existingById.get(competitor.id);
    if (!current) {
      blockedChanges.push({
        competitorId: competitor.id,
        operation: 'ADD',
        fields: ['competitorId', 'siNumber', 'cardSeries', 'assignment'],
      });
      continue;
    }
    const currentFields = current as Record<string, unknown>;
    const hydratedFields = competitor as Record<string, unknown>;

    const changedFields = Array.from(
      new Set([...Object.keys(currentFields), ...Object.keys(hydratedFields)])
    ).filter((field) => {
      if (!isProtectedCompetitorField(field)) return false;
      const currentHasField = Object.prototype.hasOwnProperty.call(currentFields, field);
      const hydratedHasField = Object.prototype.hasOwnProperty.call(hydratedFields, field);
      return (
        currentHasField !== hydratedHasField ||
        (currentHasField && !hasSameValue(currentFields[field], hydratedFields[field]))
      );
    });
    if (changedFields.length > 0) {
      blockedChanges.push({
        competitorId: competitor.id,
        operation: 'UPDATE',
        fields: [...changedFields],
      });
    }
  }

  for (const competitor of existing) {
    if (!hydratedById.has(competitor.id)) {
      blockedChanges.push({
        competitorId: competitor.id,
        operation: 'REMOVE',
        fields: ['competitorId', 'siNumber', 'cardSeries', 'assignment'],
      });
    }
  }

  const competitors = existing.map((current) => {
    const incoming = hydratedById.get(current.id);
    if (!incoming) return current;

    const merged = { ...current, ...incoming } as T;
    const currentFields = current as Record<string, unknown>;
    const mergedFields = merged as Record<string, unknown>;
    const protectedFields = new Set([
      ...protectedCompetitorFields,
      ...Object.keys(currentFields).filter(isProtectedCompetitorField),
      ...Object.keys(incoming).filter(isProtectedCompetitorField),
    ]);
    for (const field of protectedFields) {
      if (Object.prototype.hasOwnProperty.call(currentFields, field)) {
        mergedFields[field] = currentFields[field];
      } else {
        delete mergedFields[field];
      }
    }
    return merged;
  });

  return { competitors, blockedChanges };
}
