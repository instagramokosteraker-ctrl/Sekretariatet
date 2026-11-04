import type {
  CardPunch,
  CompClass,
  Course,
  EmergencySettings,
  ReadoutValidation,
  SplitLegResult,
} from '../types/sportident';

export function applyEmergencyTimeOffsets(
  punches: CardPunch[],
  offsets: Record<string, number>
): CardPunch[] {
  if (!offsets || Object.keys(offsets).length === 0) {
    return punches.map((p) => ({ ...p }));
  }
  return punches.map((p) => {
    const delta = Number(offsets[String(p.code)] || 0);
    if (!Number.isFinite(delta) || delta === 0) return { ...p };
    return {
      code: p.code,
      timeSec: (((p.timeSec + Math.round(delta)) % 86400) + 86400) % 86400,
    };
  });
}

function evaluateCardAgainstSingleCourse(
  course: Course,
  effectiveStartSec: number,
  finishTimeSec: number | null,
  rawPunches: CardPunch[],
  emergency: EmergencySettings
): ReadoutValidation {
  const punches = applyEmergencyTimeOffsets(rawPunches, emergency.controlTimeOffsets);
  const brokenSet = new Set<number>(emergency.brokenControls || []);
  const splits: SplitLegResult[] = [];
  const missingControls: number[] = [];
  const matchedPunchIndices = new Set<number>();
  let searchCursor = 0;
  let prevPunchSec = effectiveStartSec;
  let previousValid = true;

  course.controls.forEach((reqCode, idx) => {
    let foundIdx = -1;
    for (let i = searchCursor; i < punches.length; i++) {
      if (punches[i].code === reqCode) {
        foundIdx = i;
        break;
      }
    }

    if (foundIdx !== -1) {
      matchedPunchIndices.add(foundIdx);
      const pTime = punches[foundIdx].timeSec;
      const cum = pTime >= effectiveStartSec ? pTime - effectiveStartSec : null;
      const leg = previousValid && pTime >= prevPunchSec ? pTime - prevPunchSec : null;
      splits.push({
        order: idx + 1,
        controlCode: reqCode,
        label: `K${reqCode}`,
        status: 'OK',
        punchTimeSec: pTime,
        cumulativeSec: cum,
        legSec: leg,
      });
      prevPunchSec = pTime;
      previousValid = true;
      searchCursor = foundIdx + 1;
    } else if (brokenSet.has(reqCode)) {
      splits.push({
        order: idx + 1,
        controlCode: reqCode,
        label: `K${reqCode}`,
        status: 'BROKEN_CTRL',
        punchTimeSec: null,
        cumulativeSec: null,
        legSec: null,
      });
      previousValid = false;
    } else {
      missingControls.push(reqCode);
      splits.push({
        order: idx + 1,
        controlCode: reqCode,
        label: `K${reqCode}`,
        status: 'MISSING',
        punchTimeSec: null,
        cumulativeSec: null,
        legSec: null,
      });
      previousValid = false;
    }
  });

  if (finishTimeSec !== null && finishTimeSec >= effectiveStartSec) {
    splits.push({
      order: course.controls.length + 1,
      controlCode: 999,
      label: 'Mål',
      status: 'OK',
      punchTimeSec: finishTimeSec,
      cumulativeSec: finishTimeSec - effectiveStartSec,
      legSec: previousValid && finishTimeSec >= prevPunchSec ? finishTimeSec - prevPunchSec : null,
    });
  }

  return {
    ok: missingControls.length === 0 && finishTimeSec !== null,
    matchedCourseId: course.id,
    matchedCourseName: course.name,
    missingControls,
    extraControls: punches.filter((_, i) => !matchedPunchIndices.has(i)),
    splits,
  };
}

function getRogainingControlPoints(code: number): number {
  return Math.max(10, Math.floor(code / 10) * 10);
}

function evaluateRogainingReadout(
  compClass: CompClass,
  assignedCourse: Course | null,
  courses: Course[],
  effectiveStartSec: number,
  finishTimeSec: number | null,
  rawPunches: CardPunch[],
  emergency: EmergencySettings
): ReadoutValidation {
  const punches = applyEmergencyTimeOffsets(rawPunches, emergency.controlTimeOffsets);
  const brokenSet = new Set<number>(emergency.brokenControls || []);
  const allowedPool = assignedCourse
    ? new Set<number>(assignedCourse.controls)
    : new Set<number>(courses.flatMap((c) => c.controls));
  const visitedCodes = new Set<number>();
  const splits: SplitLegResult[] = [];
  const extraControls: CardPunch[] = [];
  let prevPunchSec = effectiveStartSec;
  let grossPoints = 0;

  for (const p of punches) {
    if (brokenSet.has(p.code)) {
      extraControls.push(p);
      continue;
    }
    const inPool = allowedPool.size === 0 || allowedPool.has(p.code);
    if (!inPool || visitedCodes.has(p.code)) {
      extraControls.push(p);
      continue;
    }

    visitedCodes.add(p.code);
    const pts = getRogainingControlPoints(p.code);
    grossPoints += pts;
    const cum = p.timeSec >= effectiveStartSec ? p.timeSec - effectiveStartSec : null;
    const leg = p.timeSec >= prevPunchSec ? p.timeSec - prevPunchSec : null;
    splits.push({
      order: splits.length + 1,
      controlCode: p.code,
      label: `K${p.code}`,
      status: 'OK',
      punchTimeSec: p.timeSec,
      cumulativeSec: cum,
      legSec: leg,
      pointsAwarded: pts,
    });
    prevPunchSec = p.timeSec;
  }

  if (finishTimeSec !== null && finishTimeSec >= effectiveStartSec) {
    splits.push({
      order: splits.length + 1,
      controlCode: 999,
      label: 'Mål',
      status: 'OK',
      punchTimeSec: finishTimeSec,
      cumulativeSec: finishTimeSec - effectiveStartSec,
      legSec: finishTimeSec >= prevPunchSec ? finishTimeSec - prevPunchSec : null,
      pointsAwarded: 0,
    });
  }

  const runSec =
    finishTimeSec !== null && finishTimeSec >= effectiveStartSec
      ? finishTimeSec - effectiveStartSec
      : 0;
  const maxTimeSec = compClass.rogainingMaxTimeSec ?? 2700;
  const penaltyPerMin = compClass.rogainingPenaltyPerMin ?? 10;
  const overtimeSec = maxTimeSec > 0 && runSec > maxTimeSec ? runSec - maxTimeSec : 0;
  const overtimeMin = overtimeSec > 0 ? Math.ceil(overtimeSec / 60) : 0;
  const penalty = overtimeMin * penaltyPerMin;

  return {
    ok: finishTimeSec !== null,
    matchedCourseId: assignedCourse?.id ?? null,
    matchedCourseName: assignedCourse ? `${assignedCourse.name} (Poängpool)` : 'Poäng-OL',
    missingControls: [],
    extraControls,
    splits,
    rogainingPoints: Math.max(0, grossPoints - penalty),
    rogainingGrossPoints: grossPoints,
    rogainingOvertimePenalty: penalty,
    rogainingOvertimeSec: overtimeSec,
  };
}

export function validateCompetitorReadout(
  compClass: CompClass | undefined,
  courses: Course[],
  effectiveStartSec: number,
  finishTimeSec: number | null,
  punches: CardPunch[],
  emergency: EmergencySettings
): ReadoutValidation {
  const assignedCourse =
    courses.find((c) => c.id === compClass?.courseId) ?? courses[0] ?? null;

  if (compClass?.classFormat === 'ROGAINING') {
    return evaluateRogainingReadout(
      compClass,
      assignedCourse,
      courses,
      effectiveStartSec,
      finishTimeSec,
      punches,
      emergency
    );
  }

  if (compClass?.classFormat === 'FORKED') {
    const forkPool =
      compClass.forkCourseIds && compClass.forkCourseIds.length > 0
        ? courses.filter((c) => compClass.forkCourseIds!.includes(c.id))
        : courses;
    const candidates = forkPool.length > 0 ? forkPool : courses;
    const sortedByLen = [...candidates].sort((a, b) => b.controls.length - a.controls.length);
    let closestFallback: ReadoutValidation | null = null;
    for (const candidate of sortedByLen) {
      const result = evaluateCardAgainstSingleCourse(
        candidate,
        effectiveStartSec,
        finishTimeSec,
        punches,
        emergency
      );
      if (result.missingControls.length === 0) return result;
      if (
        !closestFallback ||
        result.missingControls.length < closestFallback.missingControls.length
      ) {
        closestFallback = result;
      }
    }
    if (closestFallback) return closestFallback;
  }

  if (compClass?.autoMatchCourse) {
    const sortedByLen = [...courses].sort((a, b) => b.controls.length - a.controls.length);
    for (const candidate of sortedByLen) {
      const result = evaluateCardAgainstSingleCourse(
        candidate,
        effectiveStartSec,
        finishTimeSec,
        punches,
        emergency
      );
      if (result.missingControls.length === 0) return result;
    }
  }

  if (!assignedCourse) {
    return {
      ok: finishTimeSec !== null,
      matchedCourseId: null,
      matchedCourseName: null,
      missingControls: [],
      extraControls: punches,
      splits: [],
    };
  }

  return evaluateCardAgainstSingleCourse(
    assignedCourse,
    effectiveStartSec,
    finishTimeSec,
    punches,
    emergency
  );
}
