import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompetitorWithAssignment,
  type TrustedCompetitorCreateInput,
} from './competitorCreation';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

const createInput: TrustedCompetitorCreateInput = {
  bib: 401,
  fullName: 'Test Runner',
  club: 'Test Club',
  classId: 'cls_open',
  siNumber: 8500190,
  cardSeries: 'SI-Card 10',
  isRentalCard: false,
  rentalReturned: false,
  feePaid: false,
  status: 'REGISTERED',
  allocatedStartSec: -1,
  checkTimeSec: -1,
  startTimeSec: -1,
  finishTimeSec: -1,
  manualFinishTimeSec: -1,
  runningTimeSec: -1,
  readoutAtIso: '',
  punchCodes: [],
  punchTimes: [],
};

emulatorDescribe('createCompetitorWithAssignment', () => {
  const projectId = 'demo-passersi-competitor-create-tests';
  const app = initializeApp({ projectId }, `competitor-create-${randomUUID()}`);
  const firestore = getFirestore(app);

  beforeAll(async () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is required for this test.');
    const [hostname, port] = host.split(':');
    firestore.settings({ host: `${hostname}:${port}`, ssl: false });
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  it('creates the competitor, assignment, counters, and learned RunnerDb entry atomically', async () => {
    const suffix = randomUUID().replace(/-/g, '');
    const competitionId = `evt_${suffix}`;
    const competitorId = `cmp_${suffix}`;
    const ownerUid = `usr_${suffix}`;
    const competitionRef = firestore.collection('competitions').doc(competitionId);
    const adminRef = firestore.collection('admins').doc(ownerUid);

    await adminRef.set({ uid: ownerUid, role: 'RACE_ADMIN' });
    await competitionRef.set({
      competitionId,
      ownerUid,
      status: 'LIVE',
      competitorCount: 0,
      finishedCount: 0,
    });

    try {
      const result = await createCompetitorWithAssignment(
        firestore,
        { uid: ownerUid },
        competitionId,
        competitorId,
        createInput,
        {
          fullName: createInput.fullName,
          club: createInput.club,
          cardSeries: createInput.cardSeries,
          defaultClassName: 'Open',
        }
      );
      const [competitionAfter, competitorAfter, assignmentAfter, runnerAfter] =
        await Promise.all([
          competitionRef.get(),
          competitionRef.collection('competitors').doc(competitorId).get(),
          competitionRef
            .collection('siCardAssignments')
            .doc(String(createInput.siNumber))
            .get(),
          firestore.collection('runnerDb').doc(String(createInput.siNumber)).get(),
        ]);

      expect(competitorAfter.data()).toMatchObject({
        competitorId,
        competitionId,
        ownerUid,
        siNumber: createInput.siNumber,
        cardSeries: createInput.cardSeries,
      });
      expect(assignmentAfter.data()).toMatchObject({
        competitorId,
        competitorDocumentId: competitorId,
        ownerUid,
        state: 'ACTIVE',
      });
      expect(competitionAfter.data()).toMatchObject({
        competitorCount: 1,
        finishedCount: 0,
      });
      expect(runnerAfter.data()).toMatchObject({
        runnerId: String(createInput.siNumber),
        ownerUid,
        fullName: createInput.fullName,
      });
      expect(result.runnerDbEntry).toMatchObject({
        id: String(createInput.siNumber),
        siNumber: createInput.siNumber,
        fullName: createInput.fullName,
      });
    } finally {
      await firestore.recursiveDelete(competitionRef);
      await firestore.collection('runnerDb').doc(String(createInput.siNumber)).delete();
      await adminRef.delete();
    }
  });

  it('moves a selected runner profile to the new SI number when it is not borrowed', async () => {
    const suffix = randomUUID().replace(/-/g, '');
    const competitionId = `evt_${suffix}`;
    const competitorId = `cmp_${suffix}`;
    const ownerUid = `usr_${suffix}`;
    const previousSiNumber = createInput.siNumber + 1;
    const competitionRef = firestore.collection('competitions').doc(competitionId);
    const adminRef = firestore.collection('admins').doc(ownerUid);
    const previousRunnerRef = firestore
      .collection('runnerDb')
      .doc(String(previousSiNumber));
    const nextRunnerRef = firestore
      .collection('runnerDb')
      .doc(String(createInput.siNumber));

    await adminRef.set({ uid: ownerUid, role: 'RACE_ADMIN' });
    await competitionRef.set({
      competitionId,
      ownerUid,
      status: 'LIVE',
      competitorCount: 0,
      finishedCount: 0,
    });
    await previousRunnerRef.set({
      runnerId: String(previousSiNumber),
      siNumber: previousSiNumber,
      fullName: createInput.fullName,
      club: createInput.club,
      cardSeries: createInput.cardSeries,
      birthYear: 2000,
      defaultClassName: 'Open',
      eventorPersonId: '',
      eventorOrgId: '',
      source: 'EVENTOR_API',
      ownerUid,
    });

    try {
      const result = await createCompetitorWithAssignment(
        firestore,
        { uid: ownerUid },
        competitionId,
        competitorId,
        createInput,
        {
          fullName: createInput.fullName,
          club: createInput.club,
          cardSeries: createInput.cardSeries,
          defaultClassName: 'Open',
        },
        String(previousSiNumber)
      );

      expect((await previousRunnerRef.get()).exists).toBe(false);
      expect((await nextRunnerRef.get()).data()).toMatchObject({
        runnerId: String(createInput.siNumber),
        siNumber: createInput.siNumber,
        fullName: createInput.fullName,
        birthYear: 2000,
        source: 'EVENTOR_API',
      });
      expect(result.runnerDbEntry).toMatchObject({
        id: String(createInput.siNumber),
        siNumber: createInput.siNumber,
        fullName: createInput.fullName,
      });
      expect(result.previousRunnerSiNumber).toBe(previousSiNumber);
    } finally {
      await firestore.recursiveDelete(competitionRef);
      await previousRunnerRef.delete();
      await nextRunnerRef.delete();
      await adminRef.delete();
    }
  });

  it('keeps the selected runner profile unchanged when the card is borrowed', async () => {
    const suffix = randomUUID().replace(/-/g, '');
    const competitionId = `evt_${suffix}`;
    const competitorId = `cmp_${suffix}`;
    const ownerUid = `usr_${suffix}`;
    const previousSiNumber = createInput.siNumber + 1;
    const competitionRef = firestore.collection('competitions').doc(competitionId);
    const adminRef = firestore.collection('admins').doc(ownerUid);
    const previousRunnerRef = firestore
      .collection('runnerDb')
      .doc(String(previousSiNumber));
    const nextRunnerRef = firestore
      .collection('runnerDb')
      .doc(String(createInput.siNumber));

    await adminRef.set({ uid: ownerUid, role: 'RACE_ADMIN' });
    await competitionRef.set({
      competitionId,
      ownerUid,
      status: 'LIVE',
      competitorCount: 0,
      finishedCount: 0,
    });
    await previousRunnerRef.set({
      runnerId: String(previousSiNumber),
      siNumber: previousSiNumber,
      fullName: createInput.fullName,
      club: createInput.club,
      cardSeries: createInput.cardSeries,
      defaultClassName: 'Open',
      source: 'EVENTOR_API',
      ownerUid,
    });

    try {
      const result = await createCompetitorWithAssignment(
        firestore,
        { uid: ownerUid },
        competitionId,
        competitorId,
        createInput,
        {
          fullName: createInput.fullName,
          club: createInput.club,
          cardSeries: createInput.cardSeries,
          defaultClassName: 'Open',
        },
        String(previousSiNumber),
        true
      );

      expect((await previousRunnerRef.get()).data()).toMatchObject({
        runnerId: String(previousSiNumber),
        siNumber: previousSiNumber,
        fullName: createInput.fullName,
      });
      expect((await nextRunnerRef.get()).exists).toBe(false);
      expect(result.runnerDbEntry).toBeNull();
      expect(result.previousRunnerSiNumber).toBeNull();
    } finally {
      await firestore.recursiveDelete(competitionRef);
      await previousRunnerRef.delete();
      await nextRunnerRef.delete();
      await adminRef.delete();
    }
  });

  it('rejects assignments with mismatched owner, competitor, document, or SI identity', async () => {
    const cases = [
      {
        name: 'ownerUid',
        assignment: (competitionId: string, competitorId: string, ownerUid: string) => ({
          competitionId,
          siNumber: createInput.siNumber,
          cardSeries: createInput.cardSeries,
          competitorId,
          competitorDocumentId: competitorId,
          state: 'ACTIVE',
          assignmentVersion: 1,
          ownerUid: `${ownerUid}_other`,
          schemaVersion: 1,
        }),
      },
      {
        name: 'competitorId',
        assignment: (competitionId: string, _competitorId: string, ownerUid: string) => ({
          competitionId,
          siNumber: createInput.siNumber,
          cardSeries: createInput.cardSeries,
          competitorId: 'cmp_other',
          competitorDocumentId: 'cmp_other',
          state: 'ACTIVE',
          assignmentVersion: 1,
          ownerUid,
          schemaVersion: 1,
        }),
      },
      {
        name: 'competitorDocumentId',
        assignment: (competitionId: string, competitorId: string, ownerUid: string) => ({
          competitionId,
          siNumber: createInput.siNumber,
          cardSeries: createInput.cardSeries,
          competitorId,
          competitorDocumentId: 'cmp_other',
          state: 'ACTIVE',
          assignmentVersion: 1,
          ownerUid,
          schemaVersion: 1,
        }),
      },
      {
        name: 'siNumber',
        assignment: (competitionId: string, competitorId: string, ownerUid: string) => ({
          competitionId,
          siNumber: createInput.siNumber + 1,
          cardSeries: createInput.cardSeries,
          competitorId,
          competitorDocumentId: competitorId,
          state: 'ACTIVE',
          assignmentVersion: 1,
          ownerUid,
          schemaVersion: 1,
        }),
      },
    ];

    for (const testCase of cases) {
      const suffix = `${testCase.name}_${randomUUID().replace(/-/g, '')}`;
      const competitionId = `evt_${suffix}`;
      const competitorId = `cmp_${suffix}`;
      const ownerUid = `usr_${suffix}`;
      const competitionRef = firestore.collection('competitions').doc(competitionId);
      const adminRef = firestore.collection('admins').doc(ownerUid);
      const assignmentRef = competitionRef
        .collection('siCardAssignments')
        .doc(String(createInput.siNumber));

      await adminRef.set({ uid: ownerUid, role: 'RACE_ADMIN' });
      await competitionRef.set({
        competitionId,
        ownerUid,
        status: 'LIVE',
        competitorCount: 0,
        finishedCount: 0,
      });
      await assignmentRef.set(testCase.assignment(competitionId, competitorId, ownerUid));

      try {
        await expect(
          createCompetitorWithAssignment(
            firestore,
            { uid: ownerUid },
            competitionId,
            competitorId,
            createInput,
            null
          )
        ).rejects.toThrow('assigned to another competitor or owner');
        expect(
          (await competitionRef.collection('competitors').doc(competitorId).get()).exists
        ).toBe(false);
        expect((await competitionRef.get()).data()?.competitorCount).toBe(0);
      } finally {
        await firestore.recursiveDelete(competitionRef);
        await adminRef.delete();
      }
    }
  });
});
