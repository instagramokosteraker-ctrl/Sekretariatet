import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  reassignReadoutResult,
  ReadoutReassignmentError,
} from './readoutReassignment';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

emulatorDescribe('reassignReadoutResult', () => {
  const projectId = 'demo-passersi-readout-reassignment-tests';
  const app = initializeApp({ projectId }, `readout-reassignment-${randomUUID()}`);
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

  async function seedReassignment(options?: {
    authorized?: boolean;
    targetExists?: boolean;
    sourceStatus?: 'OK' | 'MP' | 'PRELIMINARY_FIN';
  }) {
    const suffix = randomUUID().replace(/-/g, '');
    const competitionId = `evt_${suffix}`;
    const actorUid = `usr_${suffix}`;
    const annaId = `cmp_anna_${suffix}`;
    const erikId = `cmp_erik_${suffix}`;
    const readoutId = `ro_${suffix}`;
    const operationId = `rr_${suffix}`;
    const competitionRef = firestore.collection('competitions').doc(competitionId);
    const sourceRef = competitionRef.collection('competitors').doc(annaId);
    const targetRef = competitionRef.collection('competitors').doc(erikId);
    const receiptRef = competitionRef.collection('readoutReceipts').doc(readoutId);
    const correctionsRef = competitionRef.collection('readoutCorrections');
    const sourcePublicRef = competitionRef.collection('publicResults').doc(annaId);
    const targetPublicRef = competitionRef.collection('publicResults').doc(erikId);
    const adminRef = firestore.collection('admins').doc(actorUid);
    const roleRef = firestore.collection('roleAssignments').doc(actorUid);
    const now = new Date('2026-11-19T10:00:00.000Z');
    const sourceStatus = options?.sourceStatus ?? 'OK';
    const receiptData = {
      receiptId: readoutId,
      clientReadoutId: readoutId,
      competitionId,
      ownerUid: actorUid,
      siNumber: 510123,
      cardSeries: 'SI-Card 9',
      stationCode: 8,
      checkTimeSec: -1,
      startTimeSec: 36000,
      finishTimeSec: 40000,
      punchCodes: [31],
      punchTimes: [37000],
      rawHex: '010203',
      status: 'PROCESSED',
      competitorId: annaId,
      createdAt: now,
    };
    const sourceData = {
      competitorId: annaId,
      competitionId,
      ownerUid: actorUid,
      bib: 1,
      fullName: 'Anna',
      club: 'Klubb',
      classId: 'cls_1',
      siNumber: 510123,
      cardSeries: 'SI-Card 9',
      isRentalCard: false,
      rentalReturned: false,
      status: sourceStatus,
      allocatedStartSec: -1,
      checkTimeSec: -1,
      startTimeSec: 36000,
      finishTimeSec: 40000,
      manualFinishTimeSec: -1,
      runningTimeSec: 4000,
      readoutAtIso: now.toISOString(),
      punchCodes: [31],
      punchTimes: [37000],
    };
    const targetData = {
      competitorId: erikId,
      competitionId,
      ownerUid: actorUid,
      bib: 2,
      fullName: 'Erik',
      club: 'Klubb',
      classId: 'cls_1',
      siNumber: 510999,
      cardSeries: 'SI-Card 9',
      isRentalCard: false,
      rentalReturned: false,
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
    await Promise.all([
      competitionRef.set({
        competitionId,
        ownerUid: actorUid,
        status: 'LIVE',
        zeroTimeSec: 36000,
        brokenControls: [],
        controlTimeOffsets: {},
        competitorCount: 2,
        finishedCount: 1,
      }),
      options?.authorized === false
        ? roleRef.set({ uid: actorUid, role: 'START' })
        : roleRef.set({ uid: actorUid, role: 'READOUT' }),
      sourceRef.set(sourceData),
      options?.targetExists === false ? Promise.resolve() : targetRef.set(targetData),
      receiptRef.set(receiptData),
      competitionRef.collection('courses').doc('crs_1').set({
        courseId: 'crs_1',
        name: 'Bana 1',
        lengthMeters: 5000,
        climbMeters: 100,
        controls: [31],
      }),
      competitionRef.collection('classes').doc('cls_1').set({
        classId: 'cls_1',
        name: 'D21',
        courseId: 'crs_1',
        classFormat: 'STANDARD',
        forkCourseIds: [],
        rogainingMaxTimeSec: -1,
        rogainingPenaltyPerMin: -1,
        allowDirectEntry: true,
        freeStart: false,
        autoMatchCourse: false,
      }),
      sourcePublicRef.set({
        competitionId,
        competitorId: annaId,
        bib: 1,
        fullName: 'Anna',
        club: 'Klubb',
        classId: 'cls_1',
        status: sourceStatus,
        allocatedStartSec: -1,
        startTimeSec: 36000,
        finishTimeSec: 40000,
        runningTimeSec: 4000,
        radioSplits: [{ controlCode: 52, stationName: 'Radio', punchTimeSec: 38000 }],
      }),
      targetPublicRef.set({
        competitionId,
        competitorId: erikId,
        bib: 2,
        fullName: 'Erik',
        club: 'Klubb',
        classId: 'cls_1',
        status: 'REGISTERED',
        allocatedStartSec: -1,
        startTimeSec: -1,
        finishTimeSec: -1,
        runningTimeSec: -1,
        radioSplits: [{ controlCode: 54, stationName: 'Radio 2', punchTimeSec: 39000 }],
      }),
    ]);

    return {
      competitionId,
      actorUid,
      annaId,
      erikId,
      readoutId,
      operationId,
      competitionRef,
      sourceRef,
      targetRef,
      receiptRef,
      correctionsRef,
      sourcePublicRef,
      targetPublicRef,
      receiptData,
      async cleanup() {
        await firestore.recursiveDelete(competitionRef);
        await Promise.all([adminRef.delete(), roleRef.delete()]);
      },
    };
  }

  function request(fixture: Awaited<ReturnType<typeof seedReassignment>>) {
    return {
      operationId: fixture.operationId,
      targetCompetitorId: fixture.erikId,
      reason: 'Readout used by the wrong runner',
    };
  }

  it.each(['OK', 'MP', 'PRELIMINARY_FIN'] as const)(
    'reassigns Anna’s %s result to Erik and preserves readout and radio data',
    async (sourceStatus) => {
      const fixture = await seedReassignment({ sourceStatus });
      try {
        const result = await reassignReadoutResult(
          firestore,
          { uid: fixture.actorUid },
          fixture.competitionId,
          fixture.readoutId,
          request(fixture)
        );

        expect(result).toMatchObject({
          status: 'APPLIED',
          originalCompetitorId: fixture.annaId,
          correctedCompetitorId: fixture.erikId,
          audit: {
            actorUid: fixture.actorUid,
            actorRole: 'READOUT',
            reason: 'Readout used by the wrong runner',
            originalCompetitor: { id: fixture.annaId, name: 'Anna' },
            correctedCompetitor: { id: fixture.erikId, name: 'Erik' },
            result: {
              status: 'APPLIED',
              previousStatus: sourceStatus,
              newStatus: sourceStatus,
            },
          },
        });
        expect((await fixture.sourceRef.get()).data()).toMatchObject({
          status: 'REGISTERED',
          finishTimeSec: -1,
          punchCodes: [],
          siNumber: 510123,
        });
        expect((await fixture.targetRef.get()).data()).toMatchObject({
          status: sourceStatus,
          finishTimeSec: 40000,
          runningTimeSec: 4000,
          punchCodes: [31],
          siNumber: 510999,
        });
        const savedReceipt = (await fixture.receiptRef.get()).data();
        expect(savedReceipt).toBeDefined();
        const { createdAt: savedCreatedAt, ...savedReceiptData } = savedReceipt ?? {};
        const { createdAt: originalCreatedAt, ...originalReceiptData } =
          fixture.receiptData;
        expect(savedReceiptData).toEqual(originalReceiptData);
        expect(savedCreatedAt).toBeInstanceOf(Timestamp);
        expect((savedCreatedAt as Timestamp).toDate()).toEqual(originalCreatedAt);
        expect((await fixture.sourcePublicRef.get()).data()?.radioSplits).toHaveLength(1);
        expect((await fixture.targetPublicRef.get()).data()?.radioSplits).toHaveLength(1);
        expect((await fixture.correctionsRef.doc(fixture.operationId).get()).exists).toBe(true);
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it.each(['OK', 'MP', 'PRELIMINARY_FIN'] as const)(
    'replays the same %s reassignment without duplicating audit or result changes',
    async (sourceStatus) => {
      const fixture = await seedReassignment({ sourceStatus });
      try {
        const first = await reassignReadoutResult(
          firestore,
          { uid: fixture.actorUid },
          fixture.competitionId,
          fixture.readoutId,
          request(fixture)
        );
        const replay = await reassignReadoutResult(
          firestore,
          { uid: fixture.actorUid },
          fixture.competitionId,
          fixture.readoutId,
          request(fixture)
        );
        expect(replay.status).toBe('REPLAYED');
        expect(replay.audit).toEqual(first.audit);
        expect((await fixture.correctionsRef.get()).size).toBe(1);
        await expect(
          reassignReadoutResult(
            firestore,
            { uid: fixture.actorUid },
            fixture.competitionId,
            fixture.readoutId,
            { ...request(fixture), reason: 'A different reason' }
          )
        ).rejects.toMatchObject({ statusCode: 409 });
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it('rejects an unauthorized role without changing competitors', async () => {
    const fixture = await seedReassignment({ authorized: false });
    try {
      await expect(
        reassignReadoutResult(
          firestore,
          { uid: fixture.actorUid },
          fixture.competitionId,
          fixture.readoutId,
          request(fixture)
        )
      ).rejects.toMatchObject<Partial<ReadoutReassignmentError>>({ statusCode: 403 });
      expect((await fixture.sourceRef.get()).data()?.status).toBe('OK');
      expect((await fixture.targetRef.get()).data()?.status).toBe('REGISTERED');
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects a target competitor that does not exist', async () => {
    const fixture = await seedReassignment({ targetExists: false });
    try {
      await expect(
        reassignReadoutResult(
          firestore,
          { uid: fixture.actorUid },
          fixture.competitionId,
          fixture.readoutId,
          request(fixture)
        )
      ).rejects.toMatchObject({ statusCode: 404 });
      expect((await fixture.sourceRef.get()).data()?.status).toBe('OK');
      expect((await fixture.correctionsRef.get()).size).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it('logs the evaluated ambiguity guard branches and receipt details', async () => {
    const fixture = await seedReassignment();
    const targetReceiptId = `ro_target_${randomUUID().replace(/-/g, '')}`;
    const targetReceiptRef = fixture.competitionRef
      .collection('readoutReceipts')
      .doc(targetReceiptId);
    try {
      await targetReceiptRef.set({
        ...fixture.receiptData,
        receiptId: targetReceiptId,
        clientReadoutId: targetReceiptId,
        competitorId: fixture.erikId,
      });
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await expect(
          reassignReadoutResult(
            firestore,
            { uid: fixture.actorUid },
            fixture.competitionId,
            fixture.readoutId,
            request(fixture)
          )
        ).rejects.toMatchObject({
          statusCode: 409,
          message:
            'Multiple or previously reassigned readouts make this correction ambiguous.',
        });

        expect(warning).toHaveBeenCalledWith(
          '[readout-reassignment] Ambiguity guard diagnostics',
          expect.objectContaining({
            readoutId: fixture.readoutId,
            sourceCompetitorId: fixture.annaId,
            targetCompetitorId: fixture.erikId,
            competingSourceReceipts: [
              { id: fixture.readoutId, status: 'PROCESSED' },
            ],
            competingTargetReceipts: [
              { id: targetReceiptId, status: 'PROCESSED' },
            ],
            priorReassignment: false,
            branches: {
              sourceReceiptCountNotOne: false,
              sourceReceiptIdMismatch: false,
              targetReceiptCountGreaterThanZero: true,
              priorReassignment: false,
            },
          })
        );
      } finally {
        warning.mockRestore();
      }
    } finally {
      await fixture.cleanup();
    }
  });
});
