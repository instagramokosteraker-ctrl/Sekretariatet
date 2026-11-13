import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CompetitionDeletionError,
  deleteCompetitionWithAssignments,
} from './competitionDeletion';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

emulatorDescribe('deleteCompetitionWithAssignments', () => {
  const projectId = 'demo-passersi-competition-deletion-tests';
  const app = initializeApp({ projectId }, `competition-deletion-${randomUUID()}`);
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

  it('deletes competition documents and clears club pointers atomically for its owner', async () => {
    const suffix = randomUUID().replace(/-/g, '');
    const competitionId = `evt_${suffix}`;
    const ownerUid = `usr_${suffix}`;
    const competitionRef = firestore.collection('competitions').doc(competitionId);
    const clubSettingsRef = firestore.collection('clubSettings').doc('default');
    const collections = [
      'courses',
      'classes',
      'competitors',
      'siCardAssignments',
      'readoutReceipts',
      'stations',
      'stationPunches',
    ];

    await competitionRef.set({ competitionId, ownerUid });
    await clubSettingsRef.set({
      competitionIds: [competitionId, 'another_competition'],
      activeEventId: competitionId,
    });
    const batch = firestore.batch();
    for (const collectionName of collections) {
      batch.set(competitionRef.collection(collectionName).doc('record'), { record: true });
    }
    await batch.commit();

    try {
      const result = await deleteCompetitionWithAssignments(
        firestore,
        { uid: ownerUid },
        competitionId
      );

      expect(result).toEqual({
        deletedCompetitorCount: 1,
        deletedAssignmentCount: 1,
        deletedOtherDocumentCount: 5,
      });
      expect((await competitionRef.get()).exists).toBe(false);
      for (const collectionName of collections) {
        expect((await competitionRef.collection(collectionName).get()).empty).toBe(true);
      }
      const clubSettings = (await clubSettingsRef.get()).data();
      expect(clubSettings?.competitionIds).toEqual(['another_competition']);
      expect(clubSettings?.activeEventId).toBe('');
    } finally {
      await firestore.recursiveDelete(competitionRef);
      await clubSettingsRef.delete();
    }
  }, 20_000);

  it('rejects a non-owner administrator without changing the competition', async () => {
    const suffix = randomUUID().replace(/-/g, '');
    const competitionId = `evt_${suffix}`;
    const ownerUid = `usr_owner_${suffix}`;
    const actorUid = `usr_actor_${suffix}`;
    const competitionRef = firestore.collection('competitions').doc(competitionId);
    const adminRef = firestore.collection('admins').doc(actorUid);

    await competitionRef.set({ competitionId, ownerUid });
    await adminRef.set({ uid: actorUid, role: 'RACE_ADMIN' });

    try {
      await expect(
        deleteCompetitionWithAssignments(firestore, { uid: actorUid }, competitionId)
      ).rejects.toMatchObject({ statusCode: 403 });
      expect((await competitionRef.get()).exists).toBe(true);
    } finally {
      await firestore.recursiveDelete(competitionRef);
      await adminRef.delete();
    }
  });

  it('fails closed when associated documents exceed the atomic write limit', async () => {
    const suffix = randomUUID().replace(/-/g, '');
    const competitionId = `evt_${suffix}`;
    const ownerUid = `usr_${suffix}`;
    const competitionRef = firestore.collection('competitions').doc(competitionId);
    const clubSettingsRef = firestore.collection('clubSettings').doc('default');
    const assignmentsRef = competitionRef.collection('siCardAssignments');

    await competitionRef.set({ competitionId, ownerUid });
    await clubSettingsRef.set({ competitionIds: [competitionId] });
    let batch = firestore.batch();
    for (let index = 0; index < 499; index += 1) {
      batch.set(assignmentsRef.doc(`assignment-${index}`), { index });
      if ((index + 1) % 450 === 0) {
        await batch.commit();
        batch = firestore.batch();
      }
    }
    await batch.commit();

    try {
      await expect(
        deleteCompetitionWithAssignments(firestore, { uid: ownerUid }, competitionId)
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('maximum 498 related records'),
      } satisfies Partial<CompetitionDeletionError>);
      expect((await competitionRef.get()).exists).toBe(true);
      expect((await assignmentsRef.get()).size).toBe(499);
    } finally {
      await firestore.recursiveDelete(competitionRef);
      await clubSettingsRef.delete();
    }
  }, 20_000);
});
