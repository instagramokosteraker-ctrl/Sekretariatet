import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export interface CompetitionDeletionActor {
  uid: string;
}

export interface CompetitionDeletionResult {
  deletedCompetitorCount: number;
  deletedAssignmentCount: number;
  deletedOtherDocumentCount: number;
}

export class CompetitionDeletionError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'CompetitionDeletionError';
  }
}

const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_TRANSACTION_WRITES = 500;
const COMPETITION_SUBCOLLECTIONS = [
  'courses',
  'classes',
  'competitors',
  'siCardAssignments',
  'readoutReceipts',
  'stations',
  'stationPunches',
] as const;

function requireId(value: string, label: string): string {
  if (!VALID_ID.test(value)) {
    throw new CompetitionDeletionError(400, `Invalid ${label}.`);
  }
  return value;
}

export async function deleteCompetitionWithAssignments(
  firestore: Firestore,
  actor: CompetitionDeletionActor,
  competitionIdInput: string
): Promise<CompetitionDeletionResult> {
  const competitionId = requireId(competitionIdInput, 'competition ID');
  const actorUid = requireId(actor.uid, 'user ID');
  const competitionRef = firestore.collection('competitions').doc(competitionId);
  const adminRef = firestore.collection('admins').doc(actorUid);
  const clubSettingsRef = firestore.collection('clubSettings').doc('default');

  return firestore.runTransaction(async (transaction) => {
    const [competitionSnapshot, adminSnapshot, clubSettingsSnapshot] = await Promise.all([
      transaction.get(competitionRef),
      transaction.get(adminRef),
      transaction.get(clubSettingsRef),
    ]);

    if (!competitionSnapshot.exists) {
      throw new CompetitionDeletionError(404, 'Competition was not found.');
    }

    const adminRole = adminSnapshot.data()?.role;
    const competition = competitionSnapshot.data() ?? {};
    if (adminRole !== 'SUPER_ADMIN' && competition.ownerUid !== actorUid) {
      throw new CompetitionDeletionError(
        403,
        'The caller does not own this competition.'
      );
    }

    const subcollectionSnapshots = await Promise.all(
      COMPETITION_SUBCOLLECTIONS.map((name) =>
        transaction.get(competitionRef.collection(name))
      )
    );
    const documentsToDelete = subcollectionSnapshots.flatMap((snapshot) =>
      snapshot.docs.map((document) => document.ref)
    );
    const fixedWriteCount = 1 + Number(clubSettingsSnapshot.exists);
    const transactionWriteCount = documentsToDelete.length + fixedWriteCount;
    if (transactionWriteCount > MAX_TRANSACTION_WRITES) {
      throw new CompetitionDeletionError(
        409,
        `This competition has too many records for a single atomic deletion (maximum ${MAX_TRANSACTION_WRITES - fixedWriteCount} related records). No data was changed.`
      );
    }

    const counts = new Map(
      COMPETITION_SUBCOLLECTIONS.map((name, index) => [
        name,
        subcollectionSnapshots[index].size,
      ])
    );

    for (const documentRef of documentsToDelete) {
      transaction.delete(documentRef);
    }

    if (clubSettingsSnapshot.exists) {
      const clubSettings = clubSettingsSnapshot.data() ?? {};
      const competitionIds = Array.isArray(clubSettings.competitionIds)
        ? clubSettings.competitionIds.filter(
            (id): id is string => typeof id === 'string' && id !== competitionId
          )
        : [];
      const clubSettingsUpdate: Record<string, unknown> = {
        competitionIds,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (clubSettings.activeEventId === competitionId) {
        clubSettingsUpdate.activeEventId = '';
      }
      transaction.update(clubSettingsRef, clubSettingsUpdate);
    }

    transaction.delete(competitionRef);

    return {
      deletedCompetitorCount: counts.get('competitors') ?? 0,
      deletedAssignmentCount: counts.get('siCardAssignments') ?? 0,
      deletedOtherDocumentCount:
        documentsToDelete.length -
        (counts.get('competitors') ?? 0) -
        (counts.get('siCardAssignments') ?? 0),
    };
  });
}
