export function getChangedSnapshotFields(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): string[] {
  return Object.entries(incoming)
    .filter(([field, value]) => !areEqual(existing[field], value))
    .map(([field]) => field);
}

function areEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => areEqual(value, right[index]));
}
