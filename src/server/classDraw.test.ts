import { describe, expect, it } from 'vitest';
import { executeClassDraw, type ClassDrawEvent } from './classDraw';

function createEvent(
  zeroTimeStr: string,
  zeroTimeSec: number,
  className: string,
  competitorId: string
): ClassDrawEvent {
  return {
    competition: { zeroTimeStr, zeroTimeSec },
    classes: [
      {
        id: 'shared-class',
        name: className,
        freeStart: false,
      },
    ],
    competitors: [
      {
        id: competitorId,
        classId: 'shared-class',
        club: 'Club',
        status: 'REGISTERED',
        allocatedStartSec: null,
      },
    ],
  };
}

describe('executeClassDraw', () => {
  it('draws each class in its requested competition, independent of active-event order', () => {
    const activeEvent = createEvent('08:00:00', 28800, 'Active class', 'active-runner');
    const selectedEvent = createEvent('09:00:00', 32400, 'Selected class', 'selected-runner');
    const competitions = {
      active: activeEvent,
      selected: selectedEvent,
    };

    const selectedDraw = executeClassDraw(competitions, {
      competitionId: 'selected',
      classId: 'shared-class',
      mode: 'MASS',
    });

    expect(selectedDraw).toMatchObject({
      kind: 'drawn',
      className: 'Selected class',
      plan: { allocations: [{ competitorId: 'selected-runner', allocatedStartSec: 32400 }] },
    });
    expect(activeEvent.competitors[0].allocatedStartSec).toBeNull();

    const activeDraw = executeClassDraw(competitions, {
      competitionId: 'active',
      classId: 'shared-class',
      mode: 'MASS',
    });

    expect(activeDraw).toMatchObject({
      kind: 'drawn',
      className: 'Active class',
      plan: { allocations: [{ competitorId: 'active-runner', allocatedStartSec: 28800 }] },
    });
  });

  it('rejects a stale class ID rather than drawing a class from another competition', () => {
    const activeEvent = createEvent('08:00:00', 28800, 'Active class', 'active-runner');
    const selectedEvent = createEvent('09:00:00', 32400, 'Selected class', 'selected-runner');

    const result = executeClassDraw(
      { active: activeEvent, selected: selectedEvent },
      {
        competitionId: 'selected',
        classId: 'old-class',
        mode: 'MASS',
      }
    );

    expect(result.kind).toBe('class-not-found');
    expect(activeEvent.competitors[0].allocatedStartSec).toBeNull();
    expect(selectedEvent.competitors[0].allocatedStartSec).toBeNull();
  });

  it('rejects an unknown competition', () => {
    const result = executeClassDraw({}, {
      competitionId: 'missing',
      classId: 'shared-class',
    });
    expect(result).toEqual({ kind: 'competition-not-found' });
  });
});
