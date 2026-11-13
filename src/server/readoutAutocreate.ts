import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { SI_CARD_ASSIGNMENT_SCHEMA_VERSION } from '../types/sportident';

export interface ReadoutAutoCreateActor {
  uid: string;
}

export interface ReadoutAutoCreateInput {
  competitorId: string;
  siNumber: number;
  cardSeries: string;
  stationCode: number;
  checkTimeSec: number;
  startTimeSec: number;
  finishTimeSec: number;
  punchCodes: number[];
  punchTimes: number[];
  rawHex: string;
  expectedRunnerDb: {
    fullName: string;
    club: string;
    cardSeries: string;
  };
  competitor: {
    classId: string;
    status: 'OK' | 'MP';
    checkTimeSec: number;
    startTimeSec: number;
    finishTimeSec: number;
    runningTimeSec: number;
    readoutAtIso: string;
  };
}

export interface ReadoutAutoCreateResult {
  status: 'PROCESSED' | 'UNKNOWN';
  competitorId: string | null;
  bib: number | null;
  replayed: boolean;
}

export class ReadoutAutoCreateError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ReadoutAutoCreateError';
  }
}

const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const READOUT_ROLES = new Set(['READOUT', 'FOREST', 'SPEAKER']);

function requireId(value: string, label: string): string {
  if (!VALID_ID.test(value)) {
    throw new ReadoutAutoCreateError(400, `Invalid ${label}.`);
  }
  return value;
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

function validateInput(value: unknown): ReadoutAutoCreateInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReadoutAutoCreateError(400, 'Readout data is invalid.');
  }
  const input = value as Record<string, unknown>;
  const expectedRunnerDb = input.expectedRunnerDb;
  const competitor = input.competitor;
  if (
    !expectedRunnerDb ||
    typeof expectedRunnerDb !== 'object' ||
    Array.isArray(expectedRunnerDb) ||
    !competitor ||
    typeof competitor !== 'object' ||
    Array.isArray(competitor)
  ) {
    throw new ReadoutAutoCreateError(400, 'Readout identity data is invalid.');
  }
  const expected = expectedRunnerDb as Record<string, unknown>;
  const candidate = competitor as Record<string, unknown>;
  if (
    typeof input.competitorId !== 'string' ||
    !VALID_ID.test(input.competitorId) ||
    !isBoundedInteger(input.siNumber, 1, 99999999) ||
    typeof input.cardSeries !== 'string' ||
    input.cardSeries.length < 1 ||
    input.cardSeries.length > 24 ||
    !isBoundedInteger(input.stationCode, 1, 999) ||
    !isBoundedInteger(input.checkTimeSec, -1, 86400) ||
    !isBoundedInteger(input.startTimeSec, -1, 86400) ||
    !isBoundedInteger(input.finishTimeSec, -1, 86400) ||
    !Array.isArray(input.punchCodes) ||
    !Array.isArray(input.punchTimes) ||
    input.punchCodes.length > 192 ||
    input.punchCodes.length !== input.punchTimes.length ||
    input.punchCodes.some((code) => !isBoundedInteger(code, 1, 999)) ||
    input.punchTimes.some((time) => !isBoundedInteger(time, 0, 86400)) ||
    typeof input.rawHex !== 'string' ||
    input.rawHex.length > 2000 ||
    typeof expected.fullName !== 'string' ||
    !expected.fullName.trim() ||
    expected.fullName.length > 120 ||
    typeof expected.club !== 'string' ||
    expected.club.length > 100 ||
    typeof expected.cardSeries !== 'string' ||
    expected.cardSeries.length < 1 ||
    expected.cardSeries.length > 24 ||
    typeof candidate.classId !== 'string' ||
    !VALID_ID.test(candidate.classId) ||
    (candidate.status !== 'OK' && candidate.status !== 'MP') ||
    !isBoundedInteger(candidate.checkTimeSec, -1, 86400) ||
    !isBoundedInteger(candidate.startTimeSec, -1, 86400) ||
    !isBoundedInteger(candidate.finishTimeSec, -1, 86400) ||
    !isBoundedInteger(candidate.runningTimeSec, -1, 86400) ||
    typeof candidate.readoutAtIso !== 'string' ||
    candidate.readoutAtIso.length < 1 ||
    candidate.readoutAtIso.length > 40
  ) {
    throw new ReadoutAutoCreateError(400, 'Readout data is invalid.');
  }
  return {
    competitorId: input.competitorId,
    siNumber: input.siNumber,
    cardSeries: input.cardSeries,
    stationCode: input.stationCode,
    checkTimeSec: input.checkTimeSec,
    startTimeSec: input.startTimeSec,
    finishTimeSec: input.finishTimeSec,
    punchCodes: input.punchCodes,
    punchTimes: input.punchTimes,
    rawHex: input.rawHex,
    expectedRunnerDb: {
      fullName: expected.fullName,
      club: expected.club,
      cardSeries: expected.cardSeries,
    },
    competitor: {
      classId: candidate.classId,
      status: candidate.status,
      checkTimeSec: candidate.checkTimeSec,
      startTimeSec: candidate.startTimeSec,
      finishTimeSec: candidate.finishTimeSec,
      runningTimeSec: candidate.runningTimeSec,
      readoutAtIso: candidate.readoutAtIso,
    },
  };
}

function receiptMatchesPayload(
  receipt: Record<string, unknown>,
  input: ReadoutAutoCreateInput,
  competitionId: string,
  actorUid: string,
  receiptId: string
): boolean {
  return (
    receipt.receiptId === receiptId &&
    receipt.clientReadoutId === receiptId &&
    receipt.competitionId === competitionId &&
    receipt.ownerUid === actorUid &&
    receipt.siNumber === input.siNumber &&
    receipt.cardSeries === input.cardSeries &&
    receipt.stationCode === input.stationCode &&
    receipt.checkTimeSec === input.checkTimeSec &&
    receipt.startTimeSec === input.startTimeSec &&
    receipt.finishTimeSec === input.finishTimeSec &&
    JSON.stringify(receipt.punchCodes) === JSON.stringify(input.punchCodes) &&
    JSON.stringify(receipt.punchTimes) === JSON.stringify(input.punchTimes) &&
    receipt.rawHex === input.rawHex
  );
}

export async function createReadoutCompetitorFromRunnerDb(
  firestore: Firestore,
  actor: ReadoutAutoCreateActor,
  competitionIdInput: string,
  receiptIdInput: string,
  inputInput: unknown
): Promise<ReadoutAutoCreateResult> {
  const competitionId = requireId(competitionIdInput, 'competition ID');
  const receiptId = requireId(receiptIdInput, 'readout receipt ID');
  const actorUid = requireId(actor.uid, 'user ID');
  const input = validateInput(inputInput);

  const competitionRef = firestore.collection('competitions').doc(competitionId);
  const competitorCollection = competitionRef.collection('competitors');
  const competitorRef = competitorCollection.doc(input.competitorId);
  const assignmentRef = competitionRef
    .collection('siCardAssignments')
    .doc(String(input.siNumber));
  const receiptRef = competitionRef.collection('readoutReceipts').doc(receiptId);
  const runnerRef = firestore.collection('runnerDb').doc(String(input.siNumber));
  const adminRef = firestore.collection('admins').doc(actorUid);
  const officialRef = firestore.collection('roleAssignments').doc(actorUid);

  const receiptPayload = {
    receiptId,
    competitionId,
    ownerUid: actorUid,
    clientReadoutId: receiptId,
    siNumber: input.siNumber,
    cardSeries: input.cardSeries,
    stationCode: input.stationCode,
    checkTimeSec: input.checkTimeSec,
    startTimeSec: input.startTimeSec,
    finishTimeSec: input.finishTimeSec,
    punchCodes: input.punchCodes,
    punchTimes: input.punchTimes,
    rawHex: input.rawHex,
  };

  return firestore.runTransaction(async (transaction) => {
    const [
      competitionSnapshot,
      adminSnapshot,
      officialSnapshot,
      receiptSnapshot,
      competitorSnapshot,
      assignmentSnapshot,
      runnerSnapshot,
      competitorsSnapshot,
    ] = await Promise.all([
      transaction.get(competitionRef),
      transaction.get(adminRef),
      transaction.get(officialRef),
      transaction.get(receiptRef),
      transaction.get(competitorRef),
      transaction.get(assignmentRef),
      transaction.get(runnerRef),
      transaction.get(competitorCollection),
    ]);

    if (!competitionSnapshot.exists) {
      throw new ReadoutAutoCreateError(404, 'Competition was not found.');
    }

    const competition = competitionSnapshot.data() ?? {};
    const adminRole = adminSnapshot.data()?.role;
    const officialRole = officialSnapshot.data()?.role;
    const isSuperAdmin = adminRole === 'SUPER_ADMIN';
    const isRaceAdmin = adminRole === 'RACE_ADMIN';
    if (!isSuperAdmin && !isRaceAdmin && !READOUT_ROLES.has(String(officialRole))) {
      throw new ReadoutAutoCreateError(403, 'A readout official or club administrator is required.');
    }
    if (isRaceAdmin && competition.ownerUid !== actorUid) {
      throw new ReadoutAutoCreateError(403, 'The caller does not own this competition.');
    }
    if (receiptSnapshot.exists) {
      const existingReceipt = receiptSnapshot.data() ?? {};
      if (!receiptMatchesPayload(existingReceipt, input, competitionId, actorUid, receiptId)) {
        throw new ReadoutAutoCreateError(409, 'Readout ID is already used for another readout.');
      }
      if (existingReceipt.status === 'UNKNOWN') {
        return {
          status: 'UNKNOWN',
          competitorId: null,
          bib: null,
          replayed: true,
        };
      }
      if (
        existingReceipt.status !== 'PROCESSED' ||
        existingReceipt.competitorId !== input.competitorId ||
        !competitorSnapshot.exists
      ) {
        throw new ReadoutAutoCreateError(409, 'Processed readout receipt is inconsistent.');
      }
      const existingCompetitor = competitorSnapshot.data() ?? {};
      const existingAssignment = assignmentSnapshot.data() ?? {};
      if (
        existingCompetitor.competitionId !== competitionId ||
        existingCompetitor.competitorId !== input.competitorId ||
        existingCompetitor.siNumber !== input.siNumber ||
        existingCompetitor.cardSeries !== input.cardSeries ||
        existingCompetitor.ownerUid !== actorUid ||
        existingCompetitor.readoutReceiptId !== receiptId ||
        existingAssignment.competitionId !== competitionId ||
        existingAssignment.siNumber !== input.siNumber ||
        existingAssignment.competitorId !== input.competitorId ||
        existingAssignment.competitorDocumentId !== input.competitorId ||
        existingAssignment.cardSeries !== existingCompetitor.cardSeries ||
        existingAssignment.ownerUid !== existingCompetitor.ownerUid ||
        existingAssignment.state !== 'ACTIVE' ||
        existingAssignment.schemaVersion !== SI_CARD_ASSIGNMENT_SCHEMA_VERSION
      ) {
        throw new ReadoutAutoCreateError(409, 'Processed readout identity is inconsistent.');
      }
      return {
        status: 'PROCESSED',
        competitorId: input.competitorId,
        bib: Number.isInteger(existingCompetitor.bib) ? existingCompetitor.bib : null,
        replayed: true,
      };
    }

    if (competition.status === 'COMPLETED') {
      throw new ReadoutAutoCreateError(409, 'The competition is completed.');
    }

    const runner = runnerSnapshot.data();
    const runnerIdentityMatches =
      runnerSnapshot.exists &&
      Number(runner?.siNumber) === input.siNumber &&
      runner?.fullName === input.expectedRunnerDb.fullName &&
      runner?.club === input.expectedRunnerDb.club &&
      runner?.cardSeries === input.expectedRunnerDb.cardSeries &&
      runner?.cardSeries === input.cardSeries;
    const duplicateCompetitor = competitorsSnapshot.docs.some(
      (snapshot) => snapshot.data().siNumber === input.siNumber
    );
    const competitorIdentityExists = competitorSnapshot.exists;
    const assignmentConflict = assignmentSnapshot.exists;

    if (
      !runnerIdentityMatches ||
      duplicateCompetitor ||
      competitorIdentityExists ||
      assignmentConflict
    ) {
      transaction.create(receiptRef, {
        ...receiptPayload,
        status: 'UNKNOWN',
        competitorId: '',
        createdAt: FieldValue.serverTimestamp(),
      });
      return {
        status: 'UNKNOWN',
        competitorId: null,
        bib: null,
        replayed: false,
      };
    }

    const competitorCount = Number(competition.competitorCount ?? 0);
    const finishedCount = Number(competition.finishedCount ?? 0);
    if (
      !Number.isInteger(competitorCount) ||
      competitorCount < 0 ||
      !Number.isInteger(finishedCount) ||
      finishedCount < 0
    ) {
      throw new ReadoutAutoCreateError(409, 'Competition counters are invalid.');
    }
    const observedMaxBib = Math.max(
      400,
      ...competitorsSnapshot.docs.map((snapshot) => Number(snapshot.data().bib) || 0)
    );
    const bib =
      observedMaxBib +
      Math.max(0, competitorCount - competitorsSnapshot.size) +
      1;
    if (bib > 99999) {
      throw new ReadoutAutoCreateError(409, 'Competition bib limit has been reached.');
    }

    const serverTimestamp = FieldValue.serverTimestamp();
    transaction.create(competitorRef, {
      competitorId: input.competitorId,
      competitionId,
      bib,
      fullName: String(runner?.fullName).slice(0, 120),
      club: String(runner?.club).slice(0, 100) || 'Klubblös',
      classId: input.competitor.classId,
      siNumber: input.siNumber,
      cardSeries: String(runner?.cardSeries),
      isRentalCard: false,
      rentalReturned: false,
      status: input.competitor.status,
      allocatedStartSec: -1,
      checkTimeSec: input.competitor.checkTimeSec,
      startTimeSec: input.competitor.startTimeSec,
      finishTimeSec: input.competitor.finishTimeSec,
      manualFinishTimeSec: -1,
      runningTimeSec: input.competitor.runningTimeSec,
      readoutAtIso: input.competitor.readoutAtIso,
      punchCodes: input.punchCodes,
      punchTimes: input.punchTimes,
      ownerUid: actorUid,
      readoutReceiptId: receiptId,
      createdAt: serverTimestamp,
      updatedAt: serverTimestamp,
    });
    transaction.create(assignmentRef, {
      competitionId,
      siNumber: input.siNumber,
      cardSeries: String(runner?.cardSeries),
      competitorId: input.competitorId,
      competitorDocumentId: input.competitorId,
      state: 'ACTIVE',
      assignmentVersion: 1,
      source: 'READOUT',
      ownerUid: actorUid,
      schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
      createdAt: serverTimestamp,
      updatedAt: serverTimestamp,
    });
    transaction.update(competitionRef, {
      competitorCount: competitorCount + 1,
      finishedCount: Math.min(competitorCount + 1, finishedCount + 1),
      updatedAt: serverTimestamp,
    });
    transaction.create(receiptRef, {
      ...receiptPayload,
      status: 'PROCESSED',
      competitorId: input.competitorId,
      createdAt: serverTimestamp,
    });
    return {
      status: 'PROCESSED',
      competitorId: input.competitorId,
      bib,
      replayed: false,
    };
  });
}
