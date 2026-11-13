import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateClassStartDraw } from './startListDraw';

const competitors = [
  { id: 'one', classId: 'class-a', club: 'A', status: 'REGISTERED' },
  { id: 'two', classId: 'class-a', club: 'A', status: 'REGISTERED' },
  { id: 'three', classId: 'class-a', club: 'B', status: 'CHECKED' },
  { id: 'four', classId: 'class-a', club: 'B', status: 'IN_FOREST' },
  { id: 'other', classId: 'class-b', club: 'C', status: 'REGISTERED' },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('calculateClassStartDraw', () => {
  it('reserves vacancies and spaces eligible runners at the configured interval', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const plan = calculateClassStartDraw(competitors, {
      classId: 'class-a',
      mode: 'INTERVAL',
      firstStartClock: '10:00',
      intervalSec: 120,
      vacancies: 1,
      clubSeparation: true,
      includeAlreadyStarted: false,
      defaultFirstStartSec: 36000,
    });

    expect(plan.vacantStartTimes).toEqual(['10:00:00']);
    expect(plan.drawnCount).toBe(3);
    expect(plan.allocations.map((item) => item.allocatedStartSec)).toEqual([
      36120,
      36240,
      36360,
    ]);
    expect(plan.allocations.map((item) => item.competitorId)).not.toContain('four');
    expect(plan.allocations.map((item) => item.competitorId)).not.toContain('other');
    const clubsById = new Map(competitors.map((competitor) => [competitor.id, competitor.club]));
    const orderedClubs = plan.allocations.map((item) => clubsById.get(item.competitorId));
    expect(orderedClubs[0]).not.toBe(orderedClubs[1]);
    expect(orderedClubs[1]).not.toBe(orderedClubs[2]);
  });

  it('sets mass and free starts consistently', () => {
    const options = {
      classId: 'class-a',
      firstStartClock: '10:15:30',
      intervalSec: 120,
      vacancies: 3,
      clubSeparation: false,
      includeAlreadyStarted: true,
      defaultFirstStartSec: 36000,
    };

    const mass = calculateClassStartDraw(competitors, {
      ...options,
      mode: 'MASS',
    });
    expect(mass.allocations.every((item) => item.allocatedStartSec === 36930)).toBe(true);
    expect(mass.freeStart).toBe(false);

    const free = calculateClassStartDraw(competitors, {
      ...options,
      mode: 'FREE',
    });
    expect(free.allocations.every((item) => item.allocatedStartSec === null)).toBe(true);
    expect(free.freeStart).toBe(true);
  });
});
