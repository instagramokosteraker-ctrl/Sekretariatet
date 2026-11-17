import { describe, expect, it } from 'vitest';
import {
  getDrawEligibleClasses,
  reconcileDrawClassId,
} from './drawClassSelection';

const drawClass = (id: string, freeStart: boolean) => ({
  id,
  name: id,
  courseId: null,
  allowDirectEntry: true,
  autoMatchCourse: false,
  freeStart,
});

describe('getDrawEligibleClasses', () => {
  it('keeps all classes when the competition has only draw classes', () => {
    expect(
      getDrawEligibleClasses([
        drawClass('Vit', false),
        drawClass('Gul', false),
      ]).map((cls) => cls.name)
    ).toEqual(['Vit', 'Gul']);
  });

  it('returns no classes when the competition has only free-start classes', () => {
    expect(
      getDrawEligibleClasses([
        drawClass('Motion Vit', true),
        drawClass('Motion Gul', true),
      ])
    ).toEqual([]);
  });

  it('excludes only free-start classes in a mixed competition', () => {
    expect(
      getDrawEligibleClasses([
        drawClass('Vit', false),
        drawClass('Fri start', true),
        drawClass('Orange', false),
      ]).map((cls) => cls.name)
    ).toEqual(['Vit', 'Orange']);
  });
});

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
