import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { SI_CARD_ASSIGNMENT_SCHEMA_VERSION } from '../types/sportident';

export interface CompetitorCreationActor {
  uid: string;
}

export interface TrustedCompetitorCreateInput {
  bib: number;
  fullName: string;
  club: string;
  classId: string;
  siNumber: number;
  cardSeries: string;
  isRentalCard: boolean;
  rentalReturned: boolean;
  status: string;
  allocatedStartSec: number;
  checkTimeSec: number;
  startTimeSec: number;
  finishTimeSec: number;
  manualFinishTimeSec: number;
  runningTimeSec: number;
  readoutAtIso: string;
  punchCodes: number[];
  punchTimes: number[];
}

export interface TrustedRunnerDbCandidate {
  fullName: string;
  club: string;
  cardSeries: string;
  defaultClassName: string;
}

export interface CompetitorCreationResult {
  runnerDbEntry: Record<string, unknown> | null;
  previousRunnerSiNumber: number | null;
}

export class CompetitorCreationError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'CompetitorCreationError';
  }
}

const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_STATUSES = new Set([
  'REGISTERED',
  'CHECKED',
  'IN_FOREST',
  'PRELIMINARY_FIN',
  'OK',
  'MP',
  'DNF',
  'DNS',
]);

function requireId(value: string, label: string): string {
  if (!VALID_ID.test(value)) {
    throw new CompetitorCreationError(400, `Invalid ${label}.`);
  }
  return value;
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

function validateCreateInput(value: unknown): TrustedCompetitorCreateInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CompetitorCreationError(400, 'Competitor data is invalid.');
  }
  const input = value as Record<string, unknown>;
  if (
    !isBoundedInteger(input.bib, 1, 999999) ||
    typeof input.fullName !== 'string' ||
    !input.fullName.trim() ||
    input.fullName.length > 120 ||
    typeof input.club !== 'string' ||
    input.club.length > 100 ||
    typeof input.classId !== 'string' ||
    !VALID_ID.test(input.classId) ||
    !isBoundedInteger(input.siNumber, 1, 99999999) ||
    typeof input.cardSeries !== 'string' ||
    input.cardSeries.length < 1 ||
    input.cardSeries.length > 24 ||
    typeof input.isRentalCard !== 'boolean' ||
    typeof input.rentalReturned !== 'boolean' ||
    typeof input.status !== 'string' ||
    !VALID_STATUSES.has(input.status) ||
    !isBoundedInteger(input.allocatedStartSec, -1, 86400) ||
    !isBoundedInteger(input.checkTimeSec, -1, 86400) ||
    !isBoundedInteger(input.startTimeSec, -1, 86400) ||
    !isBoundedInteger(input.finishTimeSec, -1, 86400) ||
    !isBoundedInteger(input.manualFinishTimeSec, -1, 86400) ||
    !isBoundedInteger(input.runningTimeSec, -1, 86400) ||
    typeof input.readoutAtIso !== 'string' ||
    input.readoutAtIso.length > 40 ||
    !Array.isArray(input.punchCodes) ||
    !Array.isArray(input.punchTimes) ||
    input.punchCodes.length > 192 ||
    input.punchTimes.length > 192 ||
    input.punchCodes.length !== input.punchTimes.length ||
    input.punchCodes.some((code) => !isBoundedInteger(code, 1, 999)) ||
    input.punchTimes.some((time) => !isBoundedInteger(time, 0, 86400))
  ) {
    throw new CompetitorCreationError(400, 'Competitor data is invalid.');
  }
  return {
    bib: input.bib,
    fullName: input.fullName,
    club: input.club,
    classId: input.classId,
    siNumber: input.siNumber,
    cardSeries: input.cardSeries,
    isRentalCard: input.isRentalCard,
    rentalReturned: input.rentalReturned,
    status: input.status,
    allocatedStartSec: input.allocatedStartSec,
    checkTimeSec: input.checkTimeSec,
    startTimeSec: input.startTimeSec,
    finishTimeSec: input.finishTimeSec,
    manualFinishTimeSec: input.manualFinishTimeSec,
    runningTimeSec: input.runningTimeSec,
    readoutAtIso: input.readoutAtIso,
    punchCodes: input.punchCodes,
    punchTimes: input.punchTimes,
  };
}

function validateRunnerCandidate(value: unknown): TrustedRunnerDbCandidate | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CompetitorCreationError(400, 'Runner database data is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.fullName !== 'string' ||
    candidate.fullName.length > 120 ||
    typeof candidate.club !== 'string' ||
    candidate.club.length > 100 ||
    typeof candidate.cardSeries !== 'string' ||
    candidate.cardSeries.length < 1 ||
    candidate.cardSeries.length > 24 ||
    typeof candidate.defaultClassName !== 'string' ||
    candidate.defaultClassName.length > 120
  ) {
    throw new CompetitorCreationError(400, 'Runner database data is invalid.');
  }
  return {
    fullName: candidate.fullName,
    club: candidate.club,
    cardSeries: candidate.cardSeries,
    defaultClassName: candidate.defaultClassName,
  };
}

function validateRunnerProfileId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const siNumber =
    typeof value === 'string' && /^\d{1,8}$/.test(value) ? Number(value) : value;
  if (!isBoundedInteger(siNumber, 1, 99999999)) {
    throw new CompetitorCreationError(400, 'Runner profile ID is invalid.');
  }
  return String(siNumber);
}

export async function createCompetitorWithAssignment(
  firestore: Firestore,
  actor: CompetitorCreationActor,
  competitionIdInput: string,
  competitorIdInput: string,
  inputInput: unknown,
  runnerCandidateInput: unknown,
  runnerProfileIdInput: unknown = null,
  isBorrowedCardInput: unknown = false
): Promise<CompetitorCreationResult> {
  const competitionId = requireId(competitionIdInput, 'competition ID');
  const competitorId = requireId(competitorIdInput, 'competitor ID');
  const actorUid = requireId(actor.uid, 'user ID');
  const input = validateCreateInput(inputInput);
  const runnerCandidate = validateRunnerCandidate(runnerCandidateInput);
  if (typeof isBorrowedCardInput !== 'boolean') {
    throw new CompetitorCreationError(400, 'Borrowed card flag is invalid.');
  }
  const shouldUpdateRunnerDb =
    !input.isRentalCard && !isBorrowedCardInput && runnerCandidate !== null;
  const runnerProfileId = shouldUpdateRunnerDb
    ? validateRunnerProfileId(runnerProfileIdInput)
    : null;

  const fullName = input.fullName.trim().slice(0, 120);
  const club = input.club.trim().slice(0, 100) || 'Klubblös';
  const assignmentSiNumber = input.siNumber;
  const competitionRef = firestore.collection('competitions').doc(competitionId);
  const competitorRef = competitionRef.collection('competitors').doc(competitorId);
  const assignmentRef = competitionRef
    .collection('siCardAssignments')
    .doc(String(assignmentSiNumber));
  const adminRef = firestore.collection('admins').doc(actorUid);
  const runnerRef = firestore.collection('runnerDb').doc(String(assignmentSiNumber));
  const runnerProfileRef = runnerProfileId
    ? firestore.collection('runnerDb').doc(runnerProfileId)
    : runnerRef;
  const duplicatesQuery = competitionRef
    .collection('competitors')
    .where('siNumber', '==', assignmentSiNumber);

  return firestore.runTransaction(async (transaction) => {
    const [
      competitionSnapshot,
      competitorSnapshot,
      assignmentSnapshot,
      adminSnapshot,
      duplicateCompetitorsSnapshot,
      runnerSnapshot,
      runnerProfileSnapshot,
    ] = await Promise.all([
      transaction.get(competitionRef),
      transaction.get(competitorRef),
      transaction.get(assignmentRef),
      transaction.get(adminRef),
      transaction.get(duplicatesQuery),
      shouldUpdateRunnerDb
        ? transaction.get(runnerRef)
        : Promise.resolve(null),
      shouldUpdateRunnerDb
        ? transaction.get(runnerProfileRef)
        : Promise.resolve(null),
    ]);

    if (!competitionSnapshot.exists) {
      throw new CompetitorCreationError(404, 'Competition was not found.');
    }
    if (competitorSnapshot.exists) {
      throw new CompetitorCreationError(409, 'Competitor ID is already in use.');
    }

    const adminRole = adminSnapshot.data()?.role;
    if (adminRole !== 'RACE_ADMIN' && adminRole !== 'SUPER_ADMIN') {
      throw new CompetitorCreationError(403, 'A club administrator is required.');
    }
    const competition = competitionSnapshot.data() ?? {};
    if (adminRole !== 'SUPER_ADMIN' && competition.ownerUid !== actorUid) {
      throw new CompetitorCreationError(403, 'The caller does not own this competition.');
    }
    if (competition.status === 'COMPLETED' && adminRole !== 'SUPER_ADMIN') {
      throw new CompetitorCreationError(
        409,
        'Competitors cannot be added to a completed competition.'
      );
    }
    if (duplicateCompetitorsSnapshot.docs.length > 0) {
      throw new CompetitorCreationError(
        409,
        `SI card ${assignmentSiNumber} is already used in this competition.`
      );
    }
    if (runnerProfileId && !runnerProfileSnapshot?.exists) {
      throw new CompetitorCreationError(409, 'The selected runner profile was not found.');
    }
    if (
      runnerProfileId &&
      runnerProfileId !== String(assignmentSiNumber) &&
      runnerSnapshot?.exists
    ) {
      throw new CompetitorCreationError(
        409,
        `SI card ${assignmentSiNumber} already belongs to another runner profile.`
      );
    }

    const assignment = assignmentSnapshot.data();
    if (assignmentSnapshot.exists) {
      if (
        !assignment ||
        assignment.state !== 'ACTIVE' ||
        assignment.competitionId !== competitionId ||
        assignment.siNumber !== assignmentSiNumber ||
        assignment.competitorId !== competitorId ||
        assignment.competitorDocumentId !== competitorId ||
        assignment.cardSeries !== input.cardSeries ||
        assignment.ownerUid !== actorUid ||
        assignment.schemaVersion !== SI_CARD_ASSIGNMENT_SCHEMA_VERSION ||
        !isBoundedInteger(assignment.assignmentVersion, 1, 65535)
      ) {
        throw new CompetitorCreationError(
          409,
          `SI card ${assignmentSiNumber} is assigned to another competitor or owner.`
        );
      }
    }

    const currentCompetitorCount = Number(competition.competitorCount || 0);
    const currentFinishedCount = Number(competition.finishedCount || 0);
    if (
      !Number.isInteger(currentCompetitorCount) ||
      currentCompetitorCount < 0 ||
      !Number.isInteger(currentFinishedCount) ||
      currentFinishedCount < 0
    ) {
      throw new CompetitorCreationError(409, 'Competition counters are invalid.');
    }

    const nowIso = new Date().toISOString();
    const serverTimestamp = FieldValue.serverTimestamp();
    if (!assignmentSnapshot.exists) {
      transaction.create(assignmentRef, {
        competitionId,
        siNumber: assignmentSiNumber,
        cardSeries: input.cardSeries,
        competitorId,
        competitorDocumentId: competitorId,
        state: 'ACTIVE',
        assignmentVersion: 1,
        source: 'DIRECT_ENTRY',
        ownerUid: actorUid,
        schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
        createdAt: serverTimestamp,
        updatedAt: serverTimestamp,
      });
    }
    transaction.create(competitorRef, {
      competitorId,
      competitionId,
      bib: input.bib,
      fullName,
      club,
      classId: input.classId,
      siNumber: assignmentSiNumber,
      cardSeries: input.cardSeries,
      isRentalCard: input.isRentalCard,
      rentalReturned: input.rentalReturned,
      status: input.status,
      allocatedStartSec: input.allocatedStartSec,
      checkTimeSec: input.checkTimeSec,
      startTimeSec: input.startTimeSec,
      finishTimeSec: input.finishTimeSec,
      manualFinishTimeSec: input.manualFinishTimeSec,
      runningTimeSec: input.runningTimeSec,
      readoutAtIso: input.readoutAtIso,
      punchCodes: input.punchCodes,
      punchTimes: input.punchTimes,
      ownerUid: actorUid,
      createdAt: serverTimestamp,
      updatedAt: serverTimestamp,
    });

    const isFinished = input.status === 'OK' || input.status === 'MP';
    const nextCompetitorCount = currentCompetitorCount + 1;
    transaction.update(competitionRef, {
      competitorCount: nextCompetitorCount,
      finishedCount: Math.min(
        nextCompetitorCount,
        currentFinishedCount + (isFinished ? 1 : 0)
      ),
      updatedAt: serverTimestamp,
    });

    let runnerDbEntry: Record<string, unknown> | null = null;
    const runnerData = runnerProfileSnapshot?.data();
    const sameRunner =
      typeof runnerData?.fullName === 'string' &&
      runnerData.fullName.trim().toLowerCase() === fullName.toLowerCase();
    if (
      runnerSnapshot &&
      runnerCandidate &&
      (runnerProfileId !== null || !runnerSnapshot.exists || sameRunner)
    ) {
      const nextRunnerData = {
        cardSeries: input.cardSeries,
        fullName,
        club,
        birthYear:
          typeof runnerData?.birthYear === 'number' ? runnerData.birthYear : null,
        defaultClassName: runnerCandidate.defaultClassName,
        eventorPersonId:
          typeof runnerData?.eventorPersonId === 'string'
            ? runnerData.eventorPersonId
            : '',
        eventorOrgId:
          typeof runnerData?.eventorOrgId === 'string' ? runnerData.eventorOrgId : '',
        source: runnerData?.source || 'LEARNED_ENTRY',
        updatedAtIso: nowIso,
      };
      if (runnerProfileId && runnerProfileId !== String(assignmentSiNumber)) {
        transaction.create(runnerRef, {
          runnerId: String(assignmentSiNumber),
          siNumber: assignmentSiNumber,
          ...nextRunnerData,
          ownerUid: actorUid,
          createdAt: serverTimestamp,
          updatedAt: serverTimestamp,
        });
        transaction.delete(runnerProfileRef);
      } else if (runnerSnapshot.exists) {
        transaction.update(runnerRef, {
          ...nextRunnerData,
          updatedAt: serverTimestamp,
        });
      } else {
        transaction.create(runnerRef, {
          runnerId: String(assignmentSiNumber),
          siNumber: assignmentSiNumber,
          ...nextRunnerData,
          source: 'LEARNED_ENTRY',
          ownerUid: actorUid,
          createdAt: serverTimestamp,
          updatedAt: serverTimestamp,
        });
      }
      runnerDbEntry = {
        id: String(assignmentSiNumber),
        siNumber: assignmentSiNumber,
        ...nextRunnerData,
        updatedAt: nowIso,
      };
    }

    return {
      runnerDbEntry,
      previousRunnerSiNumber:
        runnerProfileId && runnerProfileId !== String(assignmentSiNumber)
          ? Number(runnerProfileId)
          : null,
    };
  });
}
