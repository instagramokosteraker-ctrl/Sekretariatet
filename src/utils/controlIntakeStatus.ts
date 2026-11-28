import type { CompClass, Competitor, Course } from '../types/sportident';

export interface ControlIntakeStatus {
  code: number;
  courseCount: number;
  activeRunnersRemaining: number;
}

export function calculateControlIntakeStatus(
  courses: Course[],
  classes: CompClass[],
  competitors: Competitor[]
): ControlIntakeStatus[] {
  const allCodes = Array.from(new Set(courses.flatMap((course) => course.controls))).sort(
    (a, b) => a - b
  );

  return allCodes.map((code) => {
    const matchingCourseIds = new Set(
      courses.filter((course) => course.controls.includes(code)).map((course) => course.id)
    );
    const matchingClassIds = new Set(
      classes
        .filter((compClass) => {
          if (compClass.classFormat === 'FORKED' && compClass.forkCourseIds?.length) {
            return compClass.forkCourseIds.some((courseId) =>
              matchingCourseIds.has(courseId)
            );
          }
          return compClass.courseId !== null && matchingCourseIds.has(compClass.courseId);
        })
        .map((compClass) => compClass.id)
    );

    const activeRunnersRemaining = competitors.filter((competitor) => {
      if (
        competitor.status !== 'REGISTERED' &&
        competitor.status !== 'CHECKED' &&
        competitor.status !== 'IN_FOREST'
      ) {
        return false;
      }
      if (!matchingClassIds.has(competitor.classId)) return false;
      return !competitor.readoutAt && !competitor.rawReadout;
    }).length;

    return {
      code,
      courseCount: matchingCourseIds.size,
      activeRunnersRemaining,
    };
  });
}
