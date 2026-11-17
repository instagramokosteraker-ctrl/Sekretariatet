import type { CompClass } from '../types/sportident';

export function getDrawEligibleClasses(
  classes: readonly CompClass[]
): CompClass[] {
  return classes.filter((cls) => !cls.freeStart);
}

export function reconcileDrawClassId(
  currentClassId: string,
  classes: readonly Pick<CompClass, 'id'>[]
): string {
  if (classes.some((cls) => cls.id === currentClassId)) return currentClassId;
  return classes[0]?.id ?? '';
}
