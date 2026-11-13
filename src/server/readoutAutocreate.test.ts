import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createReadoutCompetitorFromRunnerDb,
  type ReadoutAutoCreateInput,
} from './readoutAutocreate';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

emulatorDescribe('createReadoutCompetitorFromRunnerDb', () => {
  const projectId = 'demo-passersi-readout-autocreate-tests';
  const app = initializeApp({ projectId }, `readout-autocreate-${randomUUID()}`);
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

  async function seedReadout(input?: {
    expectedName?: string;
    assignmentOwnerUid?: string;
  }) {
    const suffix = randomUUID().replace(/-/g, '');
    const competitionId = `evt_${suffix}`;
    const competitorId = `cmp_${suffix}`;
    const receiptId = `ro_${suffix}`;
    const actorUid = `usr_${suffix}`;
    const siNumber = 85000000 + Math.floor(Math.random() * 1000000);
    const competitionRef = firestore.collection('competitions').doc(competitionId);
    const competitorRef = competitionRef.collection('competitors').doc(competitorId);
    const assignmentRef = competitionRef
      .collection('siCardAssignments')
      .doc(String(siNumber));
    const receiptRef = competitionRef.collection('readoutReceipts').doc(receiptId);
    const runnerRef = firestore.collection('runnerDb').doc(String(siNumber));
    const officialRef = firestore.collection('roleAssignments').doc(actorUid);

    await Promise.all([
      officialRef.set({ uid: actorUid, role: 'READOUT' }),
      competitionRef.set({
        competitionId,
        ownerUid: `usr_owner_${suffix}`,
        status: 'LIVE',
        competitorCount: 0,
        finishedCount: 0,
      }),
      runnerRef.set({
        runnerId: String(siNumber),
        siNumber,
        fullName: 'Readout Runner',
        club: 'Readout Club',
        cardSeries: 'SI-Card 10',
      }),
    ]);

    if (input?.assignmentOwnerUid) {
      await assignmentRef.set({
        competitionId,
        siNumber,
        cardSeries: 'SI-Card 10',
        competitorId: `cmp_other_${suffix}`,
        competitorDocumentId: `cmp_other_${suffix}`,
        state: 'ACTIVE',
        assignmentVersion: 1,
        source: 'DIRECT_ENTRY',
        ownerUid: input.assignmentOwnerUid,
        schemaVersion: 1,
      });
    }

    const request: ReadoutAutoCreateInput = {
      competitorId,
      siNumber,
      cardSeries: 'SI-Card 10',
      stationCode: 1,
      checkTimeSec: -1,
      startTimeSec: 36000,
      finishTimeSec: 40000,
      punchCodes: [31, 32],
      punchTimes: [37000, 38000],
      rawHex: '012345',
      expectedRunnerDb: {
        fullName: input?.expectedName ?? 'Readout Runner',
        club: 'Readout Club',
        cardSeries: 'SI-Card 10',
      },
      competitor: {
        classId: 'cls_open',
        status: 'OK',
        checkTimeSec: -1,
        startTimeSec: 36000,
        finishTimeSec: 40000,
        runningTimeSec: 4000,
        readoutAtIso: new Date().toISOString(),
      },
    };

    return {
      competitionId,
      competitorId,
      receiptId,
      actorUid,
      siNumber,
      request,
      competitionRef,
      competitorRef,
      assignmentRef,
      receiptRef,
      runnerRef,
      officialRef,
      async cleanup() {
        await firestore.recursiveDelete(competitionRef);
        await Promise.all([runnerRef.delete(), officialRef.delete()]);
      },
    };
  }

  it('creates competitor, assignment, counter, and receipt atomically and replays idempotently', async () => {
    const fixture = await seedReadout();
    try {
      const result = await createReadoutCompetitorFromRunnerDb(
        firestore,
        { uid: fixture.actorUid },
        fixture.competitionId,
        fixture.receiptId,
        fixture.request
      );
      expect(result).toMatchObject({
        status: 'PROCESSED',
        competitorId: fixture.competitorId,
        bib: 401,
        replayed: false,
      });

      const [competition, competitor, assignment, receipt] = await Promise.all([
        fixture.competitionRef.get(),
        fixture.competitorRef.get(),
        fixture.assignmentRef.get(),
        fixture.receiptRef.get(),
      ]);
      expect(competition.data()).toMatchObject({
        competitorCount: 1,
        finishedCount: 1,
      });
      expect(competitor.data()).toMatchObject({
        competitorId: fixture.competitorId,
        ownerUid: fixture.actorUid,
        fullName: 'Readout Runner',
        siNumber: fixture.siNumber,
        readoutReceiptId: fixture.receiptId,
      });
      expect(assignment.data()).toMatchObject({
        competitorId: fixture.competitorId,
        competitorDocumentId: fixture.competitorId,
        ownerUid: fixture.actorUid,
        state: 'ACTIVE',
        source: 'READOUT',
      });
      expect(receipt.data()).toMatchObject({
        receiptId: fixture.receiptId,
        ownerUid: fixture.actorUid,
        status: 'PROCESSED',
        competitorId: fixture.competitorId,
        punchCodes: fixture.request.punchCodes,
        punchTimes: fixture.request.punchTimes,
      });

      const replay = await createReadoutCompetitorFromRunnerDb(
        firestore,
        { uid: fixture.actorUid },
        fixture.competitionId,
        fixture.receiptId,
        fixture.request
      );
      expect(replay).toMatchObject({
        status: 'PROCESSED',
        competitorId: fixture.competitorId,
        bib: result.bib,
        replayed: true,
      });
      await expect(
        createReadoutCompetitorFromRunnerDb(
          firestore,
          { uid: fixture.actorUid },
          fixture.competitionId,
          fixture.receiptId,
          { ...fixture.request, rawHex: 'different-readout' }
        )
      ).rejects.toThrow('already used for another readout');
    } finally {
      await fixture.cleanup();
    }
  });

  it('records an UNKNOWN receipt without creating documents when RunnerDb identity changed', async () => {
    const fixture = await seedReadout({ expectedName: 'Stale Runner Name' });
    try {
      const result = await createReadoutCompetitorFromRunnerDb(
        firestore,
        { uid: fixture.actorUid },
        fixture.competitionId,
        fixture.receiptId,
        fixture.request
      );

      expect(result).toMatchObject({
        status: 'UNKNOWN',
        competitorId: null,
        bib: null,
        replayed: false,
      });
      expect((await fixture.receiptRef.get()).data()).toMatchObject({
        status: 'UNKNOWN',
        ownerUid: fixture.actorUid,
        competitorId: '',
      });
      expect((await fixture.competitorRef.get()).exists).toBe(false);
      expect((await fixture.assignmentRef.get()).exists).toBe(false);
      expect((await fixture.competitionRef.get()).data()?.competitorCount).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it('records an UNKNOWN receipt when the SI assignment is already owned elsewhere', async () => {
    const fixture = await seedReadout({ assignmentOwnerUid: 'usr_other_owner' });
    try {
      const result = await createReadoutCompetitorFromRunnerDb(
        firestore,
        { uid: fixture.actorUid },
        fixture.competitionId,
        fixture.receiptId,
        fixture.request
      );

      expect(result.status).toBe('UNKNOWN');
      expect((await fixture.receiptRef.get()).data()?.status).toBe('UNKNOWN');
      expect((await fixture.competitorRef.get()).exists).toBe(false);
      expect((await fixture.assignmentRef.get()).data()?.ownerUid).toBe(
        'usr_other_owner'
      );
      expect((await fixture.competitionRef.get()).data()?.competitorCount).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
