import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { SI_CARD_ASSIGNMENT_SCHEMA_VERSION } from '../types/sportident';

export interface SIAssignmentRetirementActor {
  uid: string;
}

export class SIAssignmentRetirementError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'SIAssignmentRetirementError';
  }
}

const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const FINISHED_STATUSES = new Set(['OK', 'MP', 'PRELIMINARY_FIN']);

function requireId(value: string, label: string): string {
  if (!VALID_ID.test(value)) {
    throw new SIAssignmentRetirementError(400, `Invalid ${label}.`);
  }
  return value;
}

export async function retireCompetitorWithAssignment(
  firestore: Firestore,
  actor: SIAssignmentRetirementActor,
  competitionIdInput: string,
  competitorIdInput: string,
  retirementReasonInput?: unknown
): Promise<void> {
  const competitionId = requireId(competitionIdInput, 'competition ID');
  const competitorId = requireId(competitorIdInput, 'competitor ID');
  const retirementReason =
    typeof retirementReasonInput === 'string' && retirementReasonInput.trim()
      ? retirementReasonInput.trim().slice(0, 200)
      : 'competitor_retired';
  const competitionRef = firestore.collection('competitions').doc(competitionId);
  const competitorRef = competitionRef.collection('competitors').doc(competitorId);
  const adminRef = firestore.collection('admins').doc(requireId(actor.uid, 'user ID'));

  await firestore.runTransaction(async (transaction) => {
    const [competitionSnapshot, competitorSnapshot, adminSnapshot] = await Promise.all([
      transaction.get(competitionRef),
      transaction.get(competitorRef),
      transaction.get(adminRef),
    ]);
    if (!competitionSnapshot.exists || !competitorSnapshot.exists) {
      throw new SIAssignmentRetirementError(404, 'Competition or competitor was not found.');
    }
    const adminRole = adminSnapshot.data()?.role;
    if (
      adminRole !== 'RACE_ADMIN' &&
      adminRole !== 'SUPER_ADMIN'
    ) {
      throw new SIAssignmentRetirementError(403, 'A club administrator is required.');
    }

    const competition = competitionSnapshot.data() ?? {};
    const competitor = competitorSnapshot.data() ?? {};
    if (
      adminRole !== 'SUPER_ADMIN' &&
      competition.ownerUid !== actor.uid
    ) {
      throw new SIAssignmentRetirementError(403, 'The caller does not own this competition.');
    }
    if (
      competition.status === 'COMPLETED' &&
      adminRole !== 'SUPER_ADMIN'
    ) {
      throw new SIAssignmentRetirementError(
        409,
        'Competitors cannot be retired from a completed competition.'
      );
    }
    if (
      competitor.competitionId !== competitionId ||
      competitor.competitorId !== competitorId ||
      !Number.isInteger(competitor.siNumber) ||
      Number(competitor.siNumber) < 1 ||
      Number(competitor.siNumber) > 99999999 ||
      typeof competitor.cardSeries !== 'string' ||
      competitor.cardSeries.length < 1 ||
      competitor.cardSeries.length > 24 ||
      typeof competitor.ownerUid !== 'string' ||
      !VALID_ID.test(competitor.ownerUid)
    ) {
      throw new SIAssignmentRetirementError(409, 'Competitor identity is invalid.');
    }

    const siNumber = Number(competitor.siNumber);
    const assignmentRef = competitionRef
      .collection('siCardAssignments')
      .doc(String(siNumber));
    const assignmentSnapshot = await transaction.get(assignmentRef);
    const assignment = assignmentSnapshot.data();

    if (assignmentSnapshot.exists) {
      if (
        !assignment ||
        assignment.competitionId !== competitionId ||
        assignment.siNumber !== siNumber ||
        assignment.competitorId !== competitorId ||
        assignment.competitorDocumentId !== competitorId ||
        assignment.cardSeries !== competitor.cardSeries ||
        assignment.ownerUid !== competitor.ownerUid ||
        assignment.schemaVersion !== SI_CARD_ASSIGNMENT_SCHEMA_VERSION ||
        !Number.isInteger(assignment.assignmentVersion) ||
        Number(assignment.assignmentVersion) < 1 ||
        Number(assignment.assignmentVersion) > 65535 ||
        (assignment.state !== 'ACTIVE' && assignment.state !== 'RETIRED')
      ) {
        throw new SIAssignmentRetirementError(
          409,
          'SI assignment does not match the competitor identity.'
        );
      }
      if (
        assignment.state === 'ACTIVE' &&
        Number(assignment.assignmentVersion) >= 65535
      ) {
        throw new SIAssignmentRetirementError(409, 'SI assignment version limit reached.');
      }
    }

    const currentStatus =
      typeof competitor.status === 'string' ? competitor.status : '';
    const nextStatus =
      currentStatus === 'IN_FOREST' || currentStatus === 'PRELIMINARY_FIN'
        ? 'DNF'
        : currentStatus === 'OK' || currentStatus === 'MP' || currentStatus === 'DNF'
          ? currentStatus
          : 'DNS';
    const wasFinished = FINISHED_STATUSES.has(currentStatus);
    const willBeFinished = FINISHED_STATUSES.has(nextStatus);
    const updatedAt = FieldValue.serverTimestamp();

    if (!assignmentSnapshot.exists) {
      transaction.create(assignmentRef, {
        competitionId,
        siNumber,
        cardSeries: competitor.cardSeries,
        competitorId,
        competitorDocumentId: competitorId,
        state: 'RETIRED',
        assignmentVersion: 1,
        source: 'SYSTEM',
        ownerUid: competitor.ownerUid,
        schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
        createdAt: updatedAt,
        updatedAt,
        retiredAt: updatedAt,
        retirementReason,
      });
    } else if (assignment?.state === 'ACTIVE') {
      transaction.update(assignmentRef, {
        state: 'RETIRED',
        assignmentVersion: Number(assignment.assignmentVersion) + 1,
        updatedAt,
        retiredAt: updatedAt,
        retirementReason,
      });
    }

    transaction.update(competitorRef, { status: nextStatus, updatedAt });
    if (wasFinished !== willBeFinished) {
      const currentFinishedCount = Number(competition.finishedCount);
      if (!Number.isInteger(currentFinishedCount) || currentFinishedCount < 0) {
        throw new SIAssignmentRetirementError(409, 'Competition finished counter is invalid.');
      }
      transaction.update(competitionRef, {
        finishedCount: Math.max(
          0,
          currentFinishedCount + (willBeFinished ? 1 : -1)
        ),
        updatedAt,
      });
    }
  });
}
