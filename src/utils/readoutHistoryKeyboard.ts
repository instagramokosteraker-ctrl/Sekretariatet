export function getReadoutHistoryNavigationIndex(
  key: string,
  activeIndex: number,
  itemCount: number
): number | null {
  if (itemCount <= 0) return null;

  if (key === 'ArrowDown') {
    if (activeIndex < 0) return 0;
    return activeIndex < itemCount - 1 ? activeIndex + 1 : null;
  }

  if (key === 'ArrowUp') {
    if (activeIndex < 0) return itemCount - 1;
    return activeIndex > 0 ? activeIndex - 1 : null;
  }

  return null;
}
