import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import {
  findExactProcessedReadoutDuplicateId,
  type ReadoutReceiptDuplicateCandidate,
} from '../utils/readoutDuplicate';
import { declareCompetitorMutation } from '../utils/siAssignmentDiagnostics';
import { createPublicResultDocumentFromFirestore } from '../utils/publicResultProjection';

export interface ReadoutIngestionActor {
  uid: string;
}

export interface ReadoutIngestionInput {
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
  result: {
    status: 'OK' | 'MP';
    checkTimeSec: number;
    startTimeSec: number;
    finishTimeSec: number;
    runningTimeSec: number;
    readoutAtIso: string;
  };
}

export interface ReadoutIngestionResult {
  status: 'PROCESSED' | 'UNKNOWN' | 'DUPLICATE';
  competitorId: string | null;
  duplicateReceiptId: string | null;
  replayed: boolean;
}

export class ReadoutIngestionError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ReadoutIngestionError';
  }
}

const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const READOUT_ROLES = new Set(['READOUT', 'FOREST', 'SPEAKER']);

function requireId(value: string, label: string): string {
  if (!VALID_ID.test(value)) {
    throw new ReadoutIngestionError(400, `Invalid ${label}.`);
  }
  return value;
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

function validateInput(value: unknown): ReadoutIngestionInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReadoutIngestionError(400, 'Readout data is invalid.');
  }
  const input = value as Record<string, unknown>;
  const result = input.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new ReadoutIngestionError(400, 'Readout result is invalid.');
  }
  const candidate = result as Record<string, unknown>;
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
    (candidate.status !== 'OK' && candidate.status !== 'MP') ||
    !isBoundedInteger(candidate.checkTimeSec, -1, 86400) ||
    !isBoundedInteger(candidate.startTimeSec, -1, 86400) ||
    !isBoundedInteger(candidate.finishTimeSec, -1, 86400) ||
    !isBoundedInteger(candidate.runningTimeSec, -1, 86400) ||
    typeof candidate.readoutAtIso !== 'string' ||
    candidate.readoutAtIso.length < 1 ||
    candidate.readoutAtIso.length > 40
  ) {
    throw new ReadoutIngestionError(400, 'Readout data is invalid.');
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
    result: {
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
  input: ReadoutIngestionInput,
): boolean {
  return (
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

export async function ingestReadout(
  firestore: Firestore,
  actor: ReadoutIngestionActor,
  competitionIdInput: string,
  receiptIdInput: string,
  inputInput: unknown
): Promise<ReadoutIngestionResult> {
  const competitionId = requireId(competitionIdInput, 'competition ID');
  const receiptId = requireId(receiptIdInput, 'readout receipt ID');
  const actorUid = requireId(actor.uid, 'user ID');
  const input = validateInput(inputInput);

  const competitionRef = firestore.collection('competitions').doc(competitionId);
  const competitorRef = competitionRef.collection('competitors').doc(input.competitorId);
  const receiptRef = competitionRef.collection('readoutReceipts').doc(receiptId);
  const adminRef = firestore.collection('admins').doc(actorUid);
  const officialRef = firestore.collection('roleAssignments').doc(actorUid);
  const receiptCollection = competitionRef.collection('readoutReceipts');
  const publicResultRef = competitionRef
    .collection('publicResults')
    .doc(input.competitorId);

  return firestore.runTransaction(async (transaction) => {
    const [
      competitionSnapshot,
      adminSnapshot,
      officialSnapshot,
      receiptSnapshot,
      competitorSnapshot,
    ] = await Promise.all([
      transaction.get(competitionRef),
      transaction.get(adminRef),
      transaction.get(officialRef),
      transaction.get(receiptRef),
      transaction.get(competitorRef),
    ]);

    if (!competitionSnapshot.exists) {
      throw new ReadoutIngestionError(404, 'Competition was not found.');
    }

    const competition = competitionSnapshot.data() ?? {};
    const adminRole = adminSnapshot.data()?.role;
    const officialRole = officialSnapshot.data()?.role;
    const isSuperAdmin = adminRole === 'SUPER_ADMIN';
    const isRaceAdmin = adminRole === 'RACE_ADMIN';
    if (!isSuperAdmin && !isRaceAdmin && !READOUT_ROLES.has(String(officialRole))) {
      throw new ReadoutIngestionError(403, 'A readout official or club administrator is required.');
    }

    if (receiptSnapshot.exists) {
      const existingReceipt = receiptSnapshot.data() ?? {};
      if (!receiptMatchesPayload(existingReceipt, input)) {
        throw new ReadoutIngestionError(409, 'Readout ID is already used for another readout.');
      }
      if (existingReceipt.status === 'UNKNOWN') {
        return {
          status: 'UNKNOWN',
          competitorId: null,
          duplicateReceiptId: null,
          replayed: true,
        };
      }
      if (
        existingReceipt.status !== 'PROCESSED' ||
        typeof existingReceipt.competitorId !== 'string'
      ) {
        throw new ReadoutIngestionError(409, 'Processed readout receipt is inconsistent.');
      }
      return {
        status: 'PROCESSED',
        competitorId:
          typeof existingReceipt.currentCompetitorId === 'string'
            ? existingReceipt.currentCompetitorId
            : existingReceipt.competitorId,
        duplicateReceiptId: null,
        replayed: true,
      };
    }

    if (competition.status === 'COMPLETED') {
      throw new ReadoutIngestionError(409, 'The competition is completed.');
    }
    if (
      !competitorSnapshot.exists ||
      Number(competitorSnapshot.data()?.siNumber) !== input.siNumber
    ) {
      throw new ReadoutIngestionError(409, 'The selected competitor no longer has this SI number.');
    }

    const matchingReceiptsSnapshot = await transaction.get(
      receiptCollection.where('competitorId', '==', input.competitorId)
    );
    const receiptCandidates: ReadoutReceiptDuplicateCandidate[] =
      matchingReceiptsSnapshot.docs.map((snapshot) => {
        const receipt = snapshot.data();
        return {
          id: snapshot.id,
          status: receipt.status,
          competitorId: receipt.competitorId,
          currentCompetitorId: receipt.currentCompetitorId,
          siNumber: receipt.siNumber,
          cardSeries: receipt.cardSeries,
          startTimeSec: receipt.startTimeSec,
          finishTimeSec: receipt.finishTimeSec,
          punchCodes: receipt.punchCodes,
          punchTimes: receipt.punchTimes,
          rawHex: receipt.rawHex,
        };
      });
    const duplicateReceiptId = findExactProcessedReadoutDuplicateId(
      receiptCandidates,
      receiptId,
      {
        competitorId: input.competitorId,
        siNumber: input.siNumber,
        cardSeries: input.cardSeries,
        startTimeSec: input.startTimeSec,
        finishTimeSec: input.finishTimeSec,
        punchCodes: input.punchCodes,
        punchTimes: input.punchTimes,
        rawHex: input.rawHex,
      }
    );
    if (duplicateReceiptId) {
      const duplicateReceipt = receiptCandidates.find(
        (candidate) => candidate.id === duplicateReceiptId
      );
      return {
        status: 'DUPLICATE',
        competitorId:
          typeof duplicateReceipt?.currentCompetitorId === 'string'
            ? duplicateReceipt.currentCompetitorId
            : input.competitorId,
        duplicateReceiptId,
        replayed: false,
      };
    }

    declareCompetitorMutation({
      source: 'submitReadoutToFirestore',
      operation: 'UPDATE',
      competitionId,
      competitorId: input.competitorId,
      siNumber: input.siNumber,
      assignmentHandling: {
        mode: 'LEGACY',
        reason: 'Readout result update does not validate SI assignment ownership.',
      },
      identityAffecting: false,
    });
    const competitor = competitorSnapshot.data() ?? {};
    const previousStatus = String(competitor.status || 'REGISTERED');
    const wasFinished =
      previousStatus === 'OK' ||
      previousStatus === 'MP' ||
      previousStatus === 'DNF' ||
      previousStatus === 'PRELIMINARY_FIN';
    const finishedCount = Math.max(0, Number(competition.finishedCount) || 0);
    const competitorCount = Math.max(0, Number(competition.competitorCount) || 0);
    const serverTimestamp = FieldValue.serverTimestamp();
    const updatedCompetitor = {
      ...competitor,
      status: input.result.status,
      checkTimeSec: input.result.checkTimeSec,
      startTimeSec: input.result.startTimeSec,
      finishTimeSec: input.result.finishTimeSec,
      runningTimeSec: input.result.runningTimeSec,
    };

    transaction.update(competitorRef, {
      status: input.result.status,
      checkTimeSec: input.result.checkTimeSec,
      startTimeSec: input.result.startTimeSec,
      finishTimeSec: input.result.finishTimeSec,
      runningTimeSec: input.result.runningTimeSec,
      readoutAtIso: input.result.readoutAtIso,
      punchCodes: input.punchCodes,
      punchTimes: input.punchTimes,
      updatedAt: serverTimestamp,
    });
    transaction.set(
      publicResultRef,
      {
        ...createPublicResultDocumentFromFirestore(
          competitionId,
          input.competitorId,
          updatedCompetitor
        ),
        updatedAt: serverTimestamp,
      },
      { merge: true }
    );
    transaction.update(competitionRef, {
      finishedCount: Math.min(
        competitorCount,
        finishedCount + (wasFinished ? 0 : 1)
      ),
      updatedAt: serverTimestamp,
    });
    transaction.create(receiptRef, {
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
      status: 'PROCESSED',
      competitorId: input.competitorId,
      currentCompetitorId: input.competitorId,
      createdAt: serverTimestamp,
    });
    return {
      status: 'PROCESSED',
      competitorId: input.competitorId,
      duplicateReceiptId: null,
      replayed: false,
    };
  });
}
