import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export interface ManualResultApprovalInput {
  operationId: string;
  reason: string;
}

export interface ManualResultApprovalActor {
  uid: string;
  role: 'SUPER_ADMIN' | 'RACE_ADMIN' | 'READOUT' | 'FOREST';
}

export interface ManualResultApprovalResult {
  status: 'APPROVED' | 'REPLAYED';
  competitorId: string;
  previousStatus: 'PRELIMINARY_FIN';
  newStatus: 'OK';
  operationId: string;
}

export class ManualResultApprovalError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ManualResultApprovalError';
  }
}

const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export async function approveManualResult(
  firestore: Firestore,
  actor: ManualResultApprovalActor,
  competitionIdInput: string,
  competitorIdInput: string,
  inputInput: unknown
): Promise<ManualResultApprovalResult> {
  if (!VALID_ID.test(competitionIdInput)) {
    throw new ManualResultApprovalError(400, 'Invalid competition ID.');
  }
  if (!VALID_ID.test(competitorIdInput)) {
    throw new ManualResultApprovalError(400, 'Invalid competitor ID.');
  }
  if (!inputInput || typeof inputInput !== 'object' || Array.isArray(inputInput)) {
    throw new ManualResultApprovalError(400, 'Approval data is invalid.');
  }
  const input = inputInput as Record<string, unknown>;
  if (
    typeof input.operationId !== 'string' ||
    !VALID_ID.test(input.operationId) ||
    typeof input.reason !== 'string' ||
    input.reason.trim().length < 3 ||
    input.reason.trim().length > 500
  ) {
    throw new ManualResultApprovalError(
      400,
      'A valid operation ID and approval reason are required.'
    );
  }

  const operationId = input.operationId;
  const reason = input.reason.trim();
  const competitionRef = firestore.collection('competitions').doc(competitionIdInput);
  const competitorRef = competitionRef.collection('competitors').doc(competitorIdInput);
  const approvalRef = competitorRef.collection('manualResultApprovals').doc(operationId);
  const auditRef = competitorRef.collection('resultAudit').doc(operationId);

  return firestore.runTransaction(async (transaction) => {
    const [competitionSnapshot, competitorSnapshot, approvalSnapshot] = await Promise.all([
      transaction.get(competitionRef),
      transaction.get(competitorRef),
      transaction.get(approvalRef),
    ]);

    if (!competitionSnapshot.exists) {
      throw new ManualResultApprovalError(404, 'Competition was not found.');
    }
    if (!competitorSnapshot.exists) {
      throw new ManualResultApprovalError(404, 'Competitor was not found.');
    }
    if (approvalSnapshot.exists) {
      const approval = approvalSnapshot.data() ?? {};
      if (
        approval.reason !== reason ||
        approval.competitorId !== competitorIdInput ||
        approval.operationId !== operationId
      ) {
        throw new ManualResultApprovalError(409, 'Approval operation was used for a different approval.');
      }
      return {
        status: 'REPLAYED',
        competitorId: competitorIdInput,
        previousStatus: 'PRELIMINARY_FIN',
        newStatus: 'OK',
        operationId,
      };
    }

    const competition = competitionSnapshot.data() ?? {};
    if (competition.status === 'COMPLETED' && actor.role !== 'SUPER_ADMIN') {
      throw new ManualResultApprovalError(409, 'Completed competitions cannot be approved.');
    }
    if (
      actor.role !== 'SUPER_ADMIN' &&
      actor.role !== 'RACE_ADMIN' &&
      actor.role !== 'READOUT' &&
      actor.role !== 'FOREST'
    ) {
      throw new ManualResultApprovalError(403, 'A result administrator or readout official is required.');
    }
    if (
      actor.role === 'RACE_ADMIN' &&
      competition.ownerUid &&
      competition.ownerUid !== actor.uid
    ) {
      throw new ManualResultApprovalError(403, 'The caller does not own this competition.');
    }

    const competitor = competitorSnapshot.data() ?? {};
    if (competitor.status !== 'PRELIMINARY_FIN') {
      throw new ManualResultApprovalError(409, 'Only PRELIMINARY_FIN results can be manually approved.');
    }
    const manualFinishTime =
      typeof competitor.manualFinishTimeSec === 'number' && competitor.manualFinishTimeSec >= 0
        ? competitor.manualFinishTimeSec
        : typeof competitor.finishTimeSec === 'number' && competitor.finishTimeSec >= 0
          ? competitor.finishTimeSec
          : null;
    if (manualFinishTime === null) {
      throw new ManualResultApprovalError(400, 'A valid finish time is required.');
    }

    const timestamp = FieldValue.serverTimestamp();
    const approvalData = {
      operationId,
      action: 'MANUAL_RESULT_APPROVAL',
      competitionId: competitionIdInput,
      competitorId: competitorIdInput,
      previousStatus: 'PRELIMINARY_FIN',
      newStatus: 'OK',
      verification: 'MANUALLY_APPROVED_OK',
      finishTimeSec: manualFinishTime,
      manualFinishSource: 'Manuell måltid (Reservklocka)',
      reason,
      actorUid: actor.uid,
      actorRole: actor.role,
      createdAt: timestamp,
    };
    transaction.create(approvalRef, approvalData);
    transaction.create(auditRef, {
      ...approvalData,
      auditAction: 'MANUAL_RESULT_APPROVAL',
      createdAt: timestamp,
    });
    transaction.update(competitorRef, {
      status: 'OK',
      resultVerification: 'MANUALLY_APPROVED_OK',
      originalResultStatus: 'PRELIMINARY_FIN',
      originalStatusHistory: FieldValue.arrayUnion({
        status: 'PRELIMINARY_FIN',
        source: 'MANUAL_FINISH',
        recordedAt: timestamp,
      }),
      updatedAt: timestamp,
    });
    transaction.set(
      competitionRef.collection('publicResults').doc(competitorIdInput),
      {
        status: 'OK',
        updatedAt: timestamp,
      },
      { merge: true }
    );
    return {
      status: 'APPROVED',
      competitorId: competitorIdInput,
      previousStatus: 'PRELIMINARY_FIN',
      newStatus: 'OK',
      operationId,
    };
  });
}
