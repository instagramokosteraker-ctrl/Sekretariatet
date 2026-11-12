import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { retireCompetitorWithAssignment } from './siAssignmentRetirement';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

emulatorDescribe('retireCompetitorWithAssignment', () => {
  const projectId = 'demo-passersi-retirement-tests';
  const app = initializeApp({ projectId }, `si-assignment-retirement-${randomUUID()}`);
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

  it('retires the matching assignment and competitor atomically', async () => {
    const suffix = randomUUID().replace(/-/g, '');
    const competitionId = `evt_${suffix}`;
    const competitorId = `cmp_${suffix}`;
    const ownerUid = `usr_${suffix}`;
    const siNumber = 8500111;
    const competitionRef = firestore.collection('competitions').doc(competitionId);
    const competitorRef = competitionRef.collection('competitors').doc(competitorId);
    const assignmentRef = competitionRef
      .collection('siCardAssignments')
      .doc(String(siNumber));
    const adminRef = firestore.collection('admins').doc(ownerUid);
    const now = Timestamp.now();

    await adminRef.set({ uid: ownerUid, role: 'RACE_ADMIN' });
    await competitionRef.set({
      competitionId,
      ownerUid,
      status: 'LIVE',
      finishedCount: 1,
    });
    await competitorRef.set({
      competitionId,
      competitorId,
      ownerUid,
      siNumber,
      cardSeries: 'SI-Card 10',
      status: 'PRELIMINARY_FIN',
      updatedAt: now,
    });
    await assignmentRef.set({
      competitionId,
      siNumber,
      cardSeries: 'SI-Card 10',
      competitorId,
      competitorDocumentId: competitorId,
      state: 'ACTIVE',
      assignmentVersion: 1,
      source: 'DIRECT_ENTRY',
      ownerUid,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await retireCompetitorWithAssignment(
        firestore,
        { uid: ownerUid },
        competitionId,
        competitorId,
        'test-retirement'
      );

      const [competitionAfter, competitorAfter, assignmentAfter] = await Promise.all([
        competitionRef.get(),
        competitorRef.get(),
        assignmentRef.get(),
      ]);
      expect(competitorAfter.data()?.status).toBe('DNF');
      expect(assignmentAfter.data()?.state).toBe('RETIRED');
      expect(assignmentAfter.data()?.assignmentVersion).toBe(2);
      expect(assignmentAfter.data()?.retirementReason).toBe('test-retirement');
      expect(competitionAfter.data()?.finishedCount).toBe(0);
    } finally {
      await firestore.recursiveDelete(competitionRef);
      await adminRef.delete();
    }
  });

  it('rejects a retirement by an administrator who does not own the competition', async () => {
    const suffix = randomUUID().replace(/-/g, '');
    const competitionId = `evt_${suffix}`;
    const competitorId = `cmp_${suffix}`;
    const ownerUid = `usr_${suffix}`;
    const actorUid = `usr_other_${suffix}`;
    const siNumber = 8500112;
    const competitionRef = firestore.collection('competitions').doc(competitionId);
    const competitorRef = competitionRef.collection('competitors').doc(competitorId);
    const adminRef = firestore.collection('admins').doc(actorUid);
    const assignmentRef = competitionRef
      .collection('siCardAssignments')
      .doc(String(siNumber));
    const now = Timestamp.now();

    await adminRef.set({ uid: actorUid, role: 'RACE_ADMIN' });
    await competitionRef.set({
      competitionId,
      ownerUid,
      status: 'LIVE',
      finishedCount: 0,
    });
    await competitorRef.set({
      competitionId,
      competitorId,
      ownerUid,
      siNumber,
      cardSeries: 'SI-Card 10',
      status: 'REGISTERED',
      updatedAt: now,
    });
    await assignmentRef.set({
      competitionId,
      siNumber,
      cardSeries: 'SI-Card 10',
      competitorId,
      competitorDocumentId: competitorId,
      state: 'ACTIVE',
      assignmentVersion: 1,
      source: 'DIRECT_ENTRY',
      ownerUid,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await expect(
        retireCompetitorWithAssignment(
          firestore,
          { uid: `usr_unregistered_${suffix}` },
          competitionId,
          competitorId
        )
      ).rejects.toThrow('A club administrator is required.');
      await expect(
        retireCompetitorWithAssignment(
          firestore,
          { uid: actorUid },
          competitionId,
          competitorId
        )
      ).rejects.toThrow('The caller does not own this competition.');
      expect((await assignmentRef.get()).data()?.state).toBe('ACTIVE');
      expect((await competitorRef.get()).data()?.status).toBe('REGISTERED');
    } finally {
      await firestore.recursiveDelete(competitionRef);
      await adminRef.delete();
    }
  });
});
