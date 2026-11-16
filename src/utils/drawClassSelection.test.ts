import { describe, expect, it } from 'vitest';
import { reconcileDrawClassId } from './drawClassSelection';

describe('reconcileDrawClassId', () => {
  it('resets the selection when competitions change while the Draw tab remains open', () => {
    expect(
      reconcileDrawClassId('event-a-class', [{ id: 'event-b-class' }])
    ).toBe('event-b-class');
  });

  it('does not preserve a stale class ID when the new competition has no classes', () => {
    expect(reconcileDrawClassId('stale-class', [])).toBe('');
  });

  it('preserves a still-valid class selection when the class list changes', () => {
    expect(
      reconcileDrawClassId('class-b', [{ id: 'class-a' }, { id: 'class-b' }])
    ).toBe('class-b');
  });
});
