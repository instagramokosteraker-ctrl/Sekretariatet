import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type {
  ClassCompetitionFormat,
  CompClass,
  Competitor,
  Course,
  EmergencySettings,
  RunnerStatus,
} from '../types/sportident';
import type {
  ReadoutReassignmentAuditEntry,
  ResultReassignmentActorRole,
  ResultReassignmentResponse,
} from '../types/readoutReassignment';
import { createPublicResultDocumentFromFirestore } from '../utils/publicResultProjection';
import {
  calculateReadoutReassignmentPreview,
  type ReassignmentReadoutData,
} from '../utils/readoutReassignment';
import { mapFirestoreCompetitor } from '../utils/firestoreLiveResults';

export interface ReadoutReassignmentActor {
  uid: string;
}

export interface ReadoutReassignmentInput {
  operationId: string;
  targetCompetitorId: string;
  reason: string;
}

export class ReadoutReassignmentError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ReadoutReassignmentError';
  }
}

const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const AUTHORIZED_OFFICIAL_ROLES = new Set(['READOUT', 'FOREST']);

function requireId(value: string, label: string): string {
  if (!VALID_ID.test(value)) {
    throw new ReadoutReassignmentError(400, `Invalid ${label}.`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function decodeSeconds(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 86400
    ? number
    : null;
}

function timestampToIso(value: unknown): string | null {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  ) {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime())
      ? date.toISOString()
      : null;
  }
  return null;
}

function toCourse(id: string, value: unknown): Course {
  const data = asRecord(value);
  return {
    id: typeof data.courseId === 'string' ? data.courseId : id,
    name: typeof data.name === 'string' ? data.name : 'Bana',
    lengthMeters: Number(data.lengthMeters) || 0,
    climbMeters: Number(data.climbMeters) || 0,
    controls: Array.isArray(data.controls) ? data.controls.map(Number) : [],
  };
}

function toClass(id: string, value: unknown): CompClass {
  const data = asRecord(value);
  const format: ClassCompetitionFormat =
    data.classFormat === 'FORKED' || data.classFormat === 'ROGAINING'
      ? data.classFormat
      : 'STANDARD';
  const maxTime = decodeSeconds(data.rogainingMaxTimeSec);
  const penalty = Number(data.rogainingPenaltyPerMin);
  return {
    id: typeof data.classId === 'string' ? data.classId : id,
    ...(typeof data.eventorClassId === 'string'
      ? { eventorClassId: data.eventorClassId }
      : {}),
    name: typeof data.name === 'string' ? data.name : 'Klass',
    courseId: typeof data.courseId === 'string' && data.courseId ? data.courseId : null,
    classFormat: format,
    forkCourseIds: Array.isArray(data.forkCourseIds)
      ? data.forkCourseIds.filter((courseId): courseId is string => typeof courseId === 'string')
      : [],
    rogainingMaxTimeSec: maxTime,
    rogainingPenaltyPerMin: Number.isInteger(penalty) && penalty >= 0 ? penalty : null,
    allowDirectEntry: data.allowDirectEntry !== false,
    freeStart: data.freeStart !== false,
    autoMatchCourse: data.autoMatchCourse === true,
  };
}

function readAuditEntry(value: unknown): ReadoutReassignmentAuditEntry {
  const data = asRecord(value);
  const original = asRecord(data.originalCompetitor);
  const corrected = asRecord(data.correctedCompetitor);
  const result = asRecord(data.result);
  const timestamp = timestampToIso(data.timestamp);
  if (
    typeof data.operationId !== 'string' ||
    typeof data.readoutId !== 'string' ||
    typeof data.actorUid !== 'string' ||
    typeof data.actorRole !== 'string' ||
    typeof data.reason !== 'string' ||
    typeof original.id !== 'string' ||
    typeof original.name !== 'string' ||
    typeof corrected.id !== 'string' ||
    typeof corrected.name !== 'string' ||
    !timestamp ||
    result.status !== 'APPLIED' ||
    typeof result.previousStatus !== 'string' ||
    typeof result.newStatus !== 'string' ||
    typeof result.finishTimeSec !== 'number' ||
    typeof result.runningTimeSec !== 'number'
  ) {
    throw new ReadoutReassignmentError(500, 'Stored correction audit data is invalid.');
  }
  const placing = asRecord(result.placing);
  return {
    operationId: data.operationId,
    readoutId: data.readoutId,
    actorUid: data.actorUid,
    actorRole: data.actorRole as ResultReassignmentActorRole,
    timestamp,
    reason: data.reason,
    originalCompetitor: { id: original.id, name: original.name },
    correctedCompetitor: { id: corrected.id, name: corrected.name },
    result: {
      status: 'APPLIED',
      previousStatus: result.previousStatus as RunnerStatus,
      newStatus: result.newStatus as RunnerStatus,
      finishTimeSec: result.finishTimeSec,
      runningTimeSec: result.runningTimeSec,
      bomSec: typeof result.bomSec === 'number' ? result.bomSec : null,
      placing:
        Number.isInteger(placing.pos) && Number.isInteger(placing.total)
          ? { pos: Number(placing.pos), total: Number(placing.total) }
          : null,
    },
  };
}

async function authorizeActor(
  firestore: Firestore,
  competitionId: string,
  actorUid: string
): Promise<{ role: ResultReassignmentActorRole; competition: Record<string, unknown> }> {
  const competitionRef = firestore.collection('competitions').doc(competitionId);
  const adminRef = firestore.collection('admins').doc(actorUid);
  const officialRef = firestore.collection('roleAssignments').doc(actorUid);
  const [competitionSnapshot, adminSnapshot, officialSnapshot] = await Promise.all([
    competitionRef.get(),
    adminRef.get(),
    officialRef.get(),
  ]);
  if (!competitionSnapshot.exists) {
    throw new ReadoutReassignmentError(404, 'Competition was not found.');
  }
  const competition = competitionSnapshot.data() ?? {};
  const adminRole = adminSnapshot.data()?.role;
  const officialRole = officialSnapshot.data()?.role;
  if (adminRole === 'SUPER_ADMIN') {
    return { role: adminRole, competition };
  }
  if (adminRole === 'RACE_ADMIN') {
    if (competition.ownerUid !== actorUid) {
      throw new ReadoutReassignmentError(403, 'The caller does not own this competition.');
    }
    return { role: adminRole, competition };
  }
  if (
    typeof officialRole === 'string' &&
    AUTHORIZED_OFFICIAL_ROLES.has(officialRole)
  ) {
    return { role: officialRole as ResultReassignmentActorRole, competition };
  }
  throw new ReadoutReassignmentError(403, 'An authorized readout official is required.');
}

export async function listReadoutReassignmentAudits(
  firestore: Firestore,
  actor: ReadoutReassignmentActor,
  competitionIdInput: string,
  readoutIdInput: string
): Promise<ReadoutReassignmentAuditEntry[]> {
  const competitionId = requireId(competitionIdInput, 'competition ID');
  const readoutId = requireId(readoutIdInput, 'readout ID');
  await authorizeActor(firestore, competitionId, actor.uid);
  const receipt = await firestore
    .collection('competitions')
    .doc(competitionId)
    .collection('readoutReceipts')
    .doc(readoutId)
    .get();
  if (!receipt.exists) {
    throw new ReadoutReassignmentError(404, 'Readout receipt was not found.');
  }
  const snapshots = await firestore
    .collection('competitions')
    .doc(competitionId)
    .collection('readoutCorrections')
    .where('readoutId', '==', readoutId)
    .get();
  return snapshots.docs
    .map((snapshot) => readAuditEntry(snapshot.data()))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export async function reassignReadoutResult(
  firestore: Firestore,
  actor: ReadoutReassignmentActor,
  competitionIdInput: string,
  readoutIdInput: string,
  inputInput: unknown
): Promise<ResultReassignmentResponse> {
  const competitionId = requireId(competitionIdInput, 'competition ID');
  const readoutId = requireId(readoutIdInput, 'readout ID');
  const actorUid = requireId(actor.uid, 'user ID');
  if (!inputInput || typeof inputInput !== 'object' || Array.isArray(inputInput)) {
    throw new ReadoutReassignmentError(400, 'Reassignment data is invalid.');
  }
  const input = inputInput as Record<string, unknown>;
  if (
    typeof input.operationId !== 'string' ||
    !VALID_ID.test(input.operationId) ||
    typeof input.targetCompetitorId !== 'string' ||
    !VALID_ID.test(input.targetCompetitorId) ||
    typeof input.reason !== 'string' ||
    input.reason.trim().length < 3 ||
    input.reason.trim().length > 500
  ) {
    throw new ReadoutReassignmentError(
      400,
      'A valid operation ID, target competitor and reason are required.'
    );
  }
  const operationId = input.operationId;
  const targetCompetitorId = input.targetCompetitorId;
  const reason = input.reason.trim();
  const competitionRef = firestore.collection('competitions').doc(competitionId);
  const operationCollection = competitionRef.collection('readoutCorrections');
  const operationRef = operationCollection.doc(operationId);
  const receiptCollection = competitionRef.collection('readoutReceipts');
  const receiptRef = receiptCollection.doc(readoutId);
  const competitorCollection = competitionRef.collection('competitors');
  const targetRef = competitorCollection.doc(targetCompetitorId);
  const adminRef = firestore.collection('admins').doc(actorUid);
  const officialRef = firestore.collection('roleAssignments').doc(actorUid);

  return firestore.runTransaction(async (transaction) => {
    const [
      competitionSnapshot,
      adminSnapshot,
      officialSnapshot,
      operationSnapshot,
      receiptSnapshot,
    ] = await Promise.all([
      transaction.get(competitionRef),
      transaction.get(adminRef),
      transaction.get(officialRef),
      transaction.get(operationRef),
      transaction.get(receiptRef),
    ]);
    if (!competitionSnapshot.exists) {
      throw new ReadoutReassignmentError(404, 'Competition was not found.');
    }
    const competition = competitionSnapshot.data() ?? {};
    const adminRole = adminSnapshot.data()?.role;
    const officialRole = officialSnapshot.data()?.role;
    let actorRole: ResultReassignmentActorRole;
    if (adminRole === 'SUPER_ADMIN') {
      actorRole = adminRole;
    } else if (adminRole === 'RACE_ADMIN') {
      if (competition.ownerUid !== actorUid) {
        throw new ReadoutReassignmentError(403, 'The caller does not own this competition.');
      }
      actorRole = adminRole;
    } else if (
      typeof officialRole === 'string' &&
      AUTHORIZED_OFFICIAL_ROLES.has(officialRole)
    ) {
      actorRole = officialRole as ResultReassignmentActorRole;
    } else {
      throw new ReadoutReassignmentError(403, 'An authorized readout official is required.');
    }

    if (operationSnapshot.exists) {
      const operation = operationSnapshot.data() ?? {};
      const request = asRecord(operation.request);
      if (
        request.readoutId !== readoutId ||
        request.targetCompetitorId !== targetCompetitorId ||
        request.reason !== reason ||
        request.actorUid !== actorUid
      ) {
        throw new ReadoutReassignmentError(
          409,
          'Operation ID was already used for a different reassignment.'
        );
      }
      return {
        status: 'REPLAYED',
        operationId,
        readoutId,
        originalCompetitorId: String(operation.originalCompetitorId),
        correctedCompetitorId: targetCompetitorId,
        audit: readAuditEntry(operation),
      };
    }

    if (!receiptSnapshot.exists) {
      throw new ReadoutReassignmentError(404, 'Readout receipt was not found.');
    }
    const receipt = receiptSnapshot.data() ?? {};
    const originalCompetitorId =
      typeof receipt.competitorId === 'string' ? receipt.competitorId : '';
    if (
      receipt.receiptId !== readoutId ||
      receipt.clientReadoutId !== readoutId ||
      receipt.competitionId !== competitionId ||
      receipt.status !== 'PROCESSED' ||
      !VALID_ID.test(originalCompetitorId)
    ) {
      throw new ReadoutReassignmentError(409, 'Readout receipt is not a processed result.');
    }
    if (targetCompetitorId === originalCompetitorId) {
      throw new ReadoutReassignmentError(400, 'Choose a different competitor.');
    }

    const sourceRef = competitorCollection.doc(originalCompetitorId);
    const sourcePublicRef = competitionRef
      .collection('publicResults')
      .doc(originalCompetitorId);
    const targetPublicRef = competitionRef
      .collection('publicResults')
      .doc(targetCompetitorId);
    const [sourceSnapshot, targetSnapshot, competitorsSnapshot, classesSnapshot, coursesSnapshot,
      sourcePublicSnapshot, targetPublicSnapshot, sourceReceiptsSnapshot,
      targetReceiptsSnapshot, existingReadoutCorrections] = await Promise.all([
      transaction.get(sourceRef),
      transaction.get(targetRef),
      transaction.get(competitorCollection),
      transaction.get(competitionRef.collection('classes')),
      transaction.get(competitionRef.collection('courses')),
      transaction.get(sourcePublicRef),
      transaction.get(targetPublicRef),
      transaction.get(receiptCollection.where('competitorId', '==', originalCompetitorId)),
      transaction.get(receiptCollection.where('competitorId', '==', targetCompetitorId)),
      transaction.get(operationCollection.where('readoutId', '==', readoutId)),
    ]);
    if (!sourceSnapshot.exists) {
      throw new ReadoutReassignmentError(409, 'Original competitor no longer exists.');
    }
    if (!targetSnapshot.exists) {
      throw new ReadoutReassignmentError(404, 'Target competitor was not found.');
    }
    const sourceData = sourceSnapshot.data() ?? {};
    const targetData = targetSnapshot.data() ?? {};
    if (sourceData.status !== 'OK') {
      throw new ReadoutReassignmentError(409, 'The original result is no longer an OK result.');
    }
    if (decodeSeconds(sourceData.manualFinishTimeSec) !== null) {
      throw new ReadoutReassignmentError(
        409,
        'A manually timed result cannot be reassigned as a readout result.'
      );
    }
    const competingSourceReceipts = sourceReceiptsSnapshot.docs.filter(
      (snapshot) => snapshot.data().status === 'PROCESSED'
    );
    const competingTargetReceipts = targetReceiptsSnapshot.docs.filter(
      (snapshot) => snapshot.data().status === 'PROCESSED'
    );
    const priorReassignment = existingReadoutCorrections.docs.some(
      (snapshot) => snapshot.data().result?.status === 'APPLIED'
    );
    if (
      competingSourceReceipts.length !== 1 ||
      competingSourceReceipts[0]?.id !== readoutId ||
      competingTargetReceipts.length > 0 ||
      priorReassignment
    ) {
      throw new ReadoutReassignmentError(
        409,
        'Multiple or previously reassigned readouts make this correction ambiguous.'
      );
    }
    const targetStatus = targetData.status;
    if (
      targetStatus !== 'REGISTERED' &&
      targetStatus !== 'CHECKED' &&
      targetStatus !== 'IN_FOREST'
    ) {
      throw new ReadoutReassignmentError(
        409,
        'The target competitor already has a result and cannot receive this readout.'
      );
    }
    if (
      (typeof targetData.readoutAtIso === 'string' && targetData.readoutAtIso) ||
      (Array.isArray(targetData.punchCodes) && targetData.punchCodes.length > 0)
    ) {
      throw new ReadoutReassignmentError(
        409,
        'The target competitor has existing readout data that must be resolved first.'
      );
    }
    const punchCodes = receipt.punchCodes;
    const punchTimes = receipt.punchTimes;
    if (
      !Array.isArray(punchCodes) ||
      !Array.isArray(punchTimes) ||
      punchCodes.length !== punchTimes.length ||
      punchCodes.length > 192 ||
      punchCodes.some((code) => !Number.isInteger(code) || Number(code) < 1 || Number(code) > 999) ||
      punchTimes.some((time) => !Number.isInteger(time) || Number(time) < 0 || Number(time) > 86400)
    ) {
      throw new ReadoutReassignmentError(409, 'Readout receipt punches are invalid.');
    }
    const finishTimeSec = decodeSeconds(receipt.finishTimeSec);
    if (finishTimeSec === null) {
      throw new ReadoutReassignmentError(409, 'Readout receipt has no valid finish time.');
    }
    const courses = coursesSnapshot.docs.map((snapshot) =>
      toCourse(snapshot.id, snapshot.data())
    );
    const classes = classesSnapshot.docs.map((snapshot) =>
      toClass(snapshot.id, snapshot.data())
    );
    const zeroTimeSec = decodeSeconds(competition.zeroTimeSec);
    if (zeroTimeSec === null) {
      throw new ReadoutReassignmentError(409, 'Competition zero time is invalid.');
    }
    const emergency: EmergencySettings = {
      brokenControls: Array.isArray(competition.brokenControls)
        ? competition.brokenControls.filter(
            (code): code is number =>
              Number.isInteger(code) && Number(code) >= 1 && Number(code) <= 999
          )
        : [],
      controlTimeOffsets:
        competition.controlTimeOffsets &&
        typeof competition.controlTimeOffsets === 'object' &&
        !Array.isArray(competition.controlTimeOffsets)
          ? (competition.controlTimeOffsets as Record<string, number>)
          : {},
    };
    const competitors = competitorsSnapshot.docs.map((snapshot) =>
      mapFirestoreCompetitor(snapshot.id, snapshot.data(), {
        classes,
        courses,
        competitionZeroTimeSec: zeroTimeSec,
        emergency,
      })
    );
    const source = competitors.find((competitor) => competitor.id === originalCompetitorId);
    const target = competitors.find((competitor) => competitor.id === targetCompetitorId);
    if (!source || !target) {
      throw new ReadoutReassignmentError(409, 'Competitor data could not be validated.');
    }
    const capturedAt = timestampToIso(receipt.createdAt) ?? new Date().toISOString();
    let preview;
    try {
      preview = calculateReadoutReassignmentPreview(
        {
          clientReadoutId: readoutId,
          capturedAt,
          checkTimeSec: decodeSeconds(receipt.checkTimeSec),
          startTimeSec: decodeSeconds(receipt.startTimeSec),
          finishTimeSec,
          punches: punchCodes.map((code, index) => ({
            code: Number(code),
            timeSec: Number(punchTimes[index]),
          })),
        } satisfies ReassignmentReadoutData,
        originalCompetitorId,
        target,
        competitors,
        classes,
        courses,
        zeroTimeSec,
        emergency
      );
    } catch (error) {
      throw new ReadoutReassignmentError(
        409,
        error instanceof Error ? error.message : 'Readout cannot be reassigned safely.'
      );
    }
    const sourceResultData = {
      ...sourceData,
      status: 'REGISTERED',
      checkTimeSec: -1,
      startTimeSec: -1,
      finishTimeSec: -1,
      runningTimeSec: -1,
      readoutAtIso: '',
      punchCodes: [],
      punchTimes: [],
    };
    const targetResultData = {
      ...targetData,
      status: preview.status,
      checkTimeSec: preview.competitor.checkTimeSec ?? -1,
      startTimeSec: preview.competitor.startTimeSec ?? -1,
      finishTimeSec: preview.finishTimeSec,
      runningTimeSec: preview.runningTimeSec,
      readoutAtIso: capturedAt,
      punchCodes: punchCodes.map(Number),
      punchTimes: punchTimes.map(Number),
      resultVerification: preview.status === 'OK' ? 'SI_VERIFIED_OK' : FieldValue.delete(),
    };
    const createdAt = new Date().toISOString();
    const audit: ReadoutReassignmentAuditEntry = {
      operationId,
      readoutId,
      actorUid,
      actorRole,
      timestamp: createdAt,
      reason,
      originalCompetitor: {
        id: originalCompetitorId,
        name: typeof sourceData.fullName === 'string' ? sourceData.fullName : '',
      },
      correctedCompetitor: {
        id: targetCompetitorId,
        name: typeof targetData.fullName === 'string' ? targetData.fullName : '',
      },
      result: {
        status: 'APPLIED',
        previousStatus: source.status,
        newStatus: preview.status,
        finishTimeSec: preview.finishTimeSec,
        runningTimeSec: preview.runningTimeSec,
        bomSec: preview.bomSec,
        placing: preview.placing
          ? { pos: preview.placing.pos, total: preview.placing.total }
          : null,
      },
    };
    const storedAudit = {
      ...audit,
      timestamp: createdAt,
      request: {
        readoutId,
        targetCompetitorId,
        reason,
        actorUid,
      },
      originalCompetitorId,
      correctedCompetitorId: targetCompetitorId,
    };
    transaction.update(sourceRef, {
      status: sourceResultData.status,
      checkTimeSec: sourceResultData.checkTimeSec,
      startTimeSec: sourceResultData.startTimeSec,
      finishTimeSec: sourceResultData.finishTimeSec,
      runningTimeSec: sourceResultData.runningTimeSec,
      readoutAtIso: sourceResultData.readoutAtIso,
      punchCodes: sourceResultData.punchCodes,
      punchTimes: sourceResultData.punchTimes,
      resultVerification: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(targetRef, {
      status: targetResultData.status,
      checkTimeSec: targetResultData.checkTimeSec,
      startTimeSec: targetResultData.startTimeSec,
      finishTimeSec: targetResultData.finishTimeSec,
      runningTimeSec: targetResultData.runningTimeSec,
      readoutAtIso: targetResultData.readoutAtIso,
      punchCodes: targetResultData.punchCodes,
      punchTimes: targetResultData.punchTimes,
      resultVerification: targetResultData.resultVerification,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(
      sourcePublicRef,
      {
        ...createPublicResultDocumentFromFirestore(
          competitionId,
          originalCompetitorId,
          sourceResultData,
          sourcePublicSnapshot.data()?.radioSplits
        ),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      targetPublicRef,
      {
        ...createPublicResultDocumentFromFirestore(
          competitionId,
          targetCompetitorId,
          targetResultData,
          targetPublicSnapshot.data()?.radioSplits
        ),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.create(operationRef, storedAudit);
    return {
      status: 'APPLIED',
      operationId,
      readoutId,
      originalCompetitorId,
      correctedCompetitorId: targetCompetitorId,
      audit,
    };
  });
}
